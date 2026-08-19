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
import { bareAlly, bareInput } from '../__testutils__/bareRosterFixture';
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
                        // 2, not 5. Both outlive the run POST-rung — with no dummy turn nothing
                        // calls `expireStacks`, so expiry is never the reason the ticking stops —
                        // but the value has to make the PRE-rung arm differ, and only a countdown
                        // the dummy's turns can actually exhaust does that. Measured across the
                        // mutation (`turnOrderActors = allActors`): at 5 the pre-rung stacks read
                        // [1, 1], identical to post-rung, so the stacks line below never bit; at 2
                        // they read [1, 0]. 1 would also move the stacks but would weaken the
                        // damage line — pre-rung [500, 0] instead of [500, 500].
                        remainingRounds: 2,
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

    it('MOVES the side-wide scheduled enemy-debuff decrement to the round tail, still exactly once per round', () => {
        // WHAT MOVED, AND WHAT DID NOT. A SCHEDULED (`enemyDebuffs`) entry lives in the side-wide
        // '__enemy__' store, which has no carrier actor. Its decrement used to be hung on the
        // dummy's own Post-Turn and was mirrored by a round-tail block gated on
        // `dummyEnemyIsVestigial`, so exactly one of the two fired. SP-4c-2c retired the turn and
        // dropped the gate, leaving the round-tail block as the sole decrement site.
        //
        // THE CHANGE IS A VALUE-LEVEL NO-OP. Measured across the mutation on the fixture below —
        // same round, same `actorId`, same expiry count, same `activeEnemyDebuffs` row schedule.
        // It is observable ONLY as the emission's POSITION in the ordered event stream:
        //
        //   pre-rung : turn r2 attacker → turn r2 enemy → EXPIRED r2 → turn r2 e1 → turn r2 ally
        //   post-rung: turn r2 attacker → turn r2 e1 → turn r2 ally → EXPIRED r2
        //
        // So this test carries two halves with two different jobs, and neither substitutes for the
        // other. The VALUE assertions (applied once, expired once, on round 2, attributed to the
        // sentinel, with the row schedule to match) are the forward regression pin: they bite under
        // both a double-decrement and a dropped decrement. The ORDER assertion — the expiry lands
        // after every `turn-started` of its round — is the only half that witnesses THIS rung.
        //
        // WHY THIS SHAPE. The rung is differential only where the dummy USED to keep its turn, i.e.
        // where `dummyEnemyIsVestigial` was false, and the bucket has to actually populate:
        //  • the FOCUS carries an ENEMY-side target and a position, so its cast resolves a victim
        //    and its scheduled debuff lands. (Since SP-4c-2b a no-victim turn rejects every timed
        //    enemy application without drawing the gate — `landsTimedEnemyApplicationLive`,
        //    playerTurn.ts — so the sibling test's ally-targeting focus can never fill the bucket.)
        //  • a TEAM ALLY carries an explicit ALLY-side target, which falsifies the second conjunct
        //    ("every player actor is positioned with an enemy-side target") and so kept the dummy in
        //    the turn order pre-rung.
        // A bare, unpositioned shape does NOT work for this: `withTargeting` (normalizeRoster.ts)
        // fills `target: actor.target ?? DEFAULT_FRONT_ENEMY_TARGET`, so a bare focus gets an
        // enemy-side target anyway, and auto-placement plus `MIN_TARGETABLE_MAX_HP` make
        // `hasPositionedEnemyRoster` constant `true` below the boundary. Both conjuncts hold there,
        // the dummy was ALREADY dropped pre-rung, and the test would witness nothing.
        //
        // The debuff is CHARGE-sourced and the charge is spent in round 1 and never recharges
        // (`chargeCount: 99`), so it is applied exactly once. An ACTIVE-sourced debuff is re-upserted
        // on every focus turn, which refreshes `turnsRemaining` back to its full duration each round
        // and hides the decrement entirely.
        //
        // `buff-expired` is the sharper witness — it pins exactly-once AND the `actorId`, and it
        // carries the sentinel's id (`enemy.id`) by design, because the bucket has no single carrier.
        // But it is log-only, so the row schedule is asserted alongside it: `RoundData
        // .activeEnemyDebuffs` DOES observe this bucket. `playerTurn.ts` filters it out of
        // `statusEngine.snapshot(actor.id)`, whose `enemyTargetId` defaults to `DEFAULT_ENEMY_TARGET`
        // and returns the '__enemy__' map, and the timed arm is not victim-fenced — so the row is a
        // read of the side-wide store, and that is what a consumer actually sees.
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
        /** The interleaved stream: one `'turn'` entry per turn, one `'expired'` entry per expiry. */
        const stream: Array<{ round: number; kind: 'turn' | 'expired' }> = [];
        bus.on('turn-started', (e) => stream.push({ round: e.round, kind: 'turn' }));
        bus.on('buff-expired', (e) => {
            if (e.buffName === DEBUFF_NAME) {
                expiries.push({ round: e.round, actorId: e.actorId, buffName: e.buffName });
                stream.push({ round: e.round, kind: 'expired' });
            }
        });
        const applications: number[] = [];
        bus.on('debuff-applied', (e) => {
            if (e.buffName === DEBUFF_NAME) applications.push(e.round);
        });

        const { rounds } = runCombat({
            ...bareInput(),
            bus,
            numRounds: 4,
            // The focus: positioned, enemy-side target — so its cast resolves a victim and the
            // scheduled debuff actually lands in the bucket.
            position: 'M4',
            target: { raw: 'front enemy', side: 'enemy', selection: 'front' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            hasChargedSkill: true,
            startCharged: true,
            chargeCount: 99, // charged in round 1, never again
            enemyDebuffs: [scheduledDebuff],
            // The ally: an explicit ALLY-side target, which is what falsified conjunct 2 and kept
            // the dummy in the turn order pre-rung. Speed 1 puts it last, so the expiry's position
            // relative to it is the whole point.
            teamActors: [
                { ...bareAlly(), target: { raw: 'ally-team', side: 'ally', selection: 'team' } },
            ],
        });

        // The premise: it landed once, in round 1. Without this the single expiry below could be
        // explained by the debuff never having been applied more than once for an unrelated reason.
        expect(applications).toEqual([1]);

        // VALUE — the forward pin. A 2-round debuff landed in round 1 decrements once at the tail
        // of round 1 (2 -> 1) and once at the tail of round 2 (1 -> 0), so it expires in round 2 —
        // ONCE, attributed to the sentinel. Two decrements a round would burn it in round 1; none
        // at all would leave this array empty across all four rounds.
        expect(expiries).toEqual([{ round: 2, actorId: DUMMY_ID, buffName: DEBUFF_NAME }]);

        // ...and the same schedule as a consumer reads it off the row.
        expect(rounds.map((r) => r.activeEnemyDebuffs)).toEqual([
            [{ buffName: DEBUFF_NAME, turnsRemaining: 2 }],
            [{ buffName: DEBUFF_NAME, turnsRemaining: 1 }],
            [],
            [],
        ]);

        // ORDER — the half that witnesses this rung. The decrement now runs at the ROUND TAIL, so
        // its expiry is emitted after every turn of that round. Pre-rung it was the dummy's own
        // Post-Turn, which sat mid-walk (after `attacker`, before `e1` and `ally`).
        // The three turns are the focus, the roster member and the ally; the dummy is not among
        // them, so its retired Post-Turn cannot be where the expiry comes from. Pre-rung this reads
        // `turn, turn, expired, turn, turn` — FOUR turns, with the expiry third, immediately after
        // the dummy's own.
        const expiryRound = expiries[0].round;
        expect(stream.filter((s) => s.round === expiryRound).map((s) => s.kind)).toEqual([
            'turn',
            'turn',
            'turn',
            'expired',
        ]);
    });
});
