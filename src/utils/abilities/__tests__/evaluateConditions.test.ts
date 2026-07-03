import { describe, it, expect } from 'vitest';
import { evaluateCondition, conditionMet, conditionsMet, scaledBonus } from '../evaluateConditions';
import { buildRoundContext } from '../roundContext';
import { Ability, Condition } from '../../../types/abilities';
import { makeConditionContext } from './conditionContextFixture';

const cond = (over: Partial<Condition>): Condition => ({
    subject: 'always',
    derivable: true,
    ...over,
});

describe('evaluateCondition', () => {
    it("'always' is 1", () => {
        expect(evaluateCondition(cond({ subject: 'always' }), makeConditionContext())).toBe(1);
    });

    it("derivable 'self-buff' counts active self buffs (all, or by name)", () => {
        const c = makeConditionContext({ selfBuffNames: ['Attack Up II', 'Defense Up II'] });
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
                makeConditionContext({ enemyDebuffCount: 3 })
            )
        ).toBe(3);
    });

    describe("'enemy-debuff' name-specific gating (sub-project I, PR I1)", () => {
        it('buffName + populated enemyDebuffNames → counts matches by name', () => {
            const c = makeConditionContext({
                enemyDebuffCount: 5, // legacy count present but must NOT be used on this path
                enemyDebuffNames: ['Stasis', 'Stasis', 'Concentrate Fire'],
            });
            expect(
                evaluateCondition(
                    cond({ subject: 'enemy-debuff', derivable: true, buffName: 'Stasis' }),
                    c
                )
            ).toBe(2);
        });

        it('buffName + populated enemyDebuffNames NOT containing it → 0 (does NOT fall back to count)', () => {
            const c = makeConditionContext({
                enemyDebuffCount: 3,
                enemyDebuffNames: ['Concentrate Fire'],
            });
            expect(
                evaluateCondition(
                    cond({ subject: 'enemy-debuff', derivable: true, buffName: 'Stasis' }),
                    c
                )
            ).toBe(0);
        });

        it('buffName present but enemyDebuffNames undefined (DPS-parity sentinel) → falls back to enemyDebuffCount', () => {
            const c = makeConditionContext({ enemyDebuffCount: 4 });
            expect(c.enemyDebuffNames).toBeUndefined();
            expect(
                evaluateCondition(
                    cond({ subject: 'enemy-debuff', derivable: true, buffName: 'Stasis' }),
                    c
                )
            ).toBe(4);
        });

        it('no buffName, even with enemyDebuffNames populated → legacy enemyDebuffCount', () => {
            const c = makeConditionContext({
                enemyDebuffCount: 4,
                enemyDebuffNames: ['Stasis'],
            });
            expect(evaluateCondition(cond({ subject: 'enemy-debuff', derivable: true }), c)).toBe(
                4
            );
        });
    });

    it("'enemy-buff' by name is 1 when present, else 0", () => {
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }),
                makeConditionContext({ enemyBuffNames: ['Stealth'] })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: true, buffName: 'Stealth' }),
                makeConditionContext()
            )
        ).toBe(0);
    });

    describe("'enemy-stealth-count' (sub-project I, PR I5)", () => {
        it('returns the live stealthedEnemyCount, distinct from the enemyBuffNames union', () => {
            const c = makeConditionContext({
                // A deduped union can't distinguish 1 vs N stealthed enemies — the dedicated
                // count field is what makes that distinction possible.
                enemyBuffNames: ['Stealth'],
                stealthedEnemyCount: 2,
            });
            expect(
                evaluateCondition(cond({ subject: 'enemy-stealth-count', derivable: true }), c)
            ).toBe(2);
        });

        it('defaults to 0 when unset (DPS-assumption)', () => {
            const c = makeConditionContext();
            expect(c.stealthedEnemyCount).toBeUndefined();
            expect(
                evaluateCondition(cond({ subject: 'enemy-stealth-count', derivable: true }), c)
            ).toBe(0);
        });
    });

    it("'self-crit' is effective crit rate / 100", () => {
        expect(
            evaluateCondition(
                cond({ subject: 'self-crit', derivable: true }),
                makeConditionContext({ effectiveCritRate: 100 })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'self-crit', derivable: true }),
                makeConditionContext({ effectiveCritRate: 50 })
            )
        ).toBe(0.5);
    });

    it("'enemy-type' is 1 on match else 0", () => {
        const c = cond({ subject: 'enemy-type', derivable: true, requiredEnemyType: 'Defender' });
        expect(evaluateCondition(c, makeConditionContext({ enemyType: 'Defender' }))).toBe(1);
        expect(evaluateCondition(c, makeConditionContext({ enemyType: 'Attacker' }))).toBe(0);
    });

    it("negated 'enemy-type' is 1 when the enemy is NOT the type (non-Defenders)", () => {
        const c = cond({
            subject: 'enemy-type',
            derivable: true,
            requiredEnemyType: 'Defender',
            negate: true,
        });
        expect(evaluateCondition(c, makeConditionContext({ enemyType: 'Attacker' }))).toBe(1);
        expect(evaluateCondition(c, makeConditionContext({ enemyType: 'Defender' }))).toBe(0);
        // Unknown enemy type → cannot confirm "not a Defender" → 0.
        expect(evaluateCondition(c, makeConditionContext({ enemyType: undefined }))).toBe(0);
    });

    it("'hp-threshold' below/above resolves against context HP", () => {
        const below = cond({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 50,
        });
        expect(evaluateCondition(below, makeConditionContext({ enemyHpPct: 40 }))).toBe(1);
        expect(evaluateCondition(below, makeConditionContext({ enemyHpPct: 60 }))).toBe(0);
    });

    it("'hp-threshold' with hpSubject 'self' resolves against the unit's own HP", () => {
        const selfAboveFull = cond({
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'above',
            hpPercent: 99,
            hpSubject: 'self',
        });
        expect(
            evaluateCondition(
                selfAboveFull,
                makeConditionContext({ selfHpPct: 100, enemyHpPct: 10 })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                selfAboveFull,
                makeConditionContext({ selfHpPct: 50, enemyHpPct: 100 })
            )
        ).toBe(0);
    });

    it('non-derivable uses manualCount (default 1)', () => {
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: false }),
                makeConditionContext()
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: false, manualCount: 3 }),
                makeConditionContext()
            )
        ).toBe(3);
        expect(
            evaluateCondition(
                cond({ subject: 'enemy-buff', derivable: false, manualCount: 0 }),
                makeConditionContext()
            )
        ).toBe(0);
    });
});

describe('conditionsMet (AND of OR-groups)', () => {
    it('empty conditions → always met', () => {
        expect(conditionsMet([], makeConditionContext())).toBe(true);
    });

    it('AND: all groups must have count > 0', () => {
        const conds = [
            cond({ subject: 'enemy-type', requiredEnemyType: 'Defender' }),
            cond({ subject: 'self-crit' }),
        ];
        expect(
            conditionsMet(
                conds,
                makeConditionContext({ enemyType: 'Defender', effectiveCritRate: 100 })
            )
        ).toBe(true);
        expect(
            conditionsMet(
                conds,
                makeConditionContext({ enemyType: 'Defender', effectiveCritRate: 0 })
            )
        ).toBe(false);
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
        expect(conditionsMet(conds, makeConditionContext({ enemyType: 'Defender' }))).toBe(true);
        expect(conditionsMet(conds, makeConditionContext({ enemyType: 'Attacker' }))).toBe(false);
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
        expect(conditionsMet(conds, makeConditionContext({ enemyType: 'Defender' }))).toBe(false);
        // all three groups satisfied
        expect(
            conditionsMet(
                conds,
                makeConditionContext({ enemyType: 'Defender', effectiveCritRate: 100 })
            )
        ).toBe(true);
    });
});

describe('conditionMet (count comparator gating)', () => {
    it('no comparator → presence rule (count > 0)', () => {
        expect(
            conditionMet(
                cond({ subject: 'enemy-debuff' }),
                makeConditionContext({ enemyDebuffCount: 1 })
            )
        ).toBe(true);
        expect(
            conditionMet(
                cond({ subject: 'enemy-debuff' }),
                makeConditionContext({ enemyDebuffCount: 0 })
            )
        ).toBe(false);
    });

    it('gte threshold: met only at/above the count (Crocus "more than 3" → gte 4)', () => {
        const c = cond({ subject: 'enemy-debuff', countComparator: 'gte', countThreshold: 4 });
        expect(conditionMet(c, makeConditionContext({ enemyDebuffCount: 3 }))).toBe(false);
        expect(conditionMet(c, makeConditionContext({ enemyDebuffCount: 4 }))).toBe(true);
        expect(conditionMet(c, makeConditionContext({ enemyDebuffCount: 9 }))).toBe(true);
    });

    it('eq 0: met only when the count is exactly zero (Sustainer "no debuffs")', () => {
        const c = cond({ subject: 'self-debuff', countComparator: 'eq', countThreshold: 0 });
        expect(conditionMet(c, makeConditionContext({ selfDebuffNames: [] }))).toBe(true);
        expect(conditionMet(c, makeConditionContext({ selfDebuffNames: ['Burn'] }))).toBe(false);
    });

    it('lte threshold: met at/below the count', () => {
        const c = cond({ subject: 'enemy-debuff', countComparator: 'lte', countThreshold: 2 });
        expect(conditionMet(c, makeConditionContext({ enemyDebuffCount: 2 }))).toBe(true);
        expect(conditionMet(c, makeConditionContext({ enemyDebuffCount: 3 }))).toBe(false);
    });

    it('comparator flows through conditionsMet as a gate', () => {
        const conds = [
            cond({ subject: 'enemy-debuff', countComparator: 'gte', countThreshold: 3 }),
        ];
        expect(conditionsMet(conds, makeConditionContext({ enemyDebuffCount: 3 }))).toBe(true);
        expect(conditionsMet(conds, makeConditionContext({ enemyDebuffCount: 2 }))).toBe(false);
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
        expect(scaledBonus(a, makeConditionContext({ enemyDebuffCount: 2 }))).toBe(20);
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
        expect(scaledBonus(a, makeConditionContext({ enemyDebuffCount: 2 }))).toBe(20);
        expect(scaledBonus(a, makeConditionContext({ enemyDebuffCount: 5 }))).toBe(30);
    });

    it('returns 0 when no scaling rule', () => {
        expect(scaledBonus(dmg([], undefined), makeConditionContext())).toBe(0);
    });

    it('Selenite-shape: 10% per stealthed enemy, uncapped (sub-project I, PR I5)', () => {
        const a = dmg([cond({ subject: 'enemy-stealth-count', derivable: true })], {
            conditionIndex: 0,
            perUnit: 10,
        });
        expect(scaledBonus(a, makeConditionContext({ stealthedEnemyCount: 0 }))).toBe(0);
        expect(scaledBonus(a, makeConditionContext({ stealthedEnemyCount: 2 }))).toBe(20);
        // Uncapped — the skill text states no maximum.
        expect(scaledBonus(a, makeConditionContext({ stealthedEnemyCount: 5 }))).toBe(50);
    });

    it('scaling reads only the indexed condition, even inside an anyOf OR-group', () => {
        // anyOf affects GATING (conditionsMet groups consecutive anyOf conditions);
        // scaledBonus deliberately reads the raw count of conditions[conditionIndex]
        // alone — the other group members never contribute to the bonus.
        const a = dmg(
            [
                cond({ subject: 'enemy-debuff', derivable: true, anyOf: true }),
                cond({ subject: 'self-buff', derivable: true, anyOf: true }),
            ],
            { conditionIndex: 0, perUnit: 10, cap: 30 }
        );
        expect(scaledBonus(a, makeConditionContext({ enemyDebuffCount: 2 }))).toBe(20);
        expect(scaledBonus(a, makeConditionContext({ enemyDebuffCount: 5 }))).toBe(30); // capped
        // self-buffs alone satisfy the OR-gate but contribute nothing to scaling
        expect(scaledBonus(a, makeConditionContext({ selfBuffNames: ['Stealth'] }))).toBe(0);
    });
});

describe('binary roundCrit', () => {
    it('self-crit returns 1 when roundCrit is true, 0 when false', () => {
        const cond = { subject: 'self-crit' as const, derivable: true };
        expect(
            evaluateCondition(
                cond,
                makeConditionContext({ effectiveCritRate: 70, roundCrit: true })
            )
        ).toBe(1);
        expect(
            evaluateCondition(
                cond,
                makeConditionContext({ effectiveCritRate: 70, roundCrit: false })
            )
        ).toBe(0);
    });

    it('self-crit falls back to probability when roundCrit is undefined', () => {
        const cond = { subject: 'self-crit' as const, derivable: true };
        expect(evaluateCondition(cond, makeConditionContext({ effectiveCritRate: 70 }))).toBe(0.7);
    });
});

describe('HP-percentage count subjects', () => {
    it('enemy-hp-pct counts the enemy HP percentage', () => {
        const c = cond({ subject: 'enemy-hp-pct' });
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 100 }))).toBe(100);
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 42 }))).toBe(42);
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 0 }))).toBe(0);
    });

    it('enemy-hp-missing-pct counts the missing percentage', () => {
        const c = cond({ subject: 'enemy-hp-missing-pct' });
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 100 }))).toBe(0);
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 30 }))).toBe(70);
        expect(evaluateCondition(c, makeConditionContext({ enemyHpPct: 0 }))).toBe(100);
    });
});

describe('hp-threshold hpSubject target', () => {
    it('hp-threshold with hpSubject target reads targetHpPct', () => {
        const c: Condition = {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 40,
            hpSubject: 'target',
        };
        expect(evaluateCondition(c, makeConditionContext({ targetHpPct: 35 }))).toBe(1);
        expect(evaluateCondition(c, makeConditionContext({ targetHpPct: 60 }))).toBe(0);
    });

    it('hp-threshold target defaults to 100 when targetHpPct absent (DPS-mode inert)', () => {
        const c: Condition = {
            subject: 'hp-threshold',
            derivable: true,
            hpComparator: 'below',
            hpPercent: 40,
            hpSubject: 'target',
        };
        expect(evaluateCondition(c, makeConditionContext())).toBe(0);
    });
});

describe('target-repaired-this-round condition', () => {
    const cond = { subject: 'target-repaired-this-round' as const, derivable: true };

    it('is met when the target was repaired this round', () => {
        expect(
            evaluateCondition(cond, makeConditionContext({ targetRepairedThisRound: true }))
        ).toBe(1);
        expect(conditionsMet([cond], makeConditionContext({ targetRepairedThisRound: true }))).toBe(
            true
        );
    });

    it('is NOT met when the target was not repaired (false or undefined)', () => {
        expect(
            evaluateCondition(cond, makeConditionContext({ targetRepairedThisRound: false }))
        ).toBe(0);
        expect(evaluateCondition(cond, makeConditionContext())).toBe(0);
        expect(conditionsMet([cond], makeConditionContext())).toBe(false);
    });
});

describe('self-hp-missing-pct condition', () => {
    it('self-hp-missing-pct returns 100 - selfHpPct', () => {
        const ctx = makeConditionContext({ selfHpPct: 40 });
        expect(evaluateCondition({ subject: 'self-hp-missing-pct', derivable: true }, ctx)).toBe(
            60
        );
    });
    it('self-hp-missing-pct is 0 at full HP', () => {
        const ctx = makeConditionContext({ selfHpPct: 100 });
        expect(evaluateCondition({ subject: 'self-hp-missing-pct', derivable: true }, ctx)).toBe(0);
    });
});

describe('self-shield condition', () => {
    it('evaluates to 1 when selfShielded is true', () => {
        expect(
            evaluateCondition(
                { subject: 'self-shield', derivable: true },
                makeConditionContext({ selfShielded: true })
            )
        ).toBe(1);
    });
    it('evaluates to 0 when selfShielded is false/absent', () => {
        expect(
            evaluateCondition({ subject: 'self-shield', derivable: true }, makeConditionContext())
        ).toBe(0);
    });
});

describe('not-hit-this-round condition', () => {
    const cond: Condition = { subject: 'not-hit-this-round', derivable: true };
    it('is met (1) when wasHitThisRound is false', () => {
        expect(evaluateCondition(cond, makeConditionContext({ wasHitThisRound: false }))).toBe(1);
    });
    it('is met (1) when wasHitThisRound is undefined (default)', () => {
        expect(evaluateCondition(cond, makeConditionContext())).toBe(1);
    });
    it('is NOT met (0) when wasHitThisRound is true', () => {
        expect(evaluateCondition(cond, makeConditionContext({ wasHitThisRound: true }))).toBe(0);
    });
});

describe('every-n-turns condition', () => {
    const cond = (period: number, offset?: number) =>
        ({ subject: 'every-n-turns', derivable: true, period, offset }) as const;

    it('period 2 (offset 0) is met on even turn counts', () => {
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 2 }))).toBe(1);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 4 }))).toBe(1);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 1 }))).toBe(0);
        expect(evaluateCondition(cond(2), makeConditionContext({ turnsTaken: 3 }))).toBe(0);
    });

    it('period 3 is met on turns 3,6 only', () => {
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 3 }))).toBe(1);
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 6 }))).toBe(1);
        expect(evaluateCondition(cond(3), makeConditionContext({ turnsTaken: 2 }))).toBe(0);
    });

    it('turn 0 (no turn taken yet) never procs', () => {
        // turnsTaken defaults to 0; the impl guards t <= 0 so "every Nth turn" requires
        // at least one turn taken.
        expect(evaluateCondition(cond(2), makeConditionContext({}))).toBe(0);
        expect(evaluateCondition(cond(1), makeConditionContext({ turnsTaken: 0 }))).toBe(0);
    });

    it('non-zero offset shifts the residue class', () => {
        // period 3, offset 1 → turns 1, 4, 7 …
        expect(evaluateCondition(cond(3, 1), makeConditionContext({ turnsTaken: 1 }))).toBe(1);
        expect(evaluateCondition(cond(3, 1), makeConditionContext({ turnsTaken: 4 }))).toBe(1);
        expect(evaluateCondition(cond(3, 1), makeConditionContext({ turnsTaken: 3 }))).toBe(0);
        expect(evaluateCondition(cond(3, 1), makeConditionContext({ turnsTaken: 6 }))).toBe(0);
    });

    it('out-of-range offset (>= period) never procs', () => {
        expect(evaluateCondition(cond(2, 2), makeConditionContext({ turnsTaken: 2 }))).toBe(0);
        expect(evaluateCondition(cond(2, 2), makeConditionContext({ turnsTaken: 4 }))).toBe(0);
    });
});

describe('lowest-speed-ally', () => {
    it('returns 1 when isLowestSpeedAlly is true', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
            isLowestSpeedAlly: true,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(1);
    });

    it('returns 0 when isLowestSpeedAlly is false', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
            isLowestSpeedAlly: false,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(0);
    });

    it('defaults to 1 (lone-actor DPS assumption) when the field is omitted', () => {
        const ctx = buildRoundContext({
            selfBuffNames: [],
            landedEnemyDebuffCount: 0,
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            effectiveCritRate: 0,
        });
        expect(evaluateCondition({ subject: 'lowest-speed-ally', derivable: true }, ctx)).toBe(1);
    });
});
