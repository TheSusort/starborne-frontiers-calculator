/**
 * §4B — a cast's damage must land in EXACTLY ONE accounting channel.
 *
 * The engine has two damage-accounting channels and they are mutually exclusive by design:
 *   • the per-victim POSITIONAL channel — `RoundData.perTargetDealt` (source → victim → dealt),
 *     written by `drivePositionalApply` → `creditDealt`;
 *   • the LEGACY scalar sink — `rawTotals` / `cumulativeDamage`, written by `creditDamage`
 *     against the (SP-4c-2d deleted) dummy `enemy` actor.
 *
 * Which one a cast uses is decided TWICE, and until this file existed the two decisions could
 * disagree:
 *   • VICTIM SELECTION (`selectTurnTarget` → `resolvePositionalTarget`) is liveness-aware: it
 *     only ever returns an opposing actor with `currentHp > 0`, else it returns NO victim at all
 *     (and bumps `noVictimTurnCount`) — since SP-4e on both sides;
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
import { runCombat, __getNoVictimTurnCount, __resetNoVictimTurnCount } from '../engine';
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
 * No longer a runnable shape — the normalization boundary refuses it. Kept as a fixture
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
        __resetNoVictimTurnCount();
    });

    // INVERTED THIS TEST, the same way SP-4b-2b inverted the empty-roster case below. Its
    // own hand-off note predicted the closure exactly: "SP-4c removes this shape too, along with
    // the sink it books into... the per-victim arm is the one that survives." The targetable-HP
    // floor (normalizeRoster.ts, MIN_TARGETABLE_MAX_HP) is that removal for THIS shape: an enemy
    // attacker declared as a 0-max-HP "pressure source" is no longer unhittable — it is floored to
    // 1,000,000 HP and becomes a real, targetable roster member. `rosterWithEnemyHp(0)` and
    // `rosterWithEnemyHp(500_000)` are now the SAME routing class (both floored well above
    // ROUNDS * PER_CAST, both take every cast per-victim) — the legacy sink is never reached by
    // this fixture any more, and there is no longer any way to construct a "0-max-HP" roster that
    // reads as unhittable to the engine.
    it('a former 0-max-HP pressure source is FLOORED, so it now credits every cast to the PER-VICTIM channel, not the legacy sink', () => {
        const result = runCombat(rosterWithEnemyHp(0));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, PER_CAST, PER_CAST, PER_CAST]);
        // ...and NOT into the legacy sink — the shape this test used to name is gone.
        expect(result.rawTotals.cumulative).toBe(0);
        expect(result.rawTotals.direct).toBe(0);
    });

    // INVERTED THIS TEST. It read "an EMPTY opposing roster credits every cast to the
    // LEGACY sink", asserting `rawTotals.cumulative === ROUNDS * PER_CAST` and no per-victim credit.
    // The empty roster is now refused at the normalization boundary, so the premise is illegal by
    // contract and no roster line can repair it.
    //
    // WHAT STOPPED BEING COVERED. When this note was written, nothing about the ACCOUNTING: the
    // mechanic this test observed — "a run with no targetable opponent credits the whole cast to
    // the legacy sink and nothing to the per-victim channel" — was asserted identically, on the same
    // four rounds and the same 10 000 per cast, by the 0-max-HP pressure-source case directly above,
    // because `resolvesPositionalVictim` keys on MAX hp and an unhittable roster reached the sink
    // through the identical gate. The two were the same routing class spelled two ways, and only the
    // SPELLING (the emptiness itself) was gone.
    //
    // SP-4c-2a then floored the pressure source too, so that sibling is inverted as well and BOTH
    // spellings of "credits the LEGACY sink" are now unbuildable on the player side. The legacy-sink
    // ARM of the §4B invariant is consequently no longer covered by any player-side case here — by
    // design, since deleting the dummy in 4c-2d deletes the arm. What this assertion pins is the
    // refusal itself.
    it('an EMPTY opposing roster is REFUSED — the sink is not reachable that way any more', () => {
        expect(() => runCombat(noRoster())).toThrow(/enemyAttackers is empty/);
    });

    it('a LIVING positioned roster credits every cast to the PER-VICTIM channel', () => {
        const result = runCombat(rosterWithEnemyHp(500_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, PER_CAST, PER_CAST, PER_CAST]);
        // ...and NOT also into the legacy sink.
        expect(result.rawTotals.cumulative).toBe(0);
        expect(__getNoVictimTurnCount()).toBe(0);
    });

    it('killing a targetable roster ENDS the match — the neither-channel state is now unreachable', () => {
        // 5 000 HP dies to the round-1 cast. This case used to be the ONE legitimate
        // neither-channel state: rounds 2-4 had nothing living to hit and booked into neither
        // channel because the cast dealt nothing (the mid-run "whiff window").
        //
        // DELETED that window rather than accounting for it. The kill wipes the enemy side,
        // so the match ends on that turn and rounds 2-4 never happen — there is no round left that
        // could book into neither channel. The invariant this file guards is therefore STRICTLY
        // STRONGER than it was: not "one shape is allowed to book nothing", but "no shape does".
        //
        // The 1-length assertion is the load-bearing one. Without it a future change that
        // resurrects the whiff rounds would repopulate them with zeros and every other assertion
        // here would still pass.
        const result = runCombat(rosterWithEnemyHp(5_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST]);
        expect(result.rounds).toHaveLength(1);
        expect(result.rawTotals.cumulative).toBe(0);
    });

    it('INVARIANT: across every roster shape, no round books into both channels, and a round with a living victim books into one', () => {
        // The third state — "neither channel while a living victim existed" — is the SP-4b-1 §4B
        // defect. Pinned here directly so a future gate/selection divergence cannot reintroduce it.
        // The `{ name: 'no roster', input: noRoster }` shape was dropped from this list —
        // it is refused at the boundary now, pinned by its own test above.
        //
        // The '0-max-HP pressure source' shape below no longer fails
        // `resolvesPositionalVictim` either — the targetable-HP floor raises it to
        // MIN_TARGETABLE_MAX_HP, so it now books per-victim exactly like 'survives every round'.
        // It is KEPT in the list (rather than folded into the survives-every-round shape) so a
        // regression that reopened the 0-max-HP-is-unhittable path would still be caught here, not
        // just in the dedicated test above.
        expect(() => runCombat(noRoster())).toThrow(/enemyAttackers is empty/);

        const shapes: ReadonlyArray<{ name: string; input: () => CombatEngineInput }> = [
            {
                name: '0-max-HP pressure source (now floored, per-victim)',
                input: () => rosterWithEnemyHp(0),
            },
            { name: 'dies in round 1', input: () => rosterWithEnemyHp(5_000) },
            { name: 'survives every round', input: () => rosterWithEnemyHp(500_000) },
        ];

        for (const shape of shapes) {
            setupKeyedTestRng(12345);
            __resetNoVictimTurnCount();
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
 * THE STRUCTURAL ASYMMETRY THAT SHAPED THIS MIRROR — now HISTORY, kept because it is still why
 * the mirror is not assertion-for-assertion identical to the suite above. `TurnBindings.legacyVictim`
 * used to be a DIFFERENT KIND OF OBJECT on the two sides:
 *   • player side → the dummy `enemy`, an indestructible wall (`hp 1_000_000_000`, never records
 *     destroyed). A never-targetable enemy roster therefore still had somewhere to book, which is
 *     what USED to make a player-side "0-max-HP pressure sources credit the LEGACY sink" case
 *     possible. SP-4c-2a's floor (`withTargetableHp` in normalizeRoster.ts) removed the premise: no
 *     enemy roster is never-targetable any more, and that case is now the inverted
 *     "a former 0-max-HP pressure source is FLOORED … credits the PER-VICTIM channel" case below.
 *   • enemy side → the HEAL TARGET, a real player actor drawn from
 *     `allPlayerActors = [attacker, ...teamCombatActors]`.
 * SP-4e (#335) DELETED the field on both sides, so the two objects no longer exist to differ — the
 * enemy resolves NO VICTIM where it used to resolve the heal target. The shape below is unchanged
 * either way: with every placed player member at max hp 0, the whole player side is a CORPSE from
 * round 1 (`destroyedRound === 1`, `targetHpPctStart === 0`) and the enemy correctly WHIFFS — case
 * (b), the one legitimate neither-channel state the player-side suite already carves out — rather
 * than crediting a sink. That is asserted below WITH its liveness evidence, so the zero is proven
 * to be a corpse-whiff and can never be mistaken for a dropped credit.
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
 * is the SP-4c/4d ladder's problem — and SP-4c-2a has already taken the first step for the reason
 * above: the player-side "credits the LEGACY sink" shape is unbuildable now that every enemy
 * attacker arrives hittable, so those cases are inverted rather than deleted (see below), and
 * deleting the dummy in 4c-2d retires the channel they used to name.
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
const playerSideWithMaxHp = (maxHp: number): CombatEngineInput => ({
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
});

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
        __resetNoVictimTurnCount();
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
        expect(__getNoVictimTurnCount()).toBe(0);
    });

    it('an enemy RETARGETS onto the heal target when the front ally dies, still per-victim', () => {
        // Both player members at 5 000 die to one 10 000 cast each: the ally in round 1, then the
        // enemy retargets onto the heal target at T1 in round 2. Both rounds book per-victim, so the
        // legacy subtraction must cancel the heal target's round-2 intake exactly — a stale
        // structural gate would have let the same 10 000 read as legacy damage as well.
        const result = runCombat(playerSideWithMaxHp(5_000));

        // TWO rounds, not four. The round-2 kill wipes the player side, so the match ends
        // on that turn — the retargeting claim below is untouched (it lives entirely in rounds 1-2),
        // and what disappears is only the pair of empty whiff rounds that used to trail it.
        expect(result.rounds).toHaveLength(2);
        expect(result.rounds.map(enemyPositionalIn)).toEqual([PER_CAST, PER_CAST]);
        expect(result.rounds[0].perTargetDealt!['e1']).toEqual({ ally: PER_CAST });
        expect(result.rounds[1].perTargetDealt!['e1']).toEqual({ [HEAL_TARGET_ID]: PER_CAST });
        // The heal target's round-2 intake is the SAME 10 000 the per-victim channel booked.
        expect(result.healing!.rounds.map((r) => r.incomingDamage)).toEqual([0, PER_CAST]);
        expect(
            result.healing!.rounds.map((r, i) => enemyLegacyIn(result.rounds[i], r.incomingDamage))
        ).toEqual([0, 0]);
        // The round-2 death is what ends the run: the whole player side is dead.
        expect(result.healing!.destroyedRound).toBe(2);
    });

    it('a never-targetable PLAYER roster is a CORPSE, so the enemy whiffs — not a dropped credit', () => {
        // The literal mirror of the player side's old "0-max-HP pressure sources credit the LEGACY
        // sink" claim CANNOT credit a sink, and the reason is structural, not a defect — and it is
        // also why this case SURVIVES while its player-side original was inverted by SP-4c-2a's
        // floor: the floor is enemy-side only, so a max-HP-0 PLAYER roster is still constructible.
        // Every placed player member is a corpse, so the enemy resolves nobody (before SP-4e it
        // resolved the heal target — itself one of the max-HP-0 members — and short-circuited on it
        // being dead). So this shape books into neither channel, and the assertions below prove that
        // zero is case (b), a whiff against a corpse, rather than the §4B defect (an accounted-for
        // number falling between the channels).
        const result = runCombat(playerSideWithMaxHp(0));

        expect(result.rounds.map(enemyPositionalIn)).toEqual([0, 0, 0, 0]);
        expect(result.healing!.rounds.map((r) => r.incomingDamage)).toEqual([0, 0, 0, 0]);
        // The liveness evidence that makes the zero legitimate: dead before the first cast lands.
        expect(result.healing!.destroyedRound).toBe(1);
        expect(result.healing!.rounds.map((r) => r.targetHpPctStart)).toEqual([0, 0, 0, 0]);
        // The enemy resolves NO VICTIM every round and takes a no-victim turn (before the
        // rung it consulted the fallback object and then short-circuited on it being dead). Either
        // way nothing is booked — which is why this counter's non-zero was never SP-4c's exit
        // condition, and is not SP-4e's either. It is the LIVENESS evidence for the zeros above:
        // the enemy really did take four turns, and they really did find nobody.
        expect(__getNoVictimTurnCount()).toBe(ROUNDS);
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
            __resetNoVictimTurnCount();
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
        });

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
