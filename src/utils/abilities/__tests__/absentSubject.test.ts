/**
 * SP-4d — an absent subject is UNRESOLVABLE, not a fabricated value.
 *
 * THE GAME CASE (spec §2): Hermes repairs an ally with four enemies on the board. That turn
 * resolves no victim, so "the enemy's HP%", "the target's HP" and "enemies hit by this cast" have
 * no subject. Before this rung they answered 100 / 0 / 1 — a healthy enemy, a zero-stat enemy, and
 * a cast that hit one enemy. Give a support kit Cobalt's real clause shape ("if this Unit has more
 * HP than the enemy…") and the 0 makes it fire against nobody.
 *
 * The `eq 0` case below is the one that decides the MECHANISM rather than the values: answering 0
 * instead of a phantom fixes the `gt` clause and leaves the parser's own negation idiom
 * (`countComparator: 'eq', countThreshold: 0`, buildShipAbilities.ts:266) firing against nobody.
 * Rejecting an absent subject BEFORE the comparator switch is what closes both.
 *
 * DISCHARGES, Task 7: two of `noVictimResidualTripwires.test.ts`'s three SP-4c-2b corpus-scan
 * cases are retired here as direct assertions — case (a) (enemy hp-threshold ABOVE) by "an enemy
 * hp-threshold ABOVE gate does not fire with no enemy" below, and case (c) (stat-vs-target GT) by
 * "Cobalt's clause shape does not fire against nobody" below. Case (b) (enemies-hit-this-cast) is
 * NOT discharged by this file — it was closed later, by SP-4d Task 8's honest 0-vs-1 footprint fix;
 * see `noVictimResidualTripwires.test.ts`'s header for where it is discharged.
 */
import { describe, it, expect } from 'vitest';
import { conditionMet, conditionsMet, evaluateCondition, scaledBonus } from '../evaluateConditions';
import type { Ability, Condition } from '../../../types/abilities';
import { makeConditionContext } from './conditionContextFixture';

const cond = (over: Partial<Condition>): Condition => ({
    subject: 'always',
    derivable: true,
    ...over,
});

describe('SP-4d: an absent subject does not resolve', () => {
    it('an enemy hp-threshold ABOVE gate does not fire with no enemy (was: TRUE against nobody)', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(
                cond({ subject: 'hp-threshold', hpComparator: 'above', hpPercent: 50 }),
                ctx
            )
        ).toBe(false);
    });

    it('an enemy hp-threshold BELOW gate still does not fire — the other direction is unchanged', () => {
        // Guards against a "fix" that inverts the answer instead of withholding it. Obsidian's real
        // `below 30` and Judge's `below 50` read false against the old phantom 100 too, so this case
        // must stay false for the same reason it always was: there is no enemy below the threshold.
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(
                cond({ subject: 'hp-threshold', hpComparator: 'below', hpPercent: 50 }),
                ctx
            )
        ).toBe(false);
    });

    it('a SELF hp-threshold is untouched — selfHpPct always has a subject', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined, selfHpPct: 20 });
        expect(
            conditionMet(
                cond({
                    subject: 'hp-threshold',
                    hpSubject: 'self',
                    hpComparator: 'below',
                    hpPercent: 50,
                }),
                ctx
            )
        ).toBe(true);
    });

    it("Cobalt's clause shape does not fire against nobody (stat-vs-target hp gt)", () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: undefined });
        expect(
            conditionMet(
                cond({ subject: 'stat-vs-target', compareStat: 'hp', statComparator: 'gt' }),
                ctx
            )
        ).toBe(false);
    });

    it('a resolvable stat-vs-target gate still fires — the absent rule is not a blanket block', () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: 5000 });
        expect(
            conditionMet(
                cond({ subject: 'stat-vs-target', compareStat: 'hp', statComparator: 'gt' }),
                ctx
            )
        ).toBe(true);
    });

    it('THE COMPARATOR-PROOF CASE: an lte gate is not satisfied by an absent footprint either', () => {
        // Before this rung, `enemies-hit-this-cast` answered a fabricated 1 for an owner with no
        // recorded footprint, so `lte 1` fired against nobody. Answering 0 instead would ALSO have
        // fired it. Only rejecting before the comparator closes both — which is what this asserts.
        const ctx = makeConditionContext({ enemiesHitThisCast: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'enemies-hit-this-cast',
                    countComparator: 'lte',
                    countThreshold: 1,
                }),
                ctx
            )
        ).toBe(false);
    });

    it('THE COMPARATOR-PROOF CASE, negation idiom: eq 0 is not satisfied either', () => {
        const ctx = makeConditionContext({ enemiesHitThisCast: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'enemies-hit-this-cast',
                    countComparator: 'eq',
                    countThreshold: 0,
                }),
                ctx
            )
        ).toBe(false);
    });

    it('an enemy hp-threshold negation idiom (eq 0) is not satisfied by an absent enemy either', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'hp-threshold',
                    hpComparator: 'above',
                    hpPercent: 50,
                    countComparator: 'eq',
                    countThreshold: 0,
                }),
                ctx
            )
        ).toBe(false);
    });

    it('THE COMPARATOR-PROOF CASE for hp-threshold: an lte gate is not satisfied by an absent enemy either', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'hp-threshold',
                    hpComparator: 'above',
                    hpPercent: 50,
                    countComparator: 'lte',
                    countThreshold: 1,
                }),
                ctx
            )
        ).toBe(false);
    });

    it('a stat-vs-target negation idiom (eq 0) is not satisfied by an absent target either', () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'stat-vs-target',
                    compareStat: 'hp',
                    statComparator: 'gt',
                    countComparator: 'eq',
                    countThreshold: 0,
                }),
                ctx
            )
        ).toBe(false);
    });

    it('THE COMPARATOR-PROOF CASE for stat-vs-target: an lte gate is not satisfied by an absent target either', () => {
        const ctx = makeConditionContext({ selfCurrentHp: 20000, targetCurrentHp: undefined });
        expect(
            conditionMet(
                cond({
                    subject: 'stat-vs-target',
                    compareStat: 'hp',
                    statComparator: 'gt',
                    countComparator: 'lte',
                    countThreshold: 1,
                }),
                ctx
            )
        ).toBe(false);
    });

    it("Tygr's real gte 2 gate is unchanged — a recorded footprint still resolves", () => {
        const ctx = makeConditionContext({ enemiesHitThisCast: 3 });
        expect(
            conditionMet(
                cond({
                    subject: 'enemies-hit-this-cast',
                    countComparator: 'gte',
                    countThreshold: 2,
                }),
                ctx
            )
        ).toBe(true);
    });

    it("Akula's HP-proportional scaling contributes 0 with no target (was: its full cap)", () => {
        // enemy-hp-pct is a SCALING source, not a gate: with the phantom 100 it paid the maximum
        // bonus. Absent must pay nothing, and `scaledBonus` is where that happens.
        const ability: Ability = {
            id: 'akulaish',
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [cond({ subject: 'enemy-hp-pct' })],
            config: {
                type: 'modifier',
                channel: 'outgoingDamage',
                value: 30,
                isMultiplicative: false,
            },
            scaling: { conditionIndex: 0, perUnit: 0.3, cap: 30 },
        };
        expect(scaledBonus(ability, makeConditionContext({ enemyHpPct: undefined }))).toBe(0);
        expect(scaledBonus(ability, makeConditionContext({ enemyHpPct: 50 }))).toBe(15);
    });

    it('enemy-hp-missing-pct does not invert into a full bonus when absent', () => {
        // The trap: `100 - undefined` is NaN, and a naive `100 - (ctx.enemyHpPct ?? 0)` pays 100.
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-hp-missing-pct' }),
                makeConditionContext({ enemyHpPct: undefined })
            )
        ).toBeUndefined();
    });

    it('SIDE-WIDE subjects keep answering — a real roster exists even with no victim', () => {
        // Spec §3.1: since 4b-2b a real enemy roster is guaranteed, so "how many enemies have been
        // destroyed" and "does any enemy have a buff" have honest answers on a no-victim turn.
        const ctx = makeConditionContext({
            enemyHpPct: undefined,
            enemyDestroyedCount: 2,
            enemyBuffNames: ['Stealth'],
        });
        expect(conditionMet(cond({ subject: 'enemy-destroyed' }), ctx)).toBe(true);
        expect(conditionMet(cond({ subject: 'enemy-buff', buffName: 'Stealth' }), ctx)).toBe(true);
    });

    it('an unresolvable condition inside an anyOf run does not poison a resolvable sibling', () => {
        const ctx = makeConditionContext({ enemyHpPct: undefined, selfHpPct: 20 });
        const conditions = [
            cond({ subject: 'hp-threshold', hpComparator: 'above', hpPercent: 50, anyOf: true }),
            cond({
                subject: 'hp-threshold',
                hpSubject: 'self',
                hpComparator: 'below',
                hpPercent: 50,
                anyOf: true,
            }),
        ];
        // conditionsMet groups consecutive anyOf conditions into one OR-group: the unresolvable
        // enemy-hp arm must not poison its resolvable self-hp sibling.
        expect(conditionsMet(conditions, ctx)).toBe(true);

        // Negative half: with BOTH conditions unresolvable, the whole OR-group must fail. A plain
        // `count > 0` pairing can't distinguish this from a reverted hp-threshold guard (an absent
        // subject's fabricated `0` also fails `count > 0`), so this uses the eq-0 negation idiom on
        // the second member instead — that shape goes true if either member's guard is removed,
        // making this a real pin rather than a coincidentally-passing case.
        const bothUnresolvable = [
            cond({ subject: 'hp-threshold', hpComparator: 'above', hpPercent: 50, anyOf: true }),
            cond({
                subject: 'hp-threshold',
                hpComparator: 'above',
                hpPercent: 50,
                countComparator: 'eq',
                countThreshold: 0,
                anyOf: true,
            }),
        ];
        const ctxNoTarget = makeConditionContext({ enemyHpPct: undefined });
        expect(conditionsMet(bothUnresolvable, ctxNoTarget)).toBe(false);
    });
});
