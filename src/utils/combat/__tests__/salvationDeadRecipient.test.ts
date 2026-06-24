/**
 * Salvation dead-recipient gross-heal filtering (Positional Combat Phase 4 PR 2, Task 3).
 *
 * Salvation's `all-allies` ON-DESTROYED heal fires when its OWN caster is destroyed.
 * The reactive executor's recipient loop iterates `ctx.playerIds` for `all-allies`,
 * which still includes the dead caster — inflating gross `directHeal` by one phantom
 * per-recipient share (Phase 4b KNOWN LIMITATION 5). `effectiveHeal`/`overheal` already
 * credit only the live heal target (the `rid === ctx.healing.targetId` guard).
 *
 * The fix skips recipients whose runtime EXISTS with currentHp <= 0 from the gross
 * credit. A MISSING runtime is treated as ALIVE (credited) to preserve byte-identical
 * goldens for legacy unwalked team actors.
 *
 * These are focused executor-level tests (hand-built Intent + IntentExecContext with a
 * test-double HealingRuntimeCtx), mirroring the executor harness in hpCrossing.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { executeIntent, Intent, IntentExecContext } from '../triggers';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import type { PlayerActorRuntime, HealingRuntimeCtx } from '../playerTurn';
import type { CombatActor, ActorHealing } from '../state';
import { emptyActorHealing } from '../state';

/** A runtime carrying just enough for the heal executor: base stats + actor.currentHp. */
const runtime = (id: string, currentHp: number, attack = 100): PlayerActorRuntime =>
    ({
        actor: { id, currentHp } as CombatActor,
        healModifier: 0,
        attack,
        defence: 0,
        hp: 1000,
    }) as unknown as PlayerActorRuntime;

/** A test-double healing ctx that accumulates credits per actor/bucket. */
const makeHealing = (
    targetId: string,
    playerIds: string[]
): {
    healing: HealingRuntimeCtx;
    credits: Map<string, ActorHealing>;
} => {
    const credits = new Map<string, ActorHealing>();
    const healing: HealingRuntimeCtx = {
        targetId,
        credit: (actorId, bucket, amount) => {
            const row = credits.get(actorId) ?? emptyActorHealing();
            row[bucket] += amount;
            credits.set(actorId, row);
        },
        recipientMaxHp: () => 1000,
        recipientIncomingHealPct: () => 0,
        applierMaxHp: () => undefined,
        // Live target starts missing 500 HP → first 500 of raw is effective, rest overheals.
        applyHealToTarget: (raw) => {
            const consumed = Math.min(raw, 500);
            return { consumed, overheal: raw - consumed };
        },
        grantShieldToTarget: () => {},
        playerIds,
        // E5 fields (unused on this player-path double — present for type-correctness).
        enemyIds: [],
        recipientActor: () => undefined,
    };
    return { healing, credits };
};

const buildCtx = (
    runtimes: Map<string, PlayerActorRuntime>,
    healing: HealingRuntimeCtx,
    playerIds: string[]
): IntentExecContext => {
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    se.beginRound(1);
    return {
        round: 1,
        enemy: { id: 'enemy' } as CombatActor,
        enemyId: 'enemy',
        statusEngine: se,
        bus: createEventBus(),
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes,
        grantAllyCharges: () => {},
        removeEnemyCharges: () => {},
        grantExtraAction: () => {},
        playerIds,
        lastTurnCtxByActor: new Map(),
        enemyHp: 100000,
        cumulativeDamage: 0,
        recordResisted: () => {},
        oncePerCombatFired: new Set<string>(),
        healing,
    };
};

/** Salvation-shaped on-destroyed all-allies heal. basis:'attack' so the per-recipient
 *  raw is owner-scoped and identical across recipients (easy gross arithmetic). */
const salvationHeal = (caster: string): Intent => ({
    ownerId: caster,
    sourceSlot: 'passive',
    ability: {
        id: 'salvation',
        type: 'heal',
        target: 'all-allies',
        trigger: 'on-destroyed',
        conditions: [],
        config: { type: 'heal', basis: 'attack', pct: 50 },
    },
});

describe('Phase 4 PR 2 Task 3 — Salvation dead-recipient gross-heal filtering', () => {
    // owner.attack = 100, pct = 50 → per-recipient raw = 100 * 0.5 = 50 (no modifiers).
    const RAW = 50;

    it('excludes the dead caster from gross directHeal (credits living recipients only)', () => {
        // 3 allies: the caster (dead) + two living. The live heal target is one of the living.
        const playerIds = ['caster', 'ally1', 'ally2'];
        const runtimes = new Map<string, PlayerActorRuntime>([
            ['caster', runtime('caster', 0)], // DEAD — destroyed, fired its on-destroyed heal
            ['ally1', runtime('ally1', 1000)],
            ['ally2', runtime('ally2', 1000)],
        ]);
        const { healing, credits } = makeHealing('ally1', playerIds);
        const ctx = buildCtx(runtimes, healing, playerIds);

        executeIntent(salvationHeal('caster'), ctx);

        // Gross directHeal reflects the 2 LIVING recipients only — NOT all 3.
        expect(credits.get('caster')?.directHeal).toBe(2 * RAW);
        // Sanity: the buggy behavior would have credited 3 * RAW.
        expect(credits.get('caster')?.directHeal).not.toBe(3 * RAW);
    });

    it('leaves the live heal target path (effectiveHeal/overheal) unchanged', () => {
        const playerIds = ['caster', 'ally1', 'ally2'];
        const runtimes = new Map<string, PlayerActorRuntime>([
            ['caster', runtime('caster', 0)],
            ['ally1', runtime('ally1', 1000)],
            ['ally2', runtime('ally2', 1000)],
        ]);
        const { healing, credits } = makeHealing('ally1', playerIds);
        const ctx = buildCtx(runtimes, healing, playerIds);

        executeIntent(salvationHeal('caster'), ctx);

        // Live target ally1: applyHealToTarget split of RAW (50): 50 consumed, 0 overheal.
        expect(credits.get('caster')?.effectiveHeal).toBe(50);
        expect(credits.get('caster')?.overheal).toBe(0);
    });

    it('treats a recipient with NO runtime entry as ALIVE (legacy unwalked actor → credited)', () => {
        // 'legacy' has no runtimes entry → must still be credited (byte-identical goldens).
        const playerIds = ['caster', 'legacy', 'ally2'];
        const runtimes = new Map<string, PlayerActorRuntime>([
            ['caster', runtime('caster', 1000)], // alive caster
            ['ally2', runtime('ally2', 1000)],
            // 'legacy' deliberately absent.
        ]);
        const { healing, credits } = makeHealing('ally2', playerIds);
        const ctx = buildCtx(runtimes, healing, playerIds);

        executeIntent(salvationHeal('caster'), ctx);

        // All 3 credited (caster alive, legacy missing→alive, ally2 alive).
        expect(credits.get('caster')?.directHeal).toBe(3 * RAW);
    });
});
