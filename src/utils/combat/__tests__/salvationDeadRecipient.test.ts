/**
 * Salvation dead-recipient gross-heal filtering (Positional Combat Phase 4 PR 2, Task 3).
 *
 * Salvation's `all-allies` ON-DESTROYED heal fires when its OWN caster is destroyed.
 * The reactive executor's recipient loop iterates `ctx.playerIds` for `all-allies`,
 * which still includes the dead caster — inflating gross `directHeal` by one phantom
 * per-recipient share (Phase 4b KNOWN LIMITATION 5).
 *
 * SP-4e Task 2 changed the second half of that sentence: `effectiveHeal`/`overheal` used to
 * credit only the live heal target (the `rid === ctx.healing.targetId` pool gate), so every
 * OTHER living recipient was credited gross and healed nothing. That gate is gone — each
 * resolved recipient now drains its own pool — and the `appliedTo` list on the healing double
 * is what pins WHICH recipients those were.
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
    /** SP-4e fix wave 1: the RECIPIENT of every pool application, in order. The credit map alone
     *  cannot tell "repaired ally1 then ally2" apart from "repaired the anchor twice" — it is
     *  keyed by the crediting OWNER, not by who was healed. The reviewer proved that gap by
     *  mis-routing the executor to `recipientActor(ctx.healing.targetId)`; the effectiveHeal
     *  assertion below stayed green. This array is what makes it go red. */
    appliedTo: string[];
    /** Task 4 (#362): the `repairSourceId` handed to each `applyHealToTarget` call, alongside
     *  `appliedTo`. Its original purpose (crediting a reversal KILL to this id) was retracted by
     *  R7′ — that credit now goes to the debuff's applier instead, read off `reversedRepairsOn`,
     *  never off this parameter. Its current purpose (#362 fix-wave-1) is display-only: it becomes
     *  `reversed-repair-log`'s `healerId`, which names the repair's caster inside the combat-log
     *  line ("Zosimos → Nova: Medic's repair reversed N"). A future bug here would show up as the
     *  WRONG SHIP NAMED in that line, not as a misattributed kill or credit. */
    appliedSourceIds: string[];
} => {
    const credits = new Map<string, ActorHealing>();
    const appliedTo: string[] = [];
    const appliedSourceIds: string[] = [];
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
        applyHealToTarget: (raw, victim, repairSourceId) => {
            appliedTo.push(victim.id);
            appliedSourceIds.push(repairSourceId);
            const consumed = Math.min(raw, 500);
            return { reversed: false, consumed, overheal: raw - consumed };
        },
        grantShieldToTarget: () => ({ granted: 0, gross: 0 }),
        playerIds,
        enemyIds: [],
        // No longer an "unused E5 field present for type-correctness" — the reactive
        // heal branch reads it to decide whose pool to repair (it used to repair only `targetId`).
        // Production resolves every roster id via `allActorsById.get`; a blanket `() => undefined`
        // would repair nobody and make this suite's effectiveHeal assertions vacuous.
        recipientActor: (id) =>
            playerIds.includes(id) ? ({ id } as unknown as CombatActor) : undefined,
    };
    return { healing, credits, appliedTo, appliedSourceIds };
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
        statusEngine: se,
        bus: createEventBus(),
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes,
        grantAllyCharges: () => {},
        removeEnemyCharges: () => {},
        removeChargesFrom: () => {},
        grantExtraAction: () => {},
        playerIds,
        lastTurnCtxByActor: new Map(),
        recordResisted: () => {},
        oncePerCombatFired: new Set<string>(),
        healing,
        // FIX 3: now required — this suite has no lowest-hp-ally consumer, so "nobody" is the
        // honest answer, supplied explicitly rather than by omission.
        lowestHpAllyIdFor: () => undefined,
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

    it('repairs EVERY living recipient (SP-4e), not just the live heal target', () => {
        const playerIds = ['caster', 'ally1', 'ally2'];
        const runtimes = new Map<string, PlayerActorRuntime>([
            ['caster', runtime('caster', 0)],
            ['ally1', runtime('ally1', 1000)],
            ['ally2', runtime('ally2', 1000)],
        ]);
        const { healing, credits, appliedTo, appliedSourceIds } = makeHealing('ally1', playerIds);
        const ctx = buildCtx(runtimes, healing, playerIds);

        executeIntent(salvationHeal('caster'), ctx);

        // The two LIVING recipients each consume their OWN pool. The recipient list
        // is the load-bearing assertion — before this rung only the anchor ('ally1') was applied,
        // an `all-allies` reactive heal credited gross for every ally but restored HP to one. The
        // dead caster is still excluded (THIS file's subject, pinned by the first test): the list
        // is ['ally1', 'ally2'] in playerIds order, NOT ['ally1', 'ally1'].
        expect(appliedTo).toEqual(['ally1', 'ally2']);
        // Task 4 (#362): the reactive executor passes `intent.ownerId` as `repairSourceId` — the
        // dead Salvation caster, not either living recipient.
        expect(appliedSourceIds).toEqual(['caster', 'caster']);
        // The bucket totals agree, but only the list above can tell two distinct recipients apart
        // from the anchor being repaired twice: this double's `applyHealToTarget` splits every raw
        // 50 consumed / 0 overheal regardless of victim, so these count APPLICATIONS, not HP.
        expect(credits.get('caster')?.effectiveHeal).toBe(2 * 50);
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
