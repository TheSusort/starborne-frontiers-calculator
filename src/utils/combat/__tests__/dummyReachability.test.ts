/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * ── WHAT THIS FILE GUARANTEES ─────────────────────────────────────────────────────────────────
 *
 * 1. **COVERAGE — six paths, not one.** The file used to exercise `bareInput()` alone: a single
 *    focus-attacker damage cast, plus an empty roster. A zero from one shape only ever meant "this
 *    shape does not reach the fallback", never "no shape does" (raised on PR #324, and correct). It
 *    now runs a case per engine path that resolves a victim, and each asserts that the path never
 *    consults the fallback:
 *      • FOCUS DAMAGE      — the focus attacker's own cast site;
 *      • TEAM-ACTOR TURNS  — a walked ally taking a real turn, damage deliberately excluded;
 *      • WALKED-TEAM DAMAGE— that ally's own cast site, which is a SEPARATE site from the focus's;
 *      • ENEMY TURNS       — the enemy→player direction, with an enemy that actually ACTS;
 *      • CORPSE TARGETING  — a roster that WAS targetable and has been killed;
 *      • DEATH RETARGETING — a two-member roster where the front dies and the cast moves on.
 *    Every case asserts something POSITIVE about the path it claims (a `turn-started` for the
 *    actor, a `perTargetDealt` row naming the victim, a `ship-destroyed`, a changed victim id)
 *    alongside its zero. A zero from a case that never ran its path is the "no goldens moved can
 *    mean nothing covers this" trap in counter form, and it is what these positive halves forbid.
 *
 * 2. **THE ONE COUNTER, and what its zero means.** `__getLegacyVictimFallbackCount` counts
 *    CONSULTATIONS of `tb.legacyVictim`: selection handed the fallback object back. Read it through
 *    the `consultations()` helper below. Since SP-4c-2b **every reading in this file is
 *    ENEMY-SIDE-ONLY**. `selectTurnTarget` increments the shared counter at ONE site for BOTH sides,
 *    but the two `TurnBindings.legacyVictim` objects it feeds are not the same kind of thing: the
 *    player side's was the dummy `enemy`; the enemy side's is `healTarget`, a real player actor. The
 *    player side no longer has a fallback to consult at all — a player actor that resolves nobody
 *    gets `tgt: undefined` and runs a NO-VICTIM turn — so a player-side consultation is structurally
 *    impossible and the zeros here are claims about the enemy-side binding.
 *
 * 3. **VACUITY — split across TWO counters, and say which is which.** Every case above reads 0, and
 *    a zero from a reading wired to nothing is indistinguishable from a zero that means something.
 *    Two separate guards answer that, because the zeros and the non-zero are DIFFERENT counters:
 *      • the `LIVENESS` case reads `__getNoVictimPlayerTurnCount()` at BARE_ROUNDS off an ally-side
 *        active target (and additionally observes that the dummy takes no turn). What its non-zero
 *        proves is that the FIXTURE RUNS A LIVE PATH — the zeros are not coming from cases that
 *        never ran. It says nothing about `__getLegacyVictimFallbackCount`, which is the counter
 *        every zero here reads.
 *      • that CONSULTATION counter's own liveness is pinned CROSS-FILE, at
 *        `damageChannelAccounting.integration.test.ts:422` (see §"WHAT SP-4c STILL HAS TO HANDLE"
 *        below) — the only reading in the corpus that moves it off 0.
 *    Belt and braces: `normalizeRoster.test.ts`'s floor cases prove the un-floored 0-max-HP roster
 *    cannot be built, and `noVictimPlayerTurn.test.ts` pins the no-victim contract directly.
 *
 * ── THE CREDIT COUNTER WAS DELETED IN SP-4c-2c ────────────────────────────────────────────────
 *
 * This file used to read a SECOND counter, `__getDummySinkCreditCount`, which counted rounds in
 * which damage was actually BOOKED against the dummy, and rungs 4c-2b/4c-2c were told to gate their
 * deletions on `credits === 0`. Its last live route was the dummy's own DoT-tick turn: the dummy
 * ticked the containers it carried and credited the applier's scalar channel, reachable whenever the
 * retired `dummyEnemyIsVestigial` gate was false. **SP-4c-2c retired that turn** — the dummy is now
 * dropped from `turnOrderActors` unconditionally — which removed the route. Measured with a
 * console.error at the increment site over the whole suite: 0 hits in 532 files, where the pre-rung
 * tree hit it twice. A counter whose zero cannot be falsified is not evidence but the repo's own
 * fixture-vacuity defect class, so it was deleted outright rather than left as 4c-2d's vacuous gate.
 *
 * PRECISION, kept because the deleted counter's doc drew this line and it still holds: the correct
 * claim is "no shape the suite can build reaches the increment site", NOT "the site is unreachable".
 * It lives in the round-tail scalar branch, not in the dummy's turn body, so any future change that
 * routes scalar damage there lights it up again.
 *
 * ── WHAT SP-4c STILL HAS TO HANDLE ────────────────────────────────────────────────────────────
 *
 * NOTHING, on the player side. The two shapes that used to reach the dummy are both closed:
 * the MID-RUN WHIFF WINDOW (SP-4c-1 ends the match on the turn that wipes a side, so a killed roster
 * produces no whiff rounds — see CORPSE TARGETING) and the 0-max-HP PRESSURE SOURCE (SP-4c-2a floors
 * it at the boundary — see the inverted case below). Deleting the actor is 4c-2d's job.
 *
 * The ENEMY-side reading behind the same counter is a different number and is **rung 4e's** business:
 * consultations that resolve to no victim at all, and consultations that resolve to the heal target
 * itself. Retiring `legacyVictim: healTarget` belongs there — per the epic spec §4.2, "the enemy-side
 * `legacyVictim: healTarget`. Not a dummy: it is the healing calculator's anchor." A max-HP-0 PLAYER
 * roster is correspondingly NOT closed by SP-4c-2a's floor, which is enemy-side only by design — see
 * `damageChannelAccounting.integration.test.ts`'s "a never-targetable PLAYER roster is a CORPSE"
 * case, which still reads a non-zero consultation count against that binding. That reading is what
 * keeps `__getLegacyVictimFallbackCount` itself non-vacuous corpus-wide.
 *
 * ⚠️ ON THE 4c-2b FIX, because it is the one thing here easiest to get backwards: the player side
 * borrowed the enemy side's RETURN VALUE (`tgt: undefined`) but explicitly NOT its skip. An
 * ally-targeted cast is the reason the ship exists — 24 shipped support ships — so the turn RUNS
 * with no victim, its repair/buff lands, and only the victim-derived context is absent. A skip there
 * would have permanently silenced every healer in the game.
 *
 * HISTORICAL, kept as a gloss because it explains the current shape. 4b-1 could only pin "a run
 * with a NON-EMPTY enemy roster never takes the fallback". 4b-2b then refused the empty roster at
 * the normalization boundary, which inverted the old second test ("STILL takes it with an empty
 * roster") into a throw-assertion — and cost this file its own vacuity guard, because that test's
 * `> 0` reading was the only thing proving the consultations counter was wired to anything. Task 7
 * re-homed a liveness proof onto the 0-max-HP pressure-source roster; SP-4c-2a's floor retired THAT
 * shape; the credit counter's DoT-tick route was the third home, and SP-4c-2c retired that too. The
 * `LIVENESS` case's current subject — the no-victim player turn — is the fourth and final one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
    __getNoVictimPlayerTurnCount,
    __resetNoVictimPlayerTurnCount,
} from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { normalizeCombatRoster, MIN_TARGETABLE_MAX_HP } from '../normalizeRoster';
// Fixtures live in __testutils__, NOT in the other test file. Importing from a `.test.ts`
// module executes its `describe` blocks as an import side effect — the suites would run twice,
// under two different files, with two different seeds.
import {
    bareInput,
    bareEnemy,
    bareAlly,
    attackingEnemy,
    BARE_ENEMY_ID,
    BARE_ALLY_ID,
    SECOND_BARE_ENEMY_ID,
} from '../__testutils__/bareRosterFixture';
import { collectTurns } from '../__testutils__/turnOrderTap';

/** `bareInput` fires one 100%-multiplier damage ability off a 10 000 attack, zero crit. */
const PER_CAST = 10_000;
/** `bareInput().numRounds`. */
const BARE_ROUNDS = 2;

/** Who this attacker is recorded as having damaged this round, and for how much. */
const dealtBy = (
    result: ReturnType<typeof runCombat>,
    round: number,
    attackerId: string
): Record<string, number> | undefined => result.rounds[round - 1].perTargetDealt?.[attackerId];

/** The one surviving counter this file reads. Enemy-side only since SP-4c-2b — see the header. */
const consultations = (): number => __getLegacyVictimFallbackCount();

describe('dummy reachability after normalization', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        // SP-4c-2b: module-level like the counter above, so it needs the same per-case reset.
        __resetNoVictimPlayerTurnCount();
    });

    it('FOCUS DAMAGE: the focus attacker resolves a real victim, never the fallback', () => {
        const { result, actorsThatTookTurns } = collectTurns(bareInput());

        // The path ran: the focus took a turn every round and its cast is recorded against the
        // REAL roster member — not the dummy, which is not even in the turn order any more.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(actorsThatTookTurns(1)).not.toContain('enemy');
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });

        expect(consultations()).toBe(0);
    });

    it('TEAM-ACTOR TURNS: a walked ally takes real turns without reaching the fallback', () => {
        // Damage is deliberately excluded (attack 0, empty kit) so this case observes the walked
        // TURN itself — the `actor.kind === 'team'` branch of the turn loop — with no cast to
        // confound it. Its damage-carrying twin is the next case.
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            teamActors: [bareAlly()],
        });

        // The path ran: the ally is in the turn order every round (speed 1 → last).
        expect(actorsThatTookTurns(1)).toEqual(['attacker', BARE_ENEMY_ID, BARE_ALLY_ID]);
        expect(actorsThatTookTurns(BARE_ROUNDS)).toContain(BARE_ALLY_ID);
        // ...and it genuinely dealt nothing, so the zero below is about the TURN, not about damage.
        expect(dealtBy(result, 1, BARE_ALLY_ID)).toBeUndefined();

        expect(consultations()).toBe(0);
    });

    it('WALKED-TEAM DAMAGE: the ally cast site resolves a real victim too', () => {
        // The walked-team cast site is a SEPARATE site from the focus's (its own selectTurnTarget
        // call, its own `teamPositional` gate), so the focus case above does not cover it.
        const { result } = collectTurns({
            ...bareInput(),
            teamActors: [bareAlly({ attack: 7_000 })],
        });

        // The path ran: the ally's own cast is booked per-victim against the real roster member,
        // separately from the focus's, at its own 7 000 magnitude.
        expect(dealtBy(result, 1, BARE_ALLY_ID)).toEqual({ [BARE_ENEMY_ID]: 7_000 });
        expect(dealtBy(result, BARE_ROUNDS, BARE_ALLY_ID)).toEqual({ [BARE_ENEMY_ID]: 7_000 });
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });

        expect(consultations()).toBe(0);
    });

    it('ENEMY TURNS: the enemy→player direction resolves a real victim too', () => {
        // Team symmetry is a LOCKED project rule, and the enemy side's `legacyVictim` is a
        // different object entirely (the heal target, a real player actor), so the player-side
        // cases say nothing about this direction. The enemy is given a real attack + kit: a
        // 0-attack positioned enemy is stream-inert and would evidence nothing.
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            enemyAttackers: attackingEnemy(),
        });

        // The path ran: the enemy took a turn and BOOKED damage onto the focus.
        expect(actorsThatTookTurns(1)).toContain(BARE_ENEMY_ID);
        expect(dealtBy(result, 1, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });

        expect(consultations()).toBe(0);
    });

    it('CORPSE TARGETING: the whiff CONSULTS the fallback but books nothing against it', () => {
        // THIS SHAPE NO LONGER EXISTS, and that is what the case now pins. It used to be the one
        // shape that legitimately consulted the fallback mid-run — 5 000 max HP dies to the
        // round-1 cast, and because `resolvesPositionalVictim` keys on MAX hp, rounds 2-3 stayed
        // positional, selected nobody, and whiffed against the corpse.
        //
        // SP-4c-1 deleted the window instead of accounting for it: killing the roster WIPES the
        // enemy side, so the match ends on that turn and there are no rounds 2-3 to whiff in. The
        // fallback is therefore never consulted here at all.
        const { result, destroyed } = collectTurns({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        // The path ran: the victim really was killed, and the killing round really did book.
        expect(destroyed()).toEqual([BARE_ENEMY_ID]);
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        // The run ENDS there — the load-bearing assertion. Without it, a change that resurrects
        // the whiff rounds would leave every other expectation here still passing.
        expect(result.rounds).toHaveLength(1);

        // The counter does not move: no whiff round means no consultation.
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('DEATH RETARGETING: the cast moves to the next living member, not to the fallback', () => {
        // Two placed members; the front one dies to the round-1 cast and selection must walk to the
        // survivor behind it. Distinct from the corpse case: here a living victim still exists, so
        // even the CONSULTATION count must stay zero.
        const { result, destroyed } = collectTurns({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: [
                ...bareEnemy({ position: 'M4', stats: { hp: 5_000 } }),
                ...bareEnemy({ id: SECOND_BARE_ENEMY_ID, position: 'M3' }),
            ],
        });

        // The path ran: the front member died, and the recorded victim CHANGED afterwards.
        expect(destroyed()).toEqual([BARE_ENEMY_ID]);
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, 2, 'attacker')).toEqual({ [SECOND_BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, 3, 'attacker')).toEqual({ [SECOND_BARE_ENEMY_ID]: PER_CAST });

        expect(consultations()).toBe(0);
    });

    // SP-4b-2b INVERTED THIS TEST. It used to read "STILL takes it with an empty roster — 4b-2
    // closes this, and the counter proves it is live", running an empty-roster fight and asserting
    // `__getLegacyVictimFallbackCount() > 0`. 4b-2b is that closure: the empty roster is now
    // refused at the normalization boundary, so the shape that reached the fallback no longer
    // exists and the old premise is illegal by contract.
    //
    // The LIVENESS half of that old assertion (the reason the zeros above are not vacuous) is not
    // expressible through a throw-assertion, so it lives in the `LIVENESS` case below. It has been
    // re-homed three times since — see the header for the chain and why each home was retired.
    it('REFUSES an empty roster outright — the shape that reached the fallback is now illegal', () => {
        const noEnemy = { ...bareInput(), enemyAttackers: [] };
        expect(() => runCombat(noEnemy)).toThrow(/enemyAttackers is empty/);
    });
});

describe('the shapes that used to reach the dummy sink', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        // SP-4c-2b: module-level like the counter above, so it needs the same per-case reset.
        __resetNoVictimPlayerTurnCount();
    });

    it('a pressure-source roster is FLOORED, so it can no longer reach the sink at all', () => {
        // SP-4c-2a INVERTED THIS TEST, the same way SP-4b-2b inverted the empty-roster case above.
        // It used to read BARE_ROUNDS consultations AND BARE_ROUNDS credits, and was this file's
        // VACUITY GUARD — the only proof the readings were wired to anything. A max-HP-0 roster was
        // placed but unhittable, so `resolvesPositionalVictim` kept the run non-positional and the
        // focus's whole output drained into the dummy's scalar channel.
        //
        // The boundary now floors that member to MIN_TARGETABLE_MAX_HP, so the shape is gone: the
        // cast resolves a real victim and books per-victim. `normalizeRoster.test.ts`'s floor cases
        // additionally prove the un-floored shape cannot be constructed. The liveness proof moved on
        // (twice — see the header); it now lives in the `LIVENESS` case below, on the no-victim
        // player turn. The surviving counter goes away with the dummy in SP-4c-2d.
        const result = runCombat({
            ...bareInput(),
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
        });

        // The path ran: the floored member really is the victim, at full cast magnitude, every
        // round — 1 000 000 max HP is far above BARE_ROUNDS * PER_CAST, so it never dies and the
        // run is not cut short by 4c-1's wipe rule.
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(result.rounds).toHaveLength(BARE_ROUNDS);

        expect(consultations()).toBe(0);
    });

    it('the floor is what does it: the roster arrives at the engine already hittable', () => {
        // Pins the MECHANISM, not just the outcome — without this, a future change that made the
        // dummy unreachable for some other reason would leave the case above green while the floor
        // silently stopped working.
        const floored = normalizeCombatRoster({
            ...bareInput(),
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
        });
        expect(floored.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });

    it('a live roster consults nothing', () => {
        runCombat(bareInput());

        expect(consultations()).toBe(0);
    });

    it('LIVENESS: the no-victim player turn is what keeps this file honest now', () => {
        // THIS FILE'S VACUITY GUARD, re-homed for the third and final time — and the change of
        // SUBJECT is the point. Every other case here reads 0, and a zero from a reading wired to
        // nothing means nothing, so exactly one case must read non-zero off a live path.
        //
        // WHAT MOVED IN SP-4c-2c. This case used to prove `__getDummySinkCreditCount` could move,
        // via the dummy's own DoT-tick turn — the one route SP-4c-2a's floor did not close. That
        // rung retired the dummy's turn, which removed the route, and a counter nothing can move is
        // worse than no counter: the credit counter was therefore deleted outright rather than left
        // reading an unfalsifiable 0. Measured: with the turn retired, a console.error at the
        // increment site hit 0 times across all 532 suite files.
        //
        // The guard now rides on `__getNoVictimPlayerTurnCount`, which SP-4c-2b introduced and which
        // reads BARE_ROUNDS on exactly this shape: the focus is positioned with an ALLY-side active
        // target, so `resolvePositionalTarget` returns null every round, `selectTurnTarget` answers
        // `tgt: undefined` on the player side, and the turn RUNS with no victim (it does not skip —
        // that distinction is 4c-2b's whole subject and 24 shipped support ships depend on it).
        const DUMMY_HP = 10_000;
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
            enemyHp: DUMMY_HP,
        });

        // The path RAN: the focus took an ally-targeted turn every round and booked nothing against
        // anybody, which is what a no-victim turn looks like from outside.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(dealtBy(result, 1, 'attacker')).toBeUndefined();
        // ...and the dummy is not in the order at all — the SP-4c-2c switch, observed here rather
        // than assumed, on the very shape that used to be the one exception to it.
        expect(actorsThatTookTurns(1)).not.toContain('enemy');
        expect(actorsThatTookTurns(BARE_ROUNDS)).not.toContain('enemy');

        // The non-zero reading, and the whole reason this case exists.
        expect(__getNoVictimPlayerTurnCount()).toBe(BARE_ROUNDS);
        // Enemy-side consultations stay 0: the roster member resolves the targetable focus.
        expect(consultations()).toBe(0);
    });

    it('the whiff window is GONE, so the divergence it produced reads a plain 0', () => {
        // HISTORY, because it is the reading that shaped the whole rung plan. This case used to read
        // 2 consultations with 0 credits — the mid-run whiff window, the one shape that consulted
        // the fallback without ever crediting it. That divergence is why SP-4c was originally told
        // to gate its deletion on the CREDIT counter and never on the consultations counter.
        //
        // Every source of that divergence is now closed. SP-4c-1 removed the whiff window (the kill
        // ends the match). The 0-max-HP pressure source directly above used to produce it here too —
        // a never-alive actor is never destroyed, so it was not a wipe, its run continued, and it
        // consulted AND credited every round — and SP-4c-2a floored that shape at the normalization
        // boundary before the engine ever sees it (see the case above, and `MIN_TARGETABLE_MAX_HP`
        // in `normalizeRoster.ts`). This case therefore reads a plain 0.
        //
        // AND THE PLAN CHANGED WITH IT. SP-4c-2c retired the dummy's turn, which removed the last
        // route into the credit counter — so the counter was deleted instead of becoming 4c-2d's
        // gate, because a zero nothing can falsify is not evidence. The header carries the
        // measurement and the precise form of the claim.
        runCombat({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        expect(consultations()).toBe(0);
    });
});
