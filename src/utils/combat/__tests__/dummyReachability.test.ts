/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * ── WHAT THIS FILE GUARANTEES (SP-4b-2b Task 7 closed both of its recorded gaps) ───────────────
 *
 * 1. **COVERAGE — six paths, not one.** The file used to exercise `bareInput()` alone: a single
 *    focus-attacker damage cast, plus an empty roster. A zero from one shape only ever meant "this
 *    shape does not reach the fallback", never "no shape does" (raised on PR #324, and correct). It
 *    now runs a case per engine path that resolves a victim:
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
 * 2. **SEMANTICS — two counters, and only one of them can be required to be zero.**
 *    `__getLegacyVictimFallbackCount` counts CONSULTATIONS of `tb.legacyVictim`: selection handed
 *    the fallback object back. `__getDummySinkCreditCount` (added by Task 7) counts rounds in which
 *    damage was actually BOOKED against the dummy — its HP declined. The two come apart, and the
 *    "credits are distinct from consultations" block below pins them apart on purpose.
 *
 * ── WHAT SP-4c STILL HAS TO HANDLE ────────────────────────────────────────────────────────────
 *
 * NOTHING, on the player side's REACHABILITY — but the fallback is still CONSULTED, and by a
 * different consumer than this file was written to describe.
 *
 * The MID-RUN WHIFF WINDOW is gone: SP-4c-1 ends the match on the turn that wipes a side, so a
 * killed roster produces no whiff rounds (see the CORPSE TARGETING case). The 0-max-HP PRESSURE
 * SOURCE is gone too: SP-4c-2a floors it at the boundary (see the inverted case below). Both were
 * quoted as the reason 4c must gate on the CREDIT counter rather than the consultations counter,
 * and both are now closed — measured 0 credits corpus-wide.
 *
 * What remains, and what rung 4c-2b owns, is scoped to the PLAYER side's `legacyVictim` — the
 * dummy `enemy` this whole file is about. `selectTurnTarget` increments the shared consultation
 * counter at ONE site for BOTH sides, but the two `TurnBindings.legacyVictim` objects it feeds are
 * not the same kind of thing (see `TurnBindings` in `engine.ts`): the player side's is the dummy;
 * the enemy side's is `healTarget`, a real player actor, not a dummy at all. On the player side, an
 * ALLY-TARGETING player actor consults the fallback on every turn, because `resolvePositionalTarget`
 * returns null for an ally-side parsed target and selection falls through. Measured at 4,188
 * player-side (dummy) consultations across the suite on `main` @ `8d2c2a61` — the real keystone for
 * THIS rung, and NOT the whiff window this header used to name. The fix is the one the enemy side
 * already has: return `tgt: undefined` and let the turn skip its attack.
 *
 * The enemy-side reading is a DIFFERENT number behind the same counter, and it is not this rung's
 * job: 1,341 consultations resolve to no victim at all and 335 resolve to the heal target itself.
 * Retiring `legacyVictim: healTarget` is rung 4e's job, not 4c's — per the epic spec §4.2, "the
 * enemy-side `legacyVictim: healTarget`. Not a dummy: it is the healing calculator's anchor." A
 * max-HP-0 PLAYER roster is correspondingly NOT closed by SP-4c-2a's floor, which is enemy-side
 * only by design — see `damageChannelAccounting.integration.test.ts`'s "a never-targetable PLAYER
 * roster is a CORPSE" case, which still reads a non-zero consultation count against that binding.
 *
 * ⚠️ THIS FILE NO LONGER CARRIES ITS OWN VACUITY GUARD. Every shape it can construct reads 0/0, so
 * a counter silently wired to nothing would leave all six cases green. The compensating control is
 * external and deliberate: `normalizeRoster.test.ts`'s floor cases prove the un-floored shape
 * cannot be built, and each case here still asserts something POSITIVE about the path it claims (a
 * `turn-started`, a `perTargetDealt` row naming the victim, a `ship-destroyed`, a changed victim
 * id) so a zero from a case that never ran its path stays impossible. The counters go away entirely
 * in SP-4c-2d.
 *
 * HISTORICAL, kept as a gloss because it explains the current shape. 4b-1 could only pin "a run
 * with a NON-EMPTY enemy roster never takes the fallback". 4b-2b then refused the empty roster at
 * the normalization boundary, which inverted the old second test ("STILL takes it with an empty
 * roster") into a throw-assertion — and cost this file its own vacuity guard, because that test's
 * `> 0` reading was the only thing proving the consultations counter was wired to anything. Task 7
 * re-homed a liveness proof here (see "the counter is LIVE" below); the sibling reading in
 * `damageChannelAccounting.integration.test.ts` remains as corroboration, no longer as the only
 * evidence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
    __getDummySinkCreditCount,
    __resetDummySinkCreditCount,
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

/** Both counters at once — every case reads them as a pair. */
const counters = () => ({
    consulted: __getLegacyVictimFallbackCount(),
    credited: __getDummySinkCreditCount(),
});

describe('dummy reachability after normalization', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        __resetDummySinkCreditCount();
    });

    it('FOCUS DAMAGE: the focus attacker resolves a real victim, never the fallback', () => {
        const { result, actorsThatTookTurns } = collectTurns(bareInput());

        // The path ran: the focus took a turn every round and its cast is recorded against the
        // REAL roster member — not the dummy, which is not even in the turn order any more.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(actorsThatTookTurns(1)).not.toContain('enemy');
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
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

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
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

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
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

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
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

        // Neither counter moves: no whiff round means no consultation, and no credit either.
        expect(__getLegacyVictimFallbackCount()).toBe(0);
        expect(__getDummySinkCreditCount()).toBe(0);
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

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
    });

    // SP-4b-2b INVERTED THIS TEST. It used to read "STILL takes it with an empty roster — 4b-2
    // closes this, and the counter proves it is live", running an empty-roster fight and asserting
    // `__getLegacyVictimFallbackCount() > 0`. 4b-2b is that closure: the empty roster is now
    // refused at the normalization boundary, so the shape that reached the fallback no longer
    // exists and the old premise is illegal by contract.
    //
    // The LIVENESS half of that old assertion (the reason the zeros above are not vacuous) is not
    // expressible through a throw-assertion, so it lives in "the counter is LIVE" below, on the
    // pressure-source shape — the other roster that reaches the sink through the identical
    // MAX-hp gate.
    it('REFUSES an empty roster outright — the shape that reached the fallback is now illegal', () => {
        const noEnemy = { ...bareInput(), enemyAttackers: [] };
        expect(() => runCombat(noEnemy)).toThrow(/enemyAttackers is empty/);
    });
});

describe('sink CREDITS are distinct from fallback CONSULTATIONS', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        __resetDummySinkCreditCount();
    });

    it('a pressure-source roster is FLOORED, so it can no longer reach the sink at all', () => {
        // SP-4c-2a INVERTED THIS TEST, the same way SP-4b-2b inverted the empty-roster case above.
        // It used to read `{ consulted: BARE_ROUNDS, credited: BARE_ROUNDS }` and was this file's
        // VACUITY GUARD — the only proof the counters were wired to anything. A max-HP-0 roster was
        // placed but unhittable, so `resolvesPositionalVictim` kept the run non-positional and the
        // focus's whole output drained into the dummy's scalar channel.
        //
        // The boundary now floors that member to MIN_TARGETABLE_MAX_HP, so the shape is gone: the
        // cast resolves a real victim and books per-victim. Every reachable shape in this file
        // therefore reads 0/0, and the liveness proof has moved OUT of this file — to
        // `normalizeRoster.test.ts`'s floor cases, which prove the un-floored shape cannot be
        // constructed. The counters are deleted outright in SP-4c-2d.
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

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
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

    it('a live roster consults nothing and credits nothing', () => {
        runCombat(bareInput());

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
    });

    it('the whiff window is GONE, so the two counters no longer come apart', () => {
        // HISTORY, because it changes what SP-4c-2 may gate on. This case used to read
        // `{ consulted: 2, credited: 0 }` — the mid-run whiff window, the one shape that consulted
        // the fallback without ever crediting it. That reading is why SP-4c was told to gate its
        // deletion on the CREDIT counter and never on the consultations counter.
        //
        // SP-4c-1 removed the window (the kill ends the match), so this shape now reads 0/0. The
        // 0-max-HP pressure source directly above used to be the divergence case that mattered here
        // too — a never-alive actor is never destroyed, so it was not a wipe and its run continued,
        // consulting AND crediting every round. SP-4c-2a closed that shape as well, by flooring it
        // at the normalization boundary before the engine ever sees it (see the case above, and
        // `MIN_TARGETABLE_MAX_HP` in `normalizeRoster.ts`). Both of this file's divergence sources
        // are gone, so every player-side shape it can construct reads 0/0, and either counter would
        // serve as SP-4c-2's gate on THIS file's evidence alone. The credit counter remains the
        // correct choice regardless — it is the one that means "the dummy absorbed nothing", and it
        // stays correct once other files' shapes (e.g. the enemy-side heal-target fallback) are
        // considered too.
        runCombat({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
    });
});
