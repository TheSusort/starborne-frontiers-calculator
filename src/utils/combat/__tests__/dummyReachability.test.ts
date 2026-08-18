/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * ── WHAT THIS FILE GUARANTEES (SP-4b-2b Task 7 closed both of its recorded gaps) ───────────────
 *
 * 1. **COVERAGE — five paths, not one.** The file used to exercise `bareInput()` alone: a single
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
 * The MID-RUN WHIFF WINDOW. When the roster WAS targetable and has since been killed,
 * `resolvesPositionalVictim` (keyed on MAX hp) keeps the run positional, so selection falls through
 * to `tb.legacyVictim` — CONSULTING it — while the apply gate stays positional, finds no anchor and
 * books NOTHING. So `__getLegacyVictimFallbackCount()` is legitimately non-zero there while no
 * damage reaches the sink: SP-4c must NOT gate on that counter being zero. It is
 * `__getDummySinkCreditCount()` that 4c can require to be zero, because a zero there means the
 * dummy absorbed nothing and deleting it loses no accounting. The whiff itself is deliberate,
 * documented behaviour (the focus cast site's "the correct behaviour is for the attacker to WHIFF")
 * and is NOT a defect for 4c to fix — 4c's job is to give the whiff a non-dummy way to say "no
 * living victim", i.e. to make the consultation stop needing an object.
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
import type { CombatEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
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
import { createEventBus } from '../events';

/** `bareInput` fires one 100%-multiplier damage ability off a 10 000 attack, zero crit. */
const PER_CAST = 10_000;
/** `bareInput().numRounds`. */
const BARE_ROUNDS = 2;

/** Run with an event tap so each case can prove its path actually ran. */
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    // Turn order per round, in emission order, and every death in the run — the two positive
    // signals the cases below use to show they reached the path they name.
    const turnsByRound = new Map<number, string[]>();
    const destroyedIds: string[] = [];
    bus.on('turn-started', (e) => {
        turnsByRound.set(e.round, [...(turnsByRound.get(e.round) ?? []), e.actorId]);
    });
    bus.on('ship-destroyed', (e) => destroyedIds.push(e.actorId));
    const result = runCombat({ ...input, bus });
    return {
        result,
        actorsThatTookTurns: (round: number): string[] => turnsByRound.get(round) ?? [],
        destroyed: (): string[] => destroyedIds,
    };
};

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
        const { result, actorsThatTookTurns } = collect(bareInput());

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
        const { result, actorsThatTookTurns } = collect({
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
        const { result } = collect({
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
        const { result, actorsThatTookTurns } = collect({
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
        // The one shape that legitimately consults the fallback mid-run, and therefore the shape
        // SP-4c has to handle rather than expect a zero from. 5 000 max HP dies to the round-1
        // cast; `resolvesPositionalVictim` keys on MAX hp, so rounds 2-3 stay positional, select
        // nobody, and whiff against the corpse instead of teleporting onto the dummy.
        const { result, destroyed } = collect({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        // The path ran: the victim really was killed, and really was still being targeted after.
        expect(destroyed()).toEqual([BARE_ENEMY_ID]);
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(result.rounds[1].perTargetDealt).toBeUndefined();
        expect(result.rounds[2].perTargetDealt).toBeUndefined();

        // CONSULTED once per whiff round — non-zero, and correctly so.
        expect(__getLegacyVictimFallbackCount()).toBe(2);
        // ...but nothing was CREDITED to it. This is the whole reason the second counter exists.
        expect(__getDummySinkCreditCount()).toBe(0);
    });

    it('DEATH RETARGETING: the cast moves to the next living member, not to the fallback', () => {
        // Two placed members; the front one dies to the round-1 cast and selection must walk to the
        // survivor behind it. Distinct from the corpse case: here a living victim still exists, so
        // even the CONSULTATION count must stay zero.
        const { result, destroyed } = collect({
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

    it('the counters are LIVE: a pressure-source roster both consults AND credits the dummy', () => {
        // THE VACUITY GUARD for every zero in this file, and the re-homed liveness proof (see the
        // header's historical gloss). An empty roster can no longer produce a credit — the boundary
        // throws — so the shape is a roster whose only member is a SOURCE of pressure, never a sink:
        // max HP 0. `resolvesPositionalVictim` keys on MAX hp, so it is placed but unhittable, the
        // run is non-positional, and the focus's whole output drains the dummy instead.
        const result = runCombat({
            ...bareInput(),
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
        });

        // Exactly pinned, both of them: one consultation and one credit per round.
        expect(__getLegacyVictimFallbackCount()).toBe(BARE_ROUNDS);
        expect(__getDummySinkCreditCount()).toBe(BARE_ROUNDS);
        // The credit is real damage, not a bookkeeping tick: the whole cast output landed on the
        // dummy's scalar channel and nothing landed per-victim.
        expect(result.rawTotals.cumulative).toBe(BARE_ROUNDS * PER_CAST);
        expect(result.rounds.every((round) => round.perTargetDealt === undefined)).toBe(true);
    });

    it('a live roster consults nothing and credits nothing', () => {
        runCombat(bareInput());

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
    });

    it('the whiff window separates them: CONSULTED without being CREDITED', () => {
        // The pair of readings that forbids SP-4c from gating on the consultations counter. Same
        // shape as CORPSE TARGETING above, asserted here as the CONTRAST with the pressure source:
        // identical fallback consultations (one per dead round), opposite credit readings.
        runCombat({
            ...bareInput(),
            numRounds: 3,
            enemyAttackers: bareEnemy({ stats: { hp: 5_000 } }),
        });

        expect(counters()).toEqual({ consulted: 2, credited: 0 });
    });
});
