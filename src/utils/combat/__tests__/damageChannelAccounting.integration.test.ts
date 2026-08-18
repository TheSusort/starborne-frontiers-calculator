/**
 * SP-4b-1 §4B — a cast's damage must land in EXACTLY ONE accounting channel.
 *
 * The engine has two damage-accounting channels and they are mutually exclusive by design:
 *   • the per-victim POSITIONAL channel — `RoundData.perTargetDealt` (source → victim → dealt),
 *     written by `drivePositionalApply` → `creditDealt`;
 *   • the LEGACY scalar sink — `rawTotals` / `cumulativeDamage`, written by `creditDamage`
 *     against the dummy `enemy` actor.
 *
 * Which one a cast uses is decided TWICE, and until this file existed the two decisions could
 * disagree:
 *   • VICTIM SELECTION (`selectTurnTarget` → `resolvePositionalTarget`) is liveness-aware: it
 *     only ever returns an opposing actor with `currentHp > 0`, else it hands back the legacy
 *     victim (and bumps `legacyVictimFallbackCount`);
 *   • the APPLY GATE (`isPositional(...) && target && pattern && turn.positionalScalars`) was
 *     purely STRUCTURAL — "does any opposing actor carry a board position?" — and a position
 *     survives its owner's death.
 *
 * Before the SP-4b-1 normalization boundary, "no positions anywhere" was the de-facto proxy for
 * "this roster is a pressure source, not a target roster", so the two decisions happened to agree.
 * Normalization auto-places every actor, which destroyed that proxy: a roster of 0-max-HP pressure
 * sources now reads as positional, the gate goes positional, selection finds nobody, the
 * per-victim apply books nothing, and the legacy credit is suppressed because "the positional
 * branch was taken". The cast's damage was credited to NEITHER channel and simply vanished.
 *
 * The fix makes the gate ask the same question selection asks: a positioned opposing actor counts
 * as a positional ROSTER only if it is a viable target at all (`stats.hp > 0`). That leaves
 * exactly one legitimate "neither channel" state — a roster that WAS targetable and has since
 * been killed, where the cast is a deliberate whiff against a corpse (pinned by
 * `deathFallback.integration.test.ts` and re-pinned here as the ONLY such state).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
} from '../engine';
import type { CombatEngineInput, TeamActorEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareEnemy, damageKit } from '../__testutils__/bareRosterFixture';
import type { RoundData } from '../../calculators/dpsSimulator';

const ROUNDS = 4;
/**
 * `bareInput` fires one 100%-multiplier damage ability off a 10 000 attack, zero crit.
 *
 * ⚠️ TWO PROVENANCES, ONE NUMBER. The mirror suite further down reuses this constant for the
 * ENEMY's cast, which comes from `playerSideWithMaxHp`'s hand-written `attack: 10_000` — a
 * SEPARATE literal that merely coincides with `bareInput`'s. Change either side's attack and the
 * other suite's expectations do not follow; they only look coupled. Kept shared because the
 * coincidence is deliberate (the mirror is meant to be numerically symmetric with the player side),
 * but do not read a `PER_CAST` in the mirror suite as being derived from `bareInput`.
 */
const PER_CAST = 10_000;

/** The shared bare roster with the sole enemy attacker's MAX HP dialled to `hp`. */
const rosterWithEnemyHp = (hp: number): CombatEngineInput => {
    const enemies = bareEnemy();
    enemies[0].stats.hp = hp;
    return { ...bareInput(), numRounds: ROUNDS, enemyAttackers: enemies };
};

/**
 * SP-4b-2b: no longer a runnable shape — the normalization boundary refuses it. Kept as a fixture
 * so the refusal itself is pinned (below) rather than the shape quietly disappearing from this file.
 */
const noRoster = (): CombatEngineInput => ({
    ...bareInput(),
    numRounds: ROUNDS,
    enemyAttackers: [],
});

/** Total booked into the PER-VICTIM channel for one round. */
const positionalIn = (round: RoundData): number =>
    Object.values(round.perTargetDealt ?? {})
        .flatMap((byVictim) => Object.values(byVictim))
        .reduce((sum, amount) => sum + amount, 0);

/** Total booked into the LEGACY scalar channel for one round. */
const legacyIn = (round: RoundData): number => round.directDamage;

describe('SP-4b-1 §4B — damage is never credited to neither channel', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('a roster of 0-max-HP pressure sources credits every cast to the LEGACY sink', () => {
        // The 12 bucket-4B fixtures all look like this: an enemy attacker declared purely as a
        // SOURCE of pressure (`hp: 0`), never as something to hit. It can never be a victim, so
        // the run is not positional and the dummy sink owns the offense — exactly what these
        // callers got before normalization started auto-placing the roster.
        //
        // ⭐ SP-4c HAND-OFF, and the reason this case is now load-bearing beyond its own name: since
        // SP-4b-2b dropped the empty-roster shape (see the block below), this 0-max-HP shape is the
        // SOLE remaining carrier of the LEGACY arm of the §4B invariant — the only fixture in the
        // repo that still books a player cast into the scalar sink. SP-4c removes this shape too,
        // along with the sink it books into. When it does, the invariant's legacy arm has nothing
        // left to observe and the honest move is to DELETE that arm (both here and in the INVARIANT
        // test's shape list) rather than to keep a 0-max-HP roster alive artificially to feed it.
        // The per-victim arm is the one that survives, and it is covered by the two cases below.
        const result = runCombat(rosterWithEnemyHp(0));

        expect(result.rawTotals.cumulative).toBe(ROUNDS * PER_CAST);
        expect(result.rawTotals.direct).toBe(ROUNDS * PER_CAST);
        // ...and NOT also into the per-victim channel (never two channels).
        expect(result.rounds.map(positionalIn)).toEqual([0, 0, 0, 0]);
    });

    // SP-4b-2b INVERTED THIS TEST. It read "an EMPTY opposing roster credits every cast to the
    // LEGACY sink", asserting `rawTotals.cumulative === ROUNDS * PER_CAST` and no per-victim credit.
    // The empty roster is now refused at the normalization boundary, so the premise is illegal by
    // contract and no roster line can repair it.
    //
    // WHAT STOPPED BEING COVERED, and what survives: nothing about the ACCOUNTING. The mechanic
    // this test observed — "a run with no targetable opponent credits the whole cast to the legacy
    // sink and nothing to the per-victim channel" — is asserted identically, on the same four
    // rounds and the same 10 000 per cast, by "a roster of 0-max-HP pressure sources credits every
    // cast to the LEGACY sink" directly above, and by that shape's entry in the INVARIANT test
    // below. `resolvesPositionalVictim` keys on MAX hp, so an unhittable roster and an absent one
    // reach the sink through the identical gate; the two cases were always the same routing class
    // spelled two ways. What is genuinely gone is only the SPELLING — the emptiness itself — and
    // that is what this assertion now pins.
    it('an EMPTY opposing roster is REFUSED — the sink is not reachable that way any more', () => {
        expect(() => runCombat(noRoster())).toThrow(/enemyAttackers is empty/);
    });

    it('a LIVING positioned roster credits every cast to the PER-VICTIM channel', () => {
        const result = runCombat(rosterWithEnemyHp(500_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, PER_CAST, PER_CAST, PER_CAST]);
        // ...and NOT also into the legacy sink.
        expect(result.rawTotals.cumulative).toBe(0);
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('killing a targetable roster mid-run whiffs — the ONE legitimate neither-channel state', () => {
        // 5 000 HP dies to the round-1 cast. Rounds 2-4 have nothing living to hit, so they are a
        // deliberate no-op against a corpse (see deathFallback.integration.test.ts). This is the
        // ONLY shape allowed to book into neither channel, and it books because the cast DEALT
        // nothing — not because an accounted-for number was dropped between the two.
        const result = runCombat(rosterWithEnemyHp(5_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, 0, 0, 0]);
        expect(result.rawTotals.cumulative).toBe(0);
    });

    it('INVARIANT: across every roster shape, no round books into both channels, and a round with a living victim books into one', () => {
        // The third state — "neither channel while a living victim existed" — is the SP-4b-1 §4B
        // defect. Pinned here directly so a future gate/selection divergence cannot reintroduce it.
        // SP-4b-2b: the `{ name: 'no roster', input: noRoster }` shape was dropped from this list —
        // it is refused at the boundary now, pinned by its own test above. It was the same routing
        // class as the 0-max-HP pressure source that remains here (both fail
        // `resolvesPositionalVictim` and fall to the sink), so the list still covers every reachable
        // sink/per-victim/whiff combination. Re-asserted here so the absence is deliberate and a
        // future reader cannot read it as a quietly deleted shape.
        expect(() => runCombat(noRoster())).toThrow(/enemyAttackers is empty/);

        const shapes: ReadonlyArray<{ name: string; input: () => CombatEngineInput }> = [
            { name: '0-max-HP pressure source', input: () => rosterWithEnemyHp(0) },
            { name: 'dies in round 1', input: () => rosterWithEnemyHp(5_000) },
            { name: 'survives every round', input: () => rosterWithEnemyHp(500_000) },
        ];

        for (const shape of shapes) {
            setupKeyedTestRng(12345);
            __resetLegacyVictimFallbackCount();
            const result = runCombat(shape.input());

            // A living victim exists for a round iff the enemy has not yet been destroyed.
            let livingVictimRounds = 0;
            result.rounds.forEach((round, index) => {
                const positional = positionalIn(round);
                const legacy = legacyIn(round);

                // NEVER TWO.
                expect(
                    positional > 0 && legacy > 0,
                    `${shape.name} round ${index + 1} booked into BOTH channels (positional ${positional}, legacy ${legacy})`
                ).toBe(false);

                if (positional > 0 || legacy > 0) livingVictimRounds++;
            });

            // NEVER ZERO while something was there to hit. Every shape but the mid-run kill has a
            // channel in all four rounds; the mid-run kill has exactly one (its kill round).
            const expectedBookedRounds = shape.name === 'dies in round 1' ? 1 : ROUNDS;
            expect(livingVictimRounds, `${shape.name}: rounds that booked into a channel`).toBe(
                expectedBookedRounds
            );

            // The whole cast output is accounted for: nothing between the channels.
            const total =
                result.rounds.reduce((sum, round) => sum + positionalIn(round), 0) +
                result.rawTotals.cumulative;
            expect(total, `${shape.name}: total accounted damage`).toBe(
                expectedBookedRounds * PER_CAST
            );
        }
    });
});

/**
 * THE MIRROR — the same invariant with the PLAYER side as the roster under test.
 *
 * Everything above is player→enemy, focus-only. But the 4B fix converted SEVEN gates and only
 * three of them sit on the focus path: `selectTurnTarget` is shared, `teamWillApplyPositionally`/
 * `teamPositional` are walked-team, and `enemyWillApplyPositionally`/`enemyPositional` are
 * enemy→player. Team symmetry is a LOCKED project rule and "symmetric by construction" is not a
 * pin, so the enemy→player direction gets its own matched set here: same shape, same four rounds,
 * same 10 000 per cast, with the opposing roster's MAX HP as the only variable — except that the
 * roster under test is now the PLAYER side.
 *
 * THE ONE STRUCTURAL ASYMMETRY, and why the mirror is not assertion-for-assertion identical.
 * `TurnBindings.legacyVictim` is a DIFFERENT KIND OF OBJECT on the two sides:
 *   • player side → the dummy `enemy`, an indestructible wall (`hp 1_000_000_000`, never records
 *     destroyed). A never-targetable enemy roster therefore still has somewhere to book, which is
 *     what makes the player-side "0-max-HP pressure sources credit the LEGACY sink" case possible.
 *   • enemy side → the HEAL TARGET, a real player actor drawn from
 *     `allPlayerActors = [attacker, ...teamCombatActors]`.
 * Because the heal target is itself a roster member, "every placed player member at max hp 0"
 * necessarily makes the enemy's own legacy sink a 0-max-HP actor — i.e. the whole player side is a
 * CORPSE from round 1 (`destroyedRound === 1`, `targetHpPctStart === 0`). The enemy then correctly
 * WHIFFS, which is case (b) — the one legitimate neither-channel state the player-side suite already
 * carves out — rather than crediting a sink. That is asserted below WITH its liveness evidence, so
 * the zero is proven to be a corpse-whiff and can never be mistaken for a dropped credit.
 *
 * CONSEQUENCE — the enemy-side conversion is PROVABLY INERT, and these tests say so honestly.
 * `isPositional(p, R)` and `resolvesPositionalVictim(p, R)` differ on exactly one input class: `R`
 * has placed members but NOT ONE with `stats.hp > 0`. On the enemy side `R = allPlayerActors`, which
 * CONTAINS the heal target, so "the two predicates differ" IMPLIES "the enemy's legacy sink has max
 * HP 0" — and then neither branch can book anything, because the positional branch finds no anchor
 * and the legacy branch's sink is a corpse. Reverting `enemyWillApplyPositionally`/`enemyPositional`
 * to `isPositional` is therefore an observationally undetectable change, and it was CONFIRMED
 * undetectable by mutation: all ten tests in this file still pass with both enemy gates reverted.
 * Do not read that as these tests being vacuous — mutating either enemy gate to `false` kills three
 * of the four mirror tests, and mutating the two team gates to `false` kills the walked-team one. The
 * enemy-side ROUTING is pinned; what cannot be pinned is the liveness half of the predicate, because
 * the enemy has no indestructible sink to book into. That asymmetry is a fact about the dummy, and it
 * is the SP-4c/4d ladder's problem: deleting the dummy gives the PLAYER side the same missing sink,
 * at which point the player-side "credits the LEGACY sink" cases above stop being expressible too.
 *
 * The enemy side's two channels, and why the second is a subtraction: the per-victim channel is
 * `perTargetDealt[enemyId][victimId]` exactly as on the player side, but the legacy channel is the
 * heal target's own intake (`HealingRoundEngine.incomingDamage`), and that intake is credited on
 * BOTH paths — the positional apply also lands real damage on the heal target when it happens to be
 * the selected victim. Subtracting the positionally-attributed slice is what makes the two channels
 * disjoint, and it still catches a double-book: if both paths ran, intake would be 20 000 against
 * 10 000 attributed, leaving 10 000 in each channel and tripping NEVER TWO.
 */
const HEAL_TARGET_ID = 'attacker';

/** A walked team ally at the front-most cell, so the enemy's synthesized `front` target picks it. */
const frontAlly = (maxHp: number): TeamActorEngineInput => ({
    id: 'ally',
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: maxHp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/**
 * The mirror roster: one enemy attacker carrying the 10 000-attack damage kit, and a player side of
 * exactly two members whose MAX HP is the single variable — the focus (which is also the heal
 * target, parked at the BACK cell `T1`) and a walked ally at the FRONT cell `M4`. The focus is given
 * no kit and no attack so the ONLY damage in the run is enemy→player and the accounting cannot be
 * confused with the focus's own output.
 */
const playerSideWithMaxHp = (maxHp: number): CombatEngineInput =>
    ({
        ...bareInput(),
        numRounds: ROUNDS,
        attack: 0,
        shipSkills: { slots: [] },
        hp: maxHp,
        position: 'T1',
        mode: 'healing',
        healTargetId: HEAL_TARGET_ID,
        teamActors: [frontAlly(maxHp)],
        enemyAttackers: [
            {
                id: 'e1',
                stats: {
                    attack: 10_000,
                    crit: 0,
                    critDamage: 0,
                    speed: 10,
                    defence: 0,
                    hp: 500_000,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: damageKit(),
            },
        ],
    }) as CombatEngineInput;

/** Total the enemy booked into the PER-VICTIM channel for one round. */
const enemyPositionalIn = (round: RoundData): number =>
    Object.values(round.perTargetDealt?.['e1'] ?? {}).reduce((sum, amount) => sum + amount, 0);

/**
 * Total the enemy booked into the enemy-side LEGACY channel for one round: the heal target's intake
 * MINUS whatever the per-victim channel already attributes to the heal target (see the subtraction
 * note in the block comment — the intake is written by both paths).
 */
const enemyLegacyIn = (round: RoundData, incomingDamage: number): number =>
    incomingDamage - (round.perTargetDealt?.['e1']?.[HEAL_TARGET_ID] ?? 0);

describe('SP-4b-1 §4B — the MIRROR: enemy→player obeys the same accounting invariant', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('a LIVING positioned player roster takes every enemy cast in the PER-VICTIM channel', () => {
        // The mirror of "a LIVING positioned roster credits every cast to the PER-VICTIM channel":
        // this is what pins `enemyWillApplyPositionally` / `enemyPositional` in the POSITIVE
        // direction. The enemy's synthesized front-target resolves onto the ally at M4 all four
        // rounds; the heal target sits at T1 and is never touched, so its intake stays 0 and the
        // two channels are unambiguously disjoint.
        const result = runCombat(playerSideWithMaxHp(500_000));

        expect(result.rounds.map(enemyPositionalIn)).toEqual([
            PER_CAST,
            PER_CAST,
            PER_CAST,
            PER_CAST,
        ]);
        expect(result.rounds.every((r) => Object.keys(r.perTargetDealt!['e1'])[0] === 'ally')).toBe(
            true
        );
        // ...and nothing into the enemy-side legacy channel.
        expect(result.healing!.rounds.map((r) => r.incomingDamage)).toEqual([0, 0, 0, 0]);
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('an enemy RETARGETS onto the heal target when the front ally dies, still per-victim', () => {
        // Both player members at 5 000 die to one 10 000 cast each: the ally in round 1, then the
        // enemy retargets onto the heal target at T1 in round 2. Both rounds book per-victim, so the
        // legacy subtraction must cancel the heal target's round-2 intake exactly — a stale
        // structural gate would have let the same 10 000 read as legacy damage as well.
        const result = runCombat(playerSideWithMaxHp(5_000));

        expect(result.rounds.map(enemyPositionalIn)).toEqual([PER_CAST, PER_CAST, 0, 0]);
        expect(result.rounds[0].perTargetDealt!['e1']).toEqual({ ally: PER_CAST });
        expect(result.rounds[1].perTargetDealt!['e1']).toEqual({ [HEAL_TARGET_ID]: PER_CAST });
        // The heal target's round-2 intake is the SAME 10 000 the per-victim channel booked.
        expect(result.healing!.rounds.map((r) => r.incomingDamage)).toEqual([0, PER_CAST, 0, 0]);
        expect(
            result.healing!.rounds.map((r, i) => enemyLegacyIn(result.rounds[i], r.incomingDamage))
        ).toEqual([0, 0, 0, 0]);
        // Rounds 3-4 are the whiff: the whole player side is dead.
        expect(result.healing!.destroyedRound).toBe(2);
    });

    it('a never-targetable PLAYER roster is a CORPSE, so the enemy whiffs — not a dropped credit', () => {
        // The literal mirror of "0-max-HP pressure sources credit the LEGACY sink" CANNOT credit a
        // sink, and the reason is structural, not a defect: the enemy's `legacyVictim` IS the heal
        // target, which is itself one of the max-HP-0 members. So this shape books into neither
        // channel — and the assertions below prove that zero is case (b), a whiff against a corpse,
        // rather than the §4B defect (an accounted-for number falling between the channels).
        const result = runCombat(playerSideWithMaxHp(0));

        expect(result.rounds.map(enemyPositionalIn)).toEqual([0, 0, 0, 0]);
        expect(result.healing!.rounds.map((r) => r.incomingDamage)).toEqual([0, 0, 0, 0]);
        // The liveness evidence that makes the zero legitimate: dead before the first cast lands.
        expect(result.healing!.destroyedRound).toBe(1);
        expect(result.healing!.rounds.map((r) => r.targetHpPctStart)).toEqual([0, 0, 0, 0]);
        // The fallback object was still CONSULTED every round — which is exactly why SP-4c cannot
        // gate on this counter being zero (see `__getLegacyVictimFallbackCount`'s doc comment).
        expect(__getLegacyVictimFallbackCount()).toBe(ROUNDS);
    });

    it('INVARIANT (enemy side): no round books into both channels, and a round with a living victim books into exactly one', () => {
        // The mirror of the player-side INVARIANT test, and the assertion that forbids a future
        // change from reintroducing a "neither channel" state on the enemy→player path.
        const shapes: ReadonlyArray<{ name: string; maxHp: number; bookedRounds: number }> = [
            // Corpse from round 1 — nothing was ever alive to hit, so zero booked rounds is right.
            { name: 'never-targetable player roster', maxHp: 0, bookedRounds: 0 },
            // Ally dies in round 1, heal target in round 2; rounds 3-4 whiff.
            { name: 'both members die mid-run', maxHp: 5_000, bookedRounds: 2 },
            { name: 'survives every round', maxHp: 500_000, bookedRounds: ROUNDS },
        ];

        for (const shape of shapes) {
            setupKeyedTestRng(12345);
            __resetLegacyVictimFallbackCount();
            const result = runCombat(playerSideWithMaxHp(shape.maxHp));

            let bookedRounds = 0;
            result.rounds.forEach((round, index) => {
                const positional = enemyPositionalIn(round);
                const legacy = enemyLegacyIn(
                    round,
                    result.healing!.rounds[index].incomingDamage ?? 0
                );

                // NEVER TWO.
                expect(
                    positional > 0 && legacy > 0,
                    `${shape.name} round ${index + 1} booked into BOTH channels (positional ${positional}, legacy ${legacy})`
                ).toBe(false);

                if (positional > 0 || legacy > 0) bookedRounds++;
            });

            // NEVER ZERO while a living victim existed.
            expect(bookedRounds, `${shape.name}: rounds that booked into a channel`).toBe(
                shape.bookedRounds
            );

            // Nothing fell between the channels.
            const total = result.rounds.reduce(
                (sum, round, index) =>
                    sum +
                    enemyPositionalIn(round) +
                    enemyLegacyIn(round, result.healing!.rounds[index].incomingDamage ?? 0),
                0
            );
            expect(total, `${shape.name}: total accounted enemy damage`).toBe(
                shape.bookedRounds * PER_CAST
            );
        }
    });

    it('a WALKED-TEAM cast books per-victim against a living roster (the team gate, ally as source)', () => {
        // `teamWillApplyPositionally` / `teamPositional` are the remaining two converted gates.
        // A walked ally carrying the damage kit fires at a living enemy roster: the credit must be
        // attributed to the ALLY as source, not folded onto the focus. (The focus has no kit and
        // attack 0, so any focus-attributed entry would be a routing bug.)
        //
        // Deliberately NOT pinned here: the 0-max-HP counterpart of this shape. The walked-team side
        // has NO scalar damage-accounting channel at all — `rawTotals`/`directDamage` are the FOCUS's
        // sink, and a walked ally's damage is observable only through `perTargetDealt` or through a
        // `basis: 'damage-dealt'` rider. "Credited to neither channel" is therefore vacuous on that
        // side rather than fixed, and asserting the current zero would bake in behaviour nobody has
        // ruled on. Recorded as a finding for the SP-4 ladder instead.
        const gunner = frontAlly(1_000_000);
        gunner.walk!.shipSkills = damageKit();
        gunner.walk!.stats.attack = 10_000;
        const result = runCombat({
            ...playerSideWithMaxHp(1_000_000),
            teamActors: [gunner],
            enemyAttackers: bareEnemy(),
        } as CombatEngineInput);

        expect(result.rounds.map((r) => r.perTargetDealt?.['ally']?.['e1'] ?? 0)).toEqual([
            PER_CAST,
            PER_CAST,
            PER_CAST,
            PER_CAST,
        ]);
        expect(result.rounds.every((r) => r.perTargetDealt?.['attacker'] === undefined)).toBe(true);
        // The focus's own scalar sink stays empty — the ally's damage never leaked into it.
        expect(result.rawTotals.cumulative).toBe(0);
    });
});
