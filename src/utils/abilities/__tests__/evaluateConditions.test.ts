import { describe, it, expect } from 'vitest';
import {
    ConditionContext,
    evaluateCondition,
    conditionMet,
    conditionsMet,
    scaledBonus,
} from '../evaluateConditions';
import { Ability, Condition } from '../../../types/abilities';

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    enemyType: undefined,
    effectiveCritRate: 0,
    adjacentAllyCount: 0,
    enemyAdjacentCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
    ...over,
});

const cond = (over: Partial<Condition>): Condition => ({
    subject: 'always',
    derivable: true,
    ...over,
});

describe('evaluateCondition', () => {
    it("'always' is 1", () => {
        expect(evaluateCondition(cond({ subject: 'always' }), ctx())).toBe(1);
    });

    it("derivable 'self-buff' counts active self buffs (all, or by name)", () => {
        const c = ctx({ selfBuffNames: ['Attack Up II', 'Defense Up II'] });
        expect(evaluateCondition(cond({ subject: 'self-buff', derivable: true }), c)).toBe(2);
        expect(
            evaluateCondition(
                cond({ subject: 'self-buff', derivable: true, buffName: 'Attack Up II' }),
                c
            )
        ).toBe(1);
    });

    it("'enemy-debuff' uses the derived count", () => {
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-debuff', derivable: true }),
                ctx({ enemyDebuffCount: 3 })
            )
        ).toBe(3);
    });

    it("'enemy-buff' by name is 1 when present, else 0", () => {
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }),
                ctx({ enemyBuffNames: ['Stealth'] })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }),
                ctx()
            )
        ).toBe(0);
    });

    it("'self-crit' is effective crit rate / 100", () => {
        expect(
            evaluateCondition(
                cond({ subject: 'self-crit', derivable: true }),
                ctx({ effectiveCritRate: 100 })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'self-crit', derivable: true }),
                ctx({ effectiveCritRate: 50 })
            )
        ).toBe(0.5);
    });

    it("'enemy-type' is 1 on match else 0", () => {
        const c = cond({ subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' });
        expect(evaluateCondition(c, ctx({ enemyType: 'Defender' }))).toBe(1);
        expect(evaluateCondition(c, ctx({ enemyType: 'Attacker' }))).toBe(0);
    });

    it("negated 'enemy-type' is 1 when the enemy is NOT the type (non-Defenders)", () => {
        const c = cond({
            subject: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
            negate: true,
        });
        expect(evaluateCondition(c, ctx({ enemyType: 'Attacker' }))).toBe(1);
        expect(evaluateCondition(c, ctx({ enemyType: 'Defender' }))).toBe(0);
        // Unknown enemy type → cannot confirm "not a Defender" → 0.
        expect(evaluateCondition(c, ctx({ enemyType: undefined }))).toBe(0);
    });

    it("'hp-threshold' below/above resolves against context HP", () => {
        const below = cond({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 50,
        });
        expect(evaluateCondition(below, ctx({ enemyHpPct: 40 }))).toBe(1);
        expect(evaluateCondition(below, ctx({ enemyHpPct: 60 }))).toBe(0);
    });

    it("'hp-threshold' with hpSubject 'self' resolves against the unit's own HP", () => {
        const selfAboveFull = cond({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'above',
            hpPercent: 99,
            hpSubject: 'self',
        });
        expect(evaluateCondition(selfAboveFull, ctx({ selfHpPct: 100, enemyHpPct: 10 }))).toBe(1);
        expect(evaluateCondition(selfAboveFull, ctx({ selfHpPct: 50, enemyHpPct: 100 }))).toBe(0);
    });

    it('non-derivable uses manualCount (default 1)', () => {
        expect(evaluateCondition(cond({ subject: 'enemy-buff', derivable: false }), ctx())).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: false, manualCount: 3 }),
                ctx()
            )
        ).toBe(3);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: false, manualCount: 0 }),
                ctx()
            )
        ).toBe(0);
    });
});

describe('conditionsMet (AND of OR-groups)', () => {
    it('empty conditions → always met', () => {
        expect(conditionsMet([], ctx())).toBe(true);
    });

    it('AND: all groups must have count > 0', () => {
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender' }),
            cond({ subject: 'self-crit' }),
        ];
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender', effectiveCritRate: 100 }))).toBe(
            true
        );
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender', effectiveCritRate: 0 }))).toBe(
            false
        );
    });

    it('OR-group (anyOf): any member > 0 satisfies the group', () => {
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender', anyOf: true }),
            cond({
                subject: 'enemy-buff',
                derivable: false,
                manualCount: 0,
                anyOf: true,
                buffName: 'Stealth',
            }),
        ];
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender' }))).toBe(true);
        expect(conditionsMet(conds, ctx({ enemyType: 'Attacker' }))).toBe(false);
    });

    it('non-adjacent anyOf conditions do NOT merge across a plain condition', () => {
        // [enemy-type(anyOf), self-crit(plain), enemy-buff(anyOf)] → groups [[type],[crit],[buff]], all AND-ed
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender', anyOf: true }),
            cond({ subject: 'self-crit' }),
            cond({
                subject: 'enemy-buff',
                derivable: false,
                manualCount: 1,
                anyOf: true,
                buffName: 'Stealth',
            }),
        ];
        // type true + buff true, but the plain self-crit group is false (crit 0) → overall false
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender' }))).toBe(false);
        // all three groups satisfied
        expect(conditionsMet(conds, ctx({ enemyType: 'Defender', effectiveCritRate: 100 }))).toBe(
            true
        );
    });
});

describe('conditionMet (count comparator gating)', () => {
    it('no comparator → presence rule (count > 0)', () => {
        expect(conditionMet(cond({ subject: 'enemy-debuff' }), ctx({ enemyDebuffCount: 1 }))).toBe(
            true
        );
        expect(conditionMet(cond({ subject: 'enemy-debuff' }), ctx({ enemyDebuffCount: 0 }))).toBe(
            false
        );
    });

    it('gte threshold: met only at/above the count (Crocus "more than 3" → gte 4)', () => {
        const c = cond({ subject: 'enemy-debuff', countComparator: 'gte', countThreshold: 4 });
        expect(conditionMet(c, ctx({ enemyDebuffCount: 3 }))).toBe(false);
        expect(conditionMet(c, ctx({ enemyDebuffCount: 4 }))).toBe(true);
        expect(conditionMet(c, ctx({ enemyDebuffCount: 9 }))).toBe(true);
    });

    it('eq 0: met only when the count is exactly zero (Sustainer "no debuffs")', () => {
        const c = cond({ subject: 'self-debuff', countComparator: 'eq', countThreshold: 0 });
        expect(conditionMet(c, ctx({ selfDebuffNames: [] }))).toBe(true);
        expect(conditionMet(c, ctx({ selfDebuffNames: ['Burn'] }))).toBe(false);
    });

    it('lte threshold: met at/below the count', () => {
        const c = cond({ subject: 'enemy-debuff', countComparator: 'lte', countThreshold: 2 });
        expect(conditionMet(c, ctx({ enemyDebuffCount: 2 }))).toBe(true);
        expect(conditionMet(c, ctx({ enemyDebuffCount: 3 }))).toBe(false);
    });

    it('comparator flows through conditionsMet as a gate', () => {
        const conds = [
            cond({ subject: 'enemy-debuff', countComparator: 'gte', countThreshold: 3 }),
        ];
        expect(conditionsMet(conds, ctx({ enemyDebuffCount: 3 }))).toBe(true);
        expect(conditionsMet(conds, ctx({ enemyDebuffCount: 2 }))).toBe(false);
    });

    it('comparator does NOT affect scaledBonus (scaling always uses the raw count)', () => {
        const a: Ability = {
            id: 'x',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [
                cond({ subject: 'enemy-debuff', countComparator: 'gte', countThreshold: 4 }),
            ],
            scaling: { conditionIndex: 0, perUnit: 10 },
            config: { type: 'damage', multiplier: 200 },
        };
        // count 2 < threshold 4 (gate would fail), but scaling still uses raw count 2 → 20.
        expect(scaledBonus(a, ctx({ enemyDebuffCount: 2 }))).toBe(20);
    });
});

describe('scaledBonus', () => {
    const dmg = (conditions: Condition[], scaling: Ability['scaling']): Ability => ({
        id: 'x',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions,
        scaling,
        config: { type: 'damage', multiplier: 200 },
    });

    it('per-unit × count, capped', () => {
        const a = dmg([cond({ subject: 'enemy-debuff', derivable: true })], {
            conditionIndex: 0,
            perUnit: 10,
            cap: 30,
        });
        expect(scaledBonus(a, ctx({ enemyDebuffCount: 2 }))).toBe(20);
        expect(scaledBonus(a, ctx({ enemyDebuffCount: 5 }))).toBe(30);
    });

    it('returns 0 when no scaling rule', () => {
        expect(scaledBonus(dmg([], undefined), ctx())).toBe(0);
    });
});
