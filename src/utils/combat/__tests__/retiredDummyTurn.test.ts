/**
 * SP-4c-2c — the two consequences of retiring the dummy `enemy`'s turn.
 *
 * Neither is a bug and neither is reachable from any production input: nothing routes into the
 * dummy's containers since SP-4c-2b (the player side gets `tgt: undefined`, and the dummy is not a
 * member of `opposingRoster`, so it can never be a victim). Both are pinned because SP-4c-2d deletes
 * the actor and must know exactly what it is deleting — an undocumented behaviour discovered during
 * a pure-deletion rung reads as that rung's regression.
 *
 * This whole file goes with the dummy in SP-4c-2d. It is not migrated: once there is no dummy
 * there are no containers to strand and no Post-Turn the decrement could have hung on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';
import { createEventBus } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput } from '../__testutils__/bareRosterFixture';
import { collectTurns } from '../__testutils__/turnOrderTap';

/** `bareInput().numRounds`. */
const BARE_ROUNDS = 2;

/** The dummy sentinel's actor id — the id the side-wide `'__enemy__'` bucket reports under. */
const DUMMY_ID = 'enemy';

describe('the retired dummy turn', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('STRANDS a DoT pushed onto the dummy: it never ticks, never expires, and is still reported', () => {
        // The fixture is SP-4c-2b's LIVENESS shape verbatim — an ally-side active target, which was
        // the last thing that kept the dummy in the turn order — plus a test tap that pushes one
        // corrosion entry straight onto the dummy's container.
        //
        // Before SP-4c-2c the dummy took its turn and this entry ticked for 500 a round
        // (1 stack x tier 5/100 x min(enemyHp, 500_000) = 0.05 x 10_000) while `remainingRounds`
        // counted down. Now there is no turn to tick it in, so it is frozen: 0 damage forever, and
        // because `dotCarrierActors` (engine.ts) still includes the dummy for REPORTING, the stack
        // is still counted into every round's row. Measured, not predicted.
        const DUMMY_HP = 10_000;
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            enemyHp: DUMMY_HP,
            __testTapActors: (actors) => {
                actors
                    .find((a) => a.id === DUMMY_ID)
                    ?.corrosionEntries.push({
                        tier: 5,
                        stacks: 1,
                        remainingRounds: 5, // outlives the run, so expiry is never the reason it stops
                        sourceId: 'attacker',
                    });
            },
        });

        // The dummy really is absent from the order — without this the two zeros below could be
        // explained by the entry never having been pushed.
        expect(actorsThatTookTurns(1)).not.toContain(DUMMY_ID);
        expect(actorsThatTookTurns(BARE_ROUNDS)).not.toContain(DUMMY_ID);

        // It never ticks: 500/round became 0/round.
        expect(result.rounds.map((r) => r.corrosionDamage)).toEqual([0, 0]);
        // ...but it IS still reported, every round, at full stack count. This is the strand.
        expect(result.rounds.map((r) => r.activeCorrosionStacks)).toEqual([1, 1]);
    });

    it('DECREMENTS the side-wide scheduled enemy-debuff bucket exactly once per round', () => {
        // WHAT MOVED. A SCHEDULED (`enemyDebuffs`) entry lives in the side-wide '__enemy__' store,
        // which has no carrier actor. Its decrement used to be hung on the dummy's own Post-Turn and
        // was mirrored by a round-tail block gated on `dummyEnemyIsVestigial`, so exactly one of the
        // two fired. SP-4c-2c retired the turn and dropped the gate, leaving the round-tail block as
        // the sole decrement site.
        //
        // WHY THIS SHAPE AND NOT THE SIBLING TEST'S. The sibling above uses the ally-side active
        // target because that is the shape whose SECOND conjunct kept the dummy in the turn order.
        // That shape is UNUSABLE here: since SP-4c-2b a no-victim turn rejects every timed enemy
        // application without drawing the gate (`landsTimedEnemyApplicationLive`, playerTurn.ts),
        // so an ally-targeting focus can never put anything in the bucket to decrement. The bare
        // shape below falsifies the FIRST conjunct instead — `bareEnemy()` carries no position, so
        // `hasPositionedEnemyRoster` was false and the dummy kept its turn here too — while the
        // focus still resolves a victim and therefore lands its scheduled debuff.
        //
        // The debuff is CHARGE-sourced and the charge is spent in round 1 and never recharges
        // (`chargeCount: 99`), so it is applied exactly once. An ACTIVE-sourced debuff is re-upserted
        // on every focus turn, which refreshes `turnsRemaining` back to its full duration each round
        // and hides the decrement entirely.
        //
        // Observed through `buff-expired` rather than through a `RoundData` row field: no row field
        // observes this bucket. `RoundData.activeEnemyDebuffs` is `lastAttackerTurn
        // .landedEnemyDebuffs`, a snapshot of what the FOCUS's cast landed on its victim, not the
        // side-wide store. The event is log-only and carries the sentinel's id (`enemy.id`) by
        // design — the bucket has no single carrier — which is exactly what makes it the honest
        // witness for a side-wide decrement.
        const DEBUFF_NAME = 'Def Down';
        const scheduledDebuff: SelectedGameBuff = {
            id: 'dd1',
            buffName: DEBUFF_NAME,
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
            skillSource: 'charge',
            skillDuration: 2,
            // 'apply' lands on affinity rather than drawing the hacking-vs-security gate, so the
            // landing is not a function of the RNG stream.
            application: 'apply',
        };

        const bus = createEventBus();
        const expiries: Array<{ round: number; actorId: string; buffName: string }> = [];
        bus.on('buff-expired', (e) => {
            if (e.buffName === DEBUFF_NAME) {
                expiries.push({ round: e.round, actorId: e.actorId, buffName: e.buffName });
            }
        });
        const applications: number[] = [];
        bus.on('debuff-applied', (e) => {
            if (e.buffName === DEBUFF_NAME) applications.push(e.round);
        });

        runCombat({
            ...bareInput(),
            bus,
            numRounds: 4,
            hasChargedSkill: true,
            startCharged: true,
            chargeCount: 99, // charged in round 1, never again
            enemyDebuffs: [scheduledDebuff],
        });

        // The premise: it landed once, in round 1. Without this the single expiry below could be
        // explained by the debuff never having been applied more than once for an unrelated reason.
        expect(applications).toEqual([1]);

        // A 2-round debuff landed in round 1 decrements once at the tail of round 1 (2 -> 1) and
        // once at the tail of round 2 (1 -> 0), so it expires in round 2 — ONCE, attributed to the
        // sentinel. Two decrements a round would burn it in round 1; none at all would leave this
        // array empty across all four rounds.
        expect(expiries).toEqual([{ round: 2, actorId: DUMMY_ID, buffName: DEBUFF_NAME }]);
    });
});
