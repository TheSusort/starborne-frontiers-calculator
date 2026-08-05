import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { holdsBarrierRecharging, BARRIER_RECHARGING } from '../barrierRecharging';
import { executeIntent, type Intent, type IntentExecContext } from '../triggers';
import { createEventBus } from '../events';
import type { CombatActor } from '../state';
import type { PlayerActorRuntime } from '../playerTurn';

const timed = (buffName: string, duration: number) => ({
    payload: { buffName, stacks: 1, parsedEffects: {} },
    side: 'self' as const,
    sourceSlot: 'passive' as const,
    conditions: [],
    kind: 'timed' as const,
    duration,
});

describe('Barrier Recharging lockout predicate', () => {
    it('is true for an actor carrying the status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 3), 'a1');
        expect(holdsBarrierRecharging(eng, 'a1')).toBe(true);
    });

    it('is false for an actor without it, and for an unrelated status', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Barrier', 1), 'a2');
        expect(holdsBarrierRecharging(eng, 'a2')).toBe(false);
        expect(holdsBarrierRecharging(eng, 'nobody')).toBe(false);
    });
});

// =============================================================================
// The re-arm gate — triggers.ts's reactive buff-grant recipient loop (~line 2621).
//
// Barrier Recharging's own text, "Cannot be reduced. Unremovable", says nothing about a FRESH
// grant landing on a holder who already has it — only the pre-existing BARRIER_BUFFS arm of the
// gate is stated by the text (it blocks a Barrier grant specifically). Taken literally, a second
// grant of Barrier Recharging ITSELF would go through `familyApplicationWins`, which compares
// `duration > existing.turnsRemaining`: a fresh 3-turn grant always beats a decayed 1 or 2, so
// Quixilver's every-turn re-fire would refresh the lockout back to 3 forever — a permanent
// one-shot lock, not a 3-turn cooldown. The owner-approved reading treats "cannot be reduced" as
// "cannot be re-armed while still held", so the gate's second arm blocks Barrier Recharging from
// re-applying to itself too. These tests drive `executeIntent` directly — the REACTIVE path an
// end-of-turn trigger takes (see hitCountedBarrier.integration.test.ts's reactive-path suite for
// the sibling fixture this is modeled on) — to prove the lockout actually decays to expiry and
// then re-arms, rather than refreshing every time the granter fires.
// =============================================================================

describe('Barrier Recharging: real 3-turn cooldown (re-arm gate)', () => {
    const makeAllyRuntime = (id: string): PlayerActorRuntime =>
        ({
            actor: { id } as CombatActor,
            healModifier: 0,
            attack: 0,
            defence: 0,
            hp: 1000,
        }) as unknown as PlayerActorRuntime;

    /** Quixilver's end-of-turn grant to all allies, modeling only the Barrier Recharging half
     *  (the co-granted Barrier itself is already covered by the pre-existing BARRIER_BUFFS arm
     *  and by hitCountedBarrier.integration.test.ts). */
    const rechargingGrantIntent = (): Intent => ({
        ownerId: 'quixilver',
        sourceSlot: 'passive',
        ability: {
            id: 'barrier-recharging-grant',
            type: 'buff',
            target: 'all-allies',
            trigger: 'end-of-turn',
            conditions: [],
            config: {
                type: 'buff',
                buffName: BARRIER_RECHARGING,
                stacks: 1,
                parsedEffects: {},
                isStackable: false,
                duration: 3,
            },
        },
    });

    /** Minimal IntentExecContext for an all-allies buff intent — lifted from
     *  hitCountedBarrier.integration.test.ts's reactive-path suite (same cfg.type === 'buff'
     *  branch), re-keyed to accept an arbitrary ally id list. */
    const buildCtx = (playerIds: string[]): IntentExecContext => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        return {
            round: 1,
            enemy: { id: 'enemy-default' } as CombatActor,
            enemyId: 'enemy-default',
            statusEngine: se,
            bus: createEventBus(),
            corrosionEntries: [],
            infernoEntries: [],
            pendingBombs: [],
            // The owner ('quixilver') needs a runtime too — executeIntent resolves it before
            // touching the recipient loop — even though it is not itself an all-allies recipient.
            runtimes: new Map([
                ['quixilver', makeAllyRuntime('quixilver')],
                ...playerIds.map((id): [string, PlayerActorRuntime] => [id, makeAllyRuntime(id)]),
            ]),
            grantAllyCharges: () => {},
            removeEnemyCharges: () => {},
            removeChargesFrom: () => {},
            grantExtraAction: () => {},
            playerIds,
            lastTurnCtxByActor: new Map(),
            enemyHp: 100000,
            cumulativeDamage: 0,
            recordResisted: () => {},
        } as IntentExecContext;
    };

    it('does not refresh an ally already holding the lockout', () => {
        const ctx = buildCtx(['a1']);
        // a1 is already at 2 turns remaining — Quixilver's PREVIOUS grant has already ticked
        // down once via the ally's own Post-Turn. A naive re-application would beat it
        // (3 > 2, familyApplicationWins) and reset the lockout to 3 — the exact bug this test
        // proves does NOT happen.
        ctx.statusEngine.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 2), 'a1');

        executeIntent(rechargingGrantIntent(), ctx);

        // Two more Post-Turn ticks fully expire the ORIGINAL 2-turn grant. If the gate had
        // refreshed it to 3 above, a third tick would still be needed and this would fail.
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(true); // 1 turn left
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(false); // expired on schedule
    });

    it('re-arms once the lockout has fully decayed, letting a later grant land', () => {
        const ctx = buildCtx(['a1']);
        ctx.statusEngine.applyTimedAbilityStatus(1, timed(BARRIER_RECHARGING, 1), 'a1');

        // One Post-Turn tick expires the original grant entirely — the cooldown has cycled.
        ctx.statusEngine.decrementPlayer('a1');
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(false);

        // Quixilver's next end-of-turn fire finds no lockout in the way, so this is a genuinely
        // FRESH grant, not a refresh — it lands.
        executeIntent(rechargingGrantIntent(), ctx);
        expect(holdsBarrierRecharging(ctx.statusEngine, 'a1')).toBe(true);
    });
});
