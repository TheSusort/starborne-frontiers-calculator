/**
 * Dead-owner reactive gate (combat-sim testing finding #1).
 *
 * A reactive listener belonging to a DESTROYED ship keeps firing on later events — e.g. a
 * dead Curator still purges/Block-Buffs an enemy that charge-casts rounds after the Curator
 * died. The fix gates the reactive DRAIN: an intent whose owner is already destroyed
 * (`actor.destroyedRound !== undefined`) is skipped — EXCEPT the owner's own death reaction
 * (a self-scoped `on-destroyed` enqueue, tagged `eventCtx.fromOwnDeath`), which is born of the
 * death itself and must still resolve (Martyrdom's killer-Disable, Salvation's self-destruct
 * heal).
 *
 * Two layers, two harnesses:
 *  1. executeIntent gate (drain-time) — hand-built Intent + IntentExecContext, mirroring the
 *     reactive-debuff executor harness in blockDebuff.test.ts.
 *  2. on-destroyed self listener tagging — bare bus + registerReactiveListeners, mirroring the
 *     death-trigger listener tests in triggers.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
    executeIntent,
    registerReactiveListeners,
    Intent,
    IntentExecContext,
    ReactiveAbility,
} from '../triggers';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import type { PlayerActorRuntime } from '../playerTurn';
import type { CombatActor } from '../state';
import type { Ability } from '../../../types/abilities';

// ── executeIntent gate harness ──────────────────────────────────────────────────────────

/** A reactive (on-attacked) timed debuff inflicted at a chosen counter target. */
const reactiveDebuffIntent = (counterTargetId: string, over: Partial<Intent> = {}): Intent => ({
    ownerId: 'owner',
    sourceSlot: 'passive',
    ability: {
        id: 'reactive-debuff',
        type: 'debuff',
        target: 'enemy',
        trigger: 'on-attacked',
        conditions: [],
        config: {
            type: 'debuff',
            buffName: 'Attack Down II',
            stacks: 1,
            parsedEffects: { attack: -50 },
            isStackable: false,
            application: 'inflict',
            duration: 3,
        },
    },
    eventCtx: { counterTargetId },
    ...over,
});

/** Owner runtime whose landing gates always pass — the ONLY thing that can stop the
 *  application is the dead-owner gate under test. `destroyedRound` controls aliveness. */
const ownerRuntime = (destroyedRound?: number): PlayerActorRuntime =>
    ({
        actor: { id: 'owner', destroyedRound } as CombatActor,
        landsTimedEnemyApplication: () => true,
        debuffLandingGate: () => true,
    }) as unknown as PlayerActorRuntime;

const buildCtx = (destroyedRound?: number): IntentExecContext => {
    const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    se.beginRound(1);
    return {
        round: 1,
        statusEngine: se,
        bus: createEventBus(),
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        runtimes: new Map([['owner', ownerRuntime(destroyedRound)]]),
        grantAllyCharges: () => {},
        removeEnemyCharges: () => {},
        removeChargesFrom: () => {},
        grantExtraAction: () => {},
        playerIds: ['owner'],
        lastTurnCtxByActor: new Map(),
        enemyHp: 100000,
        recordResisted: () => {},
        oncePerCombatFired: new Set<string>(),
    } as unknown as IntentExecContext;
};

const enemyHasDebuff = (ctx: IntentExecContext, enemyId: string, name: string): boolean =>
    ctx.statusEngine
        .timedAbilityStatuses('enemy', undefined, enemyId)
        .some((s) => s.active.buffName === name);

describe('dead-owner reactive gate (executeIntent drain)', () => {
    it("a DEAD owner's reactive debuff does NOT apply (stale Curator-style reaction is suppressed)", () => {
        const ctx = buildCtx(/* destroyedRound */ 0);
        executeIntent(reactiveDebuffIntent('enemy-1'), ctx);
        expect(enemyHasDebuff(ctx, 'enemy-1', 'Attack Down II')).toBe(false);
    });

    it("control: a LIVING owner's identical reactive debuff DOES apply (non-vacuity)", () => {
        const ctx = buildCtx(/* alive */ undefined);
        executeIntent(reactiveDebuffIntent('enemy-1'), ctx);
        expect(enemyHasDebuff(ctx, 'enemy-1', 'Attack Down II')).toBe(true);
    });

    it("a DEAD owner's OWN death reaction (eventCtx.fromOwnDeath) STILL applies — Martyrdom carve-out", () => {
        const ctx = buildCtx(/* destroyedRound */ 0);
        executeIntent(
            reactiveDebuffIntent('enemy-1', {
                eventCtx: { counterTargetId: 'enemy-1', fromOwnDeath: true },
            }),
            ctx
        );
        expect(enemyHasDebuff(ctx, 'enemy-1', 'Attack Down II')).toBe(true);
    });
});

// ── on-destroyed self listener tagging harness ──────────────────────────────────────────

const martyrdomDebuff = (): Ability => ({
    id: 'martyrdom',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-destroyed',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Disable',
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        application: 'inflict',
        duration: 2,
    },
});

const salvationHeal = (): Ability => ({
    id: 'salvation',
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-destroyed',
    conditions: [],
    config: { type: 'heal', basis: 'attack', pct: 50 },
});

/** Register an on-destroyed self reaction for owner 'A', emit A's own ship-destroyed, return
 *  the enqueued intents. byDirectDamage drives the debuff/purge branch's gate. */
const emitOwnDeath = (ability: Ability, byDirectDamage: boolean): Intent[] => {
    const bus = createEventBus();
    const intents: Intent[] = [];
    const ra: ReactiveAbility = { ability, sourceSlot: 'passive' };
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    bus.emit({ type: 'ship-destroyed', actorId: 'A', round: 1, killerId: 'enemy', byDirectDamage });
    return intents;
};

describe('on-destroyed self listener stamps eventCtx.fromOwnDeath', () => {
    it('killer-targeted debuff branch (Martyrdom) carries fromOwnDeath', () => {
        const intents = emitOwnDeath(martyrdomDebuff(), /* byDirectDamage */ true);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.fromOwnDeath).toBe(true);
        // Existing routing preserved: the Disable still points at the killer.
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy');
    });

    it('unconditional self-death branch (Salvation heal) carries fromOwnDeath', () => {
        const intents = emitOwnDeath(salvationHeal(), /* byDirectDamage */ false);
        expect(intents).toHaveLength(1);
        expect(intents[0].eventCtx?.fromOwnDeath).toBe(true);
    });
});
