/**
 * SP-4c-2c/2d — the side-wide scheduled-debuff decrement OUTLIVES the actor that used to host it.
 *
 * ── WHAT HAPPENED TO THIS FILE (read before adding or removing a case) ─────────────────────────
 *
 * It was written at SP-4c-2c to pin the TWO consequences of retiring the dummy `enemy`'s turn, and
 * SP-4c-2d treated them differently — deliberately, per spec §9.5, and it is easy to get backwards:
 *
 *  1. **The stranded DoT — DELETED with the actor.** That case pinned a hazard that was specific to
 *     the dummy: a DoT pushed onto ITS containers never ticked (no turn), never expired, and was
 *     still summed into every round's report (`dotCarrierActors` included it). SP-4c-2d deleted the
 *     actor AND dropped it from `dotCarrierActors`, so there is no ghost to strand a DoT on and no
 *     reporting route that would surface one. The hazard does not exist to pin.
 *     (`multiEnemyDotStateReporting.integration.test.ts` lost its own dummy-reporting case for the
 *     same reason, and the same rung.)
 *  2. **The scheduled decrement — MIGRATED, not deleted.** Its subject was never the dummy: it is
 *     the round-tail decrement of the side-wide `'__enemy__'` bucket, a store with no carrier at
 *     all. The bucket outlived its host. What changed is only what the reported `actorId` DENOTES
 *     — see `SENTINEL_ENEMY_ACTOR_ID`.
 *
 * The surviving case's own comment carries the value/order split it pins. Do not delete this file
 * wholesale on the strength of its name.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, SENTINEL_ENEMY_ACTOR_ID } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';
import { createEventBus } from '../events';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareAlly, bareInput } from '../__testutils__/bareRosterFixture';

describe('the side-wide scheduled-debuff decrement, after the dummy turn was retired', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
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
        // WHY THIS SHAPE. The rung this case was written for was differential only where
        // the dummy USED to keep its turn, i.e. where the retired `dummyEnemyIsVestigial` gate read
        // false, and the bucket has to actually populate:
        //  • the FOCUS carries an ENEMY-side target and a position, so its cast resolves a victim
        //    and its scheduled debuff lands. (Since SP-4c-2b a no-victim turn rejects every timed
        //    enemy application without drawing the gate — `landsTimedEnemyApplicationLive`,
        //    playerTurn.ts — so the sibling test's ally-targeting focus can never fill the bucket.)
        //  • a TEAM ALLY carries an explicit ALLY-side target, which falsifies the second conjunct
        //    ("every player actor is positioned with an enemy-side target") and so kept the dummy in
        //    the turn order pre-rung.
        // A bare, unpositioned shape does NOT work for this: `withTargeting` (normalizeRoster.ts)
        // fills `target: actor.target ?? DEFAULT_FRONT_ENEMY_TARGET`, so a bare focus gets an
        // enemy-side target anyway, and auto-placement plus `MIN_TARGETABLE_MAX_HP` made the
        // retired gate's roster conjunct constant `true` below the boundary. Both conjuncts held
        // there, the dummy was ALREADY dropped pre-rung, and the test would witness nothing.
        //
        // The debuff is CHARGE-sourced and the charge is spent in round 1 and never recharges
        // (`chargeCount: 99`), so it is applied exactly once. An ACTIVE-sourced debuff is re-upserted
        // on every focus turn, which refreshes `turnsRemaining` back to its full duration each round
        // and hides the decrement entirely.
        //
        // `buff-expired` is the sharper witness — it pins exactly-once AND the `actorId`, which is
        // `SENTINEL_ENEMY_ACTOR_ID` by design, because the bucket has no single carrier.
        //
        // ⚠️ WHAT SP-4c-2d MIGRATED HERE, precisely, because §9.5 and §4.3 read as if they disagree:
        // the STRING did not change. It was `enemy.id` and is now `SENTINEL_ENEMY_ACTOR_ID`, whose
        // value is the same literal `'enemy'` — so the event stream is byte-identical across the
        // actor's deletion. What re-keyed is what the id DENOTES: it used to be the dummy actor that
        // hosted the decrement, and it is now an id for the BUCKET itself. This case therefore
        // MIGRATES rather than dying with the actor — its subject (a side-wide store decremented
        // exactly once a round) was never dummy-specific.
        //
        // `buff-expired` is log-only, so the row schedule is asserted alongside it: `RoundData
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
        expect(expiries).toEqual([
            { round: 2, actorId: SENTINEL_ENEMY_ACTOR_ID, buffName: DEBUFF_NAME },
        ]);

        // ...and the same schedule as a consumer reads it off the row.
        expect(rounds.map((r) => r.activeEnemyDebuffs)).toEqual([
            [{ buffName: DEBUFF_NAME, turnsRemaining: 2 }],
            [{ buffName: DEBUFF_NAME, turnsRemaining: 1 }],
            [],
            [],
        ]);

        // ORDER — the half that witnesses SP-4c-2c. The decrement runs at the ROUND TAIL, so its
        // expiry is emitted after every turn of that round. Pre-4c-2c it was the dummy's own
        // Post-Turn, which sat mid-walk (after `attacker`, before `e1` and `ally`), and that stream
        // read `turn, turn, expired, turn, turn` — FOUR turns, with the expiry third, immediately
        // after the dummy's own. The three turns below are the focus, the roster member and the
        // ally; there is no fourth actor for a Post-Turn to hang on any more.
        const expiryRound = expiries[0].round;
        expect(stream.filter((s) => s.round === expiryRound).map((s) => s.kind)).toEqual([
            'turn',
            'turn',
            'turn',
            'expired',
        ]);
    });
});
