/**
 * SP-4b-1 → SP-4e. Cluster C (`selected ?? tb.legacyVictim`) was the KEYSTONE of the whole ladder:
 * once nothing took that fallback, clusters B/D/E/F/G fell out behind it. **SP-4e (#335) deleted the
 * field.** There is no per-side fallback victim on EITHER side any more, so this file's subject
 * changes from "does anything reach the fallback?" to "does the ONE no-victim rule hold on both
 * sides, and is the fallback really gone?".
 *
 * ── WHAT THIS FILE GUARANTEES ─────────────────────────────────────────────────────────────────
 *
 * 1. **COVERAGE — six paths, not one.** The file used to exercise `bareInput()` alone: a single
 *    focus-attacker damage cast, plus an empty roster. A zero from one shape only ever meant "this
 *    shape does not reach the fallback", never "no shape does" (raised on PR #324, and correct). It
 *    now runs a case per engine path that resolves a victim, and each asserts that the path resolves
 *    a REAL victim rather than running a no-victim turn:
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
 * 2. **THE COUNTER CONTRACT — ONE counter, BOTH sides.** `__getNoVictimTurnCount` counts turns that
 *    resolved NO VICTIM, on either side. Read it through the `noVictimTurns()` helper below.
 *
 *    Until SP-4e there were TWO counters and every zero in this file read the OTHER one:
 *    `legacyVictimFallbackCount` counted CONSULTATIONS of the fallback object, which is a strictly
 *    different event from "the turn had no victim" — the player side had no object to consult after
 *    SP-4c-2b, the enemy side did, and the file had to spell out which zero meant what. That whole
 *    distinction is gone with the field. The zeros below and the non-zero in the `LIVENESS` case are
 *    now the SAME number, which is what lets this file carry its own vacuity guard instead of
 *    borrowing one cross-file (it used to point at
 *    `damageChannelAccounting.integration.test.ts`'s corpse case for that).
 *
 * 3. **THE FIELD IS GONE, and a grep proves it.** `TurnBindings.legacyVictim` is not deprecated, it
 *    is deleted; the `NO LEGACY VICTIM SURVIVES` case walks the whole `src` tree and fails on any
 *    reintroduction. A comment cannot fail. This is the tripwire that makes the rest of the file's
 *    claims about "there is no fallback" checkable rather than asserted.
 *
 * ── WHAT SP-4e MOVED, AND WHERE (spec §5's measured table) ────────────────────────────────────
 *
 * 1,680 enemy-side fallback consultations across 25 files on `af4f05ae`, in exactly three shapes.
 * They are the population this file's counter absorbed:
 *
 *   | class | rows / files | fingerprint                                      | before → after            |
 *   |-------|--------------|--------------------------------------------------|---------------------------|
 *   | C1    | 1,341 / 12   | `parsedSide=enemy`, dps, every victim dead, no    | `tgt: undefined` →        |
 *   |       |              | anchor                                           | RUNS a no-victim turn     |
 *   | C2    | 324 / 10     | `parsedSide=ally`, battle, roster ALIVE + placed, | resolved the FOCUS PLAYER |
 *   |       |              | anchor alive                                     | → no victim               |
 *   | C3    | 15 / 3       | healing, enemy-facing, anchor DEAD               | dead-target skip →        |
 *   |       |              |                                                  | a no-victim turn, same    |
 *   |       |              |                                                  | (nothing booked either way)|
 *
 * C2 is the class with observable consequences and the one #335's own narrative missed: those turns
 * ALREADY RAN, against a fabricated victim. `twoTeamBattle.test.ts`'s "an ally-targeted enemy
 * supporter, with a LIVING placed player roster, resolves NO victim and still lands its support"
 * pins it directly. C1's rows were already skipping, so they move only where a no-victim turn has a
 * self-effect. C3's three files (`damageChannelAccounting.integration`, `perVictimDotTick.integration`,
 * `destroyedRoundUnification`) book nothing on either route and did not move.
 *
 * ── THE CREDIT COUNTER WAS DELETED IN SP-4c-2c ────────────────────────────────────────────────
 *
 * This file used to read a THIRD counter, `__getDummySinkCreditCount`, which counted rounds in
 * which damage was actually BOOKED against the dummy, and rungs 4c-2b/4c-2c were told to gate their
 * deletions on `credits === 0`. Its last live route was the dummy's own DoT-tick turn: the dummy
 * ticked the containers it carried and credited the applier's scalar channel, reachable whenever the
 * retired `dummyEnemyIsVestigial` gate was false. **SP-4c-2c retired that turn** — the dummy is now
 * dropped from `turnOrderActors` unconditionally — which removed the route. Measured with a
 * console.error at the increment site over the whole suite: 0 hits in 532 files, where the pre-rung
 * tree hit it twice. A counter whose zero cannot be falsified is not evidence but the repo's own
 * fixture-vacuity defect class, so it was deleted outright rather than left as 4c-2d's vacuous gate.
 *
 * ── WHAT IS LEFT FOR A LATER RUNG ─────────────────────────────────────────────────────────────
 *
 * NOTHING on this axis. Both sides' fallbacks are deleted; the dummy actor is deleted (SP-4c-2d);
 * the shapes that used to reach it are closed twice over — the MID-RUN WHIFF WINDOW (SP-4c-1 ends
 * the match on the turn that wipes a side, so a killed roster produces no whiff rounds — see CORPSE
 * TARGETING) and the 0-max-HP PRESSURE SOURCE (SP-4c-2a floors it at the boundary — see the
 * inverted case below).
 *
 * ⚠️ ON THE NO-VICTIM RULE, because it is the one thing here easiest to get backwards: a no-victim
 * turn RUNS. It borrows the old fallback's absence of a victim but explicitly NOT the enemy path's
 * old skip. An ally-targeted cast is the reason the ship exists — 24 shipped support ships on the
 * player side, and their enemy-side counterparts — so the turn runs, its repair/buff lands, and only
 * the victim-derived context is absent. A skip there would permanently silence every healer in the
 * game, on whichever side it was applied.
 *
 * HISTORICAL, kept as a gloss because it explains the current shape. 4b-1 could only pin "a run
 * with a NON-EMPTY enemy roster never takes the fallback". 4b-2b then refused the empty roster at
 * the normalization boundary, which inverted the old second test ("STILL takes it with an empty
 * roster") into a throw-assertion — and cost this file its own vacuity guard, because that test's
 * `> 0` reading was the only thing proving the consultations counter was wired to anything. Task 7
 * re-homed a liveness proof onto the 0-max-HP pressure-source roster; SP-4c-2a's floor retired THAT
 * shape; the credit counter's DoT-tick route was the third home, and SP-4c-2c retired that too. The
 * `LIVENESS` case's subject — the no-victim turn — is the fourth home, and since SP-4e it reads the
 * same counter as every zero here, so the guard is finally in-file rather than cross-file.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getNoVictimTurnCount,
    __resetNoVictimTurnCount,
    __getEnemySiteVictimTurnCounts,
    __resetEnemySiteVictimTurnCounts,
    SENTINEL_ENEMY_ACTOR_ID,
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

/** The one counter this file reads. Since SP-4e it covers BOTH sides — see the header, §2. */
const noVictimTurns = (): number => __getNoVictimTurnCount();

describe('no-victim turns after normalization', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetNoVictimTurnCount();
    });

    it('FOCUS DAMAGE: the focus attacker resolves a real victim, never a no-victim turn', () => {
        const { result, actorsThatTookTurns } = collectTurns(bareInput());

        // The path ran: the focus took a turn every round and its cast is recorded against the
        // REAL roster member. The sentinel takes no turn because since SP-4c-2d no actor carries
        // that id at all (fenced structurally in `sentinelActorIdReservation.test.ts`); this line
        // is kept as a cheap turn-order regression pin, not as the primary fence.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(actorsThatTookTurns(1)).not.toContain(SENTINEL_ENEMY_ACTOR_ID);
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });

        expect(noVictimTurns()).toBe(0);
    });

    it('TEAM-ACTOR TURNS: a walked ally takes real turns and still resolves a victim', () => {
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

        expect(noVictimTurns()).toBe(0);
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

        expect(noVictimTurns()).toBe(0);
    });

    it('ENEMY TURNS: the enemy→player direction resolves a real victim too', () => {
        // Team symmetry is a LOCKED project rule, and until SP-4e this direction had a fallback
        // object the player side did not (the heal target), so the player-side cases said nothing
        // about it. It is now the SAME rule and the SAME counter — which is exactly why this case
        // has to keep asserting for itself rather than inheriting. The enemy is given a real attack
        // + kit: a 0-attack positioned enemy is stream-inert and would evidence nothing.
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            enemyAttackers: attackingEnemy(),
        });

        // The path ran: the enemy took a turn and BOOKED damage onto the focus.
        expect(actorsThatTookTurns(1)).toContain(BARE_ENEMY_ID);
        expect(dealtBy(result, 1, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });

        expect(noVictimTurns()).toBe(0);
    });

    it('CORPSE TARGETING: the whiff window is gone, so nothing runs victimless here', () => {
        // THIS SHAPE NO LONGER EXISTS, and that is what the case now pins. It used to be the one
        // shape that legitimately consulted the fallback mid-run — 5 000 max HP dies to the
        // round-1 cast, and because `resolvesPositionalVictim` keys on MAX hp, rounds 2-3 stayed
        // positional, selected nobody, and whiffed against the corpse.
        //
        // SP-4c-1 deleted the window instead of accounting for it: killing the roster WIPES the
        // enemy side, so the match ends on that turn and there are no rounds 2-3 to whiff in.
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

        // The counter does not move: no whiff round means no victimless turn.
        expect(noVictimTurns()).toBe(0);
    });

    it('DEATH RETARGETING: the cast moves to the next living member, not to nobody', () => {
        // Two placed members; the front one dies to the round-1 cast and selection must walk to the
        // survivor behind it. Distinct from the corpse case: here a living victim still exists, so
        // resolution must SUCCEED rather than degrade into a no-victim turn.
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

        expect(noVictimTurns()).toBe(0);
    });

    // SP-4b-2b INVERTED THIS TEST. It used to read "STILL takes it with an empty roster — 4b-2
    // closes this, and the counter proves it is live", running an empty-roster fight and asserting
    // the consultation counter `> 0`. 4b-2b is that closure: the empty roster is now refused at the
    // normalization boundary, so the shape that reached the fallback no longer exists and the old
    // premise is illegal by contract.
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
        __resetNoVictimTurnCount();
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
        // (twice — see the header); it now lives in the `LIVENESS` case below.
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

        expect(noVictimTurns()).toBe(0);
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

    // SP-4c-2d DELETED a case here, titled 'a live roster consults nothing'. It ran `bareInput()`
    // and asserted the zero — the FOCUS DAMAGE fixture exactly, with no positive half, so it was a
    // strictly weaker duplicate: a zero it produced could equally have come from a run that did
    // nothing. FOCUS DAMAGE makes the same claim with a `turn-started` and a `perTargetDealt` row
    // behind it. Per this file's own standard (see the header, §1), every surviving case keeps a
    // positive half.

    it('LIVENESS: the no-victim turn is what keeps this file honest — same counter as the zeros', () => {
        // THIS FILE'S VACUITY GUARD. Since SP-4e it is finally a guard over the SAME NUMBER every
        // zero above reads, which is the whole point of collapsing the two counters into one: before
        // the rung this case read `noVictimPlayerTurnCount` while every zero read
        // `legacyVictimFallbackCount`, so its non-zero proved only that the FIXTURE RUNS A LIVE PATH
        // and the zeros' own counter had to be pinned cross-file (in
        // `damageChannelAccounting.integration.test.ts`'s corpse case). Now a broken reading cannot
        // hide: the same accessor that reads BARE_ROUNDS here reads 0 in the six coverage cases.
        //
        // WHAT MOVED IN SP-4c-2c. This case used to prove `__getDummySinkCreditCount` could move,
        // via the dummy's own DoT-tick turn — the one route SP-4c-2a's floor did not close. That
        // rung retired the dummy's turn, which removed the route, and a counter nothing can move is
        // worse than no counter: the credit counter was therefore deleted outright rather than left
        // reading an unfalsifiable 0. Measured: with the turn retired, a console.error at the
        // increment site hit 0 times across all 532 suite files.
        //
        // THE SHAPE: the focus is positioned with an ALLY-side active target, so
        // `resolvePositionalTarget` returns null every round, `selectTurnTarget` answers
        // `tgt: undefined`, and the turn RUNS with no victim (it does not skip — that distinction is
        // SP-4c-2b's whole subject and 24 shipped support ships depend on it). No `enemyHp` override:
        // it used to be set here (a `DUMMY_HP` const) to size the dummy sink, and nothing has read it
        // since the corrosion derivation that needed it went.
        const { result, actorsThatTookTurns } = collectTurns({
            ...bareInput(),
            position: 'M4',
            target: { raw: 'ally-team', side: 'ally', selection: 'team' },
            pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        });

        // The path RAN: the focus took an ally-targeted turn every round and booked nothing against
        // anybody, which is what a no-victim turn looks like from outside.
        expect(actorsThatTookTurns(1)).toContain('attacker');
        expect(dealtBy(result, 1, 'attacker')).toBeUndefined();
        // ...and the sentinel id is not in the order at all — the SP-4c-2c switch observed on the
        // very shape that used to be its one exception, and since SP-4c-2d also a consequence of
        // there being no such actor to schedule.
        expect(actorsThatTookTurns(1)).not.toContain(SENTINEL_ENEMY_ACTOR_ID);
        expect(actorsThatTookTurns(BARE_ROUNDS)).not.toContain(SENTINEL_ENEMY_ACTOR_ID);

        // The non-zero reading, and the whole reason this case exists. EXACTLY BARE_ROUNDS: the
        // focus contributes one per round, and the enemy-side roster member resolves the targetable
        // focus, so it contributes none. A 3 here would mean the ENEMY side lost a resolution it
        // used to have — which is the regression the counter's widening to both sides now catches.
        expect(noVictimTurns()).toBe(BARE_ROUNDS);
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
        const { result, destroyed } = collectTurns({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        // POSITIVE HALF (SP-4c-2d): this case used to assert the zero alone, which is the vacuity
        // shape this file's header forbids — a zero from a run that never reached the whiff window
        // for some unrelated reason would read identically. The window's absence is only meaningful
        // if the kill that used to OPEN it still happens, so pin that: the member dies to the
        // round-1 cast, and the run ends there instead of playing rounds 2-3 against the corpse.
        expect(destroyed()).toEqual([BARE_ENEMY_ID]);
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(result.rounds).toHaveLength(1);

        expect(noVictimTurns()).toBe(0);
    });
});

/**
 * SP-4e fix wave 1 — the OTHER unfalsifiable claim this rung created, made executable.
 *
 * #335 deleted the `|| tgt === undefined` arm from the enemy site's turn skip, which left
 * `skipDeadTargetTurn` with one entrant: a RESOLVED victim that is already dead. The engine carries
 * a measured claim (0 hits across the whole suite, where the pre-rung tree hit it in 4 files) plus a
 * structural argument that the precondition is now unconstructible — `resolvePositionalTarget`
 * builds its `byCell` from `position !== undefined && currentHp > 0` and every return path draws
 * from that map or returns null, and nothing between the call and the check mutates HP.
 *
 * The rung shipped that as a 20-line comment while giving `legacyVictim` a tree-walking tripwire —
 * and, worse, RELABELLED the two `twoTeamBattle` cases that used to reach the branch by accident, so
 * nothing covered it at all. This is the replacement. It reads the branch's own precondition
 * (`dead`) BEFORE the `skillNeedsOpposingVictim` gate narrows it, which is the stronger claim: a
 * dead resolved victim is IMPOSSIBLE, not merely harmless.
 *
 * NON-VACUITY is the whole difficulty with a zero over an unsatisfiable branch — the repo's own
 * fixture-vacuity defect class in counter form. Two things answer it:
 *  1. IN-SUITE: `resolved` counts the same check's live arm from the same three lines, so a
 *     `dead: 0` next to a `resolved: 3` proves the instrument is wired to a site that fires. A
 *     broken reading (wrong accessor, un-run fixture, a check that moved) reads `resolved: 0` and
 *     fails here.
 *  2. BY MUTATION, recorded because no fixture can do it: dropping the `&& a.currentHp > 0` conjunct
 *     from `positionalBinding.ts`'s `byCell` makes a corpse resolvable, and the second case below
 *     then reads `dead: 2` and goes RED. That is the proof that this zero is a finding rather than a
 *     tautology (task-5-report.md, fix wave 1).
 */
describe('A DEAD RESOLVED VICTIM IS UNCONSTRUCTIBLE', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetEnemySiteVictimTurnCounts();
    });

    it('LIVENESS + ZERO: the enemy site resolves a LIVING victim on every turn it takes', () => {
        const { result } = collectTurns({
            ...bareInput(),
            enemyAttackers: attackingEnemy(),
        });

        // The path ran: the enemy acted and booked onto the focus, both rounds.
        expect(dealtBy(result, 1, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });

        // The non-zero half — the reading that makes the zero mean something.
        expect(__getEnemySiteVictimTurnCounts()).toEqual({ resolved: BARE_ROUNDS, dead: 0 });
    });

    it('a player victim KILLED mid-run is RETARGETED, never re-resolved as a corpse', () => {
        // The hardest shape available: make the enemy's own resolved victim die to the enemy's own
        // cast and keep the fight going. The focus holds exactly two casts' worth of HP, and a
        // second placed player actor (M3, behind the focus at the M4 front) keeps the player side
        // from being wiped — SP-4c-1 would otherwise end the match on the killing turn and there
        // would be no later turn to re-resolve anything in. `mode: 'battle'` is load-bearing for
        // the same reason: a DPS measurement run terminates on the focus's own death (engine.ts's
        // focus-death exit), so rounds 3-4 would not exist to be observed.
        const { result, destroyed } = collectTurns({
            ...bareInput(),
            mode: 'battle',
            hp: 2 * PER_CAST,
            numRounds: 4,
            enemyAttackers: attackingEnemy(),
            teamActors: [{ ...bareAlly(), position: 'M3' }],
        });

        // The path ran: the enemy really did kill its own victim, and really did keep acting after.
        expect(destroyed()).toEqual(['attacker']);
        expect(dealtBy(result, 1, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });
        expect(dealtBy(result, 2, BARE_ENEMY_ID)).toEqual({ attacker: PER_CAST });
        // ...and the victim MOVED to the survivor rather than staying on the corpse. This is the
        // same fact the counter reports, observed from outside: a corpse is not resolvable.
        expect(dealtBy(result, 3, BARE_ENEMY_ID)).toEqual({ [BARE_ALLY_ID]: PER_CAST });
        expect(dealtBy(result, 4, BARE_ENEMY_ID)).toEqual({ [BARE_ALLY_ID]: PER_CAST });

        expect(__getEnemySiteVictimTurnCounts()).toEqual({ resolved: 4, dead: 0 });
    });
});

/**
 * SP-4e — the field is DELETED, not deprecated, and this is the executable proof.
 *
 * Every claim above about "there is no fallback victim" is only as strong as the absence of the
 * thing. A comment cannot fail; a grep can. The same walk-the-tree shape
 * `rateGateSeedingOrder.test.ts` uses for its own ordering tripwire.
 *
 * It greps CODE, not PROSE. Three rungs of this ladder recorded what `legacyVictim` used to be, in
 * this file's own header and in a dozen engine/adapter/test comments, and that history is worth
 * keeping — the failure mode this repo keeps hitting is a comment that outlived its subject, not a
 * comment that names a deleted one. So comment-only lines are stripped before the match, which is
 * also why the tripwire cannot police THIS file (its regex literal and its self-test strings are
 * real code). That exemption is the one hole, and `tsc` covers it: a reintroduced `tb.legacyVictim`
 * anywhere else is a type error against a `TurnBindings` that has no such field.
 */
const SRC_ROOT = join(__dirname, '..', '..', '..');
/** `legacyVictim` as an identifier, anywhere — a read, a write, a property, a declaration. */
const LEGACY_VICTIM = /\blegacyVictim\b/;
/** Whole-line comments (`//…`, `/*…`, ` *…`). Trailing comments after code are left in, which only
 *  makes the tripwire STRICTER — there is no risk of a false pass from that direction. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
/** This file defines the tripwire, so it necessarily contains the identifier in real code. */
const SELF = join(__dirname, 'dummyReachability.test.ts');

const codeOf = (file: string): string =>
    readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !COMMENT_LINE.test(line))
        .join('\n');

const tsFilesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return tsFilesUnder(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
    });

describe('NO LEGACY VICTIM SURVIVES', () => {
    const files = tsFilesUnder(SRC_ROOT);

    it('no file under src/ uses a `legacyVictim` identifier in code', () => {
        // NON-VACUITY: a broken walk (wrong root, wrong extension filter) hands back an empty list,
        // whose "nothing matches" passes for the wrong reason. Pin both the scale and a known member.
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain(join(__dirname, '..', 'engine.ts'));

        const offenders = files
            .filter((file) => file !== SELF)
            .filter((file) => LEGACY_VICTIM.test(codeOf(file)));
        expect(offenders.map((f) => f.slice(SRC_ROOT.length + 1))).toEqual([]);
    });

    it('the strip keeps prose out and lets code through — so the zero above means something', () => {
        // The other half of the non-vacuity argument, on the FILTER rather than the walk: a
        // comment-strip that ate everything would make the check unfalsifiable.
        const stripped = (src: string) =>
            src
                .split('\n')
                .filter((line) => !COMMENT_LINE.test(line))
                .join('\n');
        // Prose forms this rung deliberately keeps — must NOT trip it.
        expect(
            LEGACY_VICTIM.test(stripped(' * the enemy side bound `legacyVictim: healTarget`'))
        ).toBe(false);
        expect(LEGACY_VICTIM.test(stripped('    // `TurnBindings.legacyVictim` is gone'))).toBe(
            false
        );
        // Code forms the field was written in — must trip it.
        expect(
            LEGACY_VICTIM.test(stripped('            legacyVictim: CombatActor | undefined;'))
        ).toBe(true);
        expect(
            LEGACY_VICTIM.test(stripped('            return { tgt: selected ?? tb.legacyVictim };'))
        ).toBe(true);
        expect(LEGACY_VICTIM.test(stripped('            legacyVictim: healTarget,'))).toBe(true);
    });
});
