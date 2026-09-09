import { describe, it, expect } from 'vitest';
import {
    calculatePriorityScore,
    resolveLimitStatValue,
    calculateHardViolation,
    calculateEffectiveHP,
} from '../priorityScore';
import { BaseStats } from '../../../types/stats';
import { STAT_NORMALIZERS, STATS, DERIVED_STAT_LABELS } from '../../../constants/stats';
import { CustomFormula, SetPriority, StatPriority } from '../../../types/autogear';

const stats: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 8000,
    speed: 300,
    hacking: 5000,
    security: 3000,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

describe('calculatePriorityScore — implant set requirements', () => {
    it('applies no penalty when implant type is present', () => {
        const setPriorities: SetPriority[] = [{ setName: 'HASTE', count: 1, kind: 'implant' }];
        const implantSetCount = { HASTE: 1 };
        const setCount = {};
        const scoreWith = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            setCount,
            setPriorities,
            [],
            false,
            0,
            implantSetCount
        );
        const scoreWithout = calculatePriorityScore(stats, [], 'ATTACKER', {}, [], [], false, 0);
        // With implant satisfied, no penalty — score should equal unconstrained score
        expect(scoreWith).toBeCloseTo(scoreWithout, 5);
    });

    it('applies penalty when required implant type is absent', () => {
        const setPriorities: SetPriority[] = [{ setName: 'HASTE', count: 1, kind: 'implant' }];
        const setCount = {};
        const implantSetCount = {};
        const penalised = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            setCount,
            setPriorities,
            [],
            false,
            0,
            implantSetCount
        );
        const clean = calculatePriorityScore(stats, [], 'ATTACKER', {}, [], [], false, 0);
        expect(penalised).toBeLessThan(clean);
    });

    it('AMBUSH implant does NOT inflate gear orphan penalty', () => {
        // AMBUSH is in both GEAR_SETS and IMPLANTS
        const setPriorities: SetPriority[] = [{ setName: 'AMBUSH', count: 1, kind: 'implant' }];
        const setCount = {}; // no AMBUSH gear
        const implantSetCount = { AMBUSH: 1 };
        const scoreWithImplant = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            setCount,
            setPriorities,
            [],
            true,
            0,
            implantSetCount
        );
        const scoreNoImplant = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            setCount,
            [],
            [],
            true,
            0
        );
        // Having an AMBUSH implant (satisfied requirement) should not reduce score vs no requirement
        expect(scoreWithImplant).toBeCloseTo(scoreNoImplant, 5);
    });

    it('implant count does NOT satisfy a gear-set requirement of the same name', () => {
        // AMBUSH exists in both GEAR_SETS and IMPLANTS — gear requirement must not be satisfied by implant
        const gearSetPriority: SetPriority[] = [{ setName: 'AMBUSH', count: 1 }];
        const implantSetCount = { AMBUSH: 1 };
        const noGearCount = {};
        const penalised = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            noGearCount,
            gearSetPriority,
            [],
            false,
            0,
            implantSetCount
        );
        const clean = calculatePriorityScore(stats, [], 'ATTACKER', {}, [], [], false, 0);
        // Gear requirement is unsatisfied — penalty should fire even though implant count is present
        expect(penalised).toBeLessThan(clean);
    });
});

describe('resolveLimitStatValue', () => {
    it('passes base stats through unchanged', () => {
        expect(resolveLimitStatValue(stats, 'hp')).toBe(stats.hp);
        expect(resolveLimitStatValue(stats, 'defence')).toBe(stats.defence);
    });

    it('resolves effectiveHp via calculateEffectiveHP', () => {
        expect(resolveLimitStatValue(stats, 'effectiveHp')).toBeCloseTo(
            calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0),
            5
        );
    });

    it('does not produce NaN/Infinity when defence is 0', () => {
        const zeroDef: typeof stats = { ...stats, defence: 0 };
        const ehp = resolveLimitStatValue(zeroDef, 'effectiveHp');
        expect(Number.isFinite(ehp)).toBe(true);
        expect(ehp).toBeGreaterThan(0);
    });
});

describe('effectiveHp as a limit', () => {
    it('reports a hard violation when effectiveHp is below an unreachable min', () => {
        const priorities: StatPriority[] = [
            { stat: 'effectiveHp', minLimit: 100_000_000, hardRequirement: true, weight: 1 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeGreaterThan(0);
    });

    it('reports no hard violation when effectiveHp min is met', () => {
        const priorities: StatPriority[] = [
            { stat: 'effectiveHp', minLimit: 1, hardRequirement: true, weight: 1 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('applies a soft penalty when an effectiveHp min limit is missed', () => {
        const unmet: StatPriority[] = [{ stat: 'effectiveHp', minLimit: 100_000_000, weight: 1 }];
        const met: StatPriority[] = [{ stat: 'effectiveHp', minLimit: 1, weight: 1 }];
        const scoreUnmet = calculatePriorityScore(stats, unmet, 'DEFENDER');
        const scoreMet = calculatePriorityScore(stats, met, 'DEFENDER');
        expect(scoreUnmet).toBeLessThan(scoreMet);
    });
});

describe('STAT_NORMALIZERS keys match real stat names', () => {
    it('has no entry keyed by a name the type system never produces', () => {
        const validKeys = new Set([...Object.keys(STATS), ...Object.keys(DERIVED_STAT_LABELS)]);
        const strays = Object.keys(STAT_NORMALIZERS).filter((key) => !validKeys.has(key));
        expect(strays).toEqual([]);
    });

    it('normalizes an implant candidate against the stat scale, not its raw value', () => {
        // STAT_NORMALIZERS survives only for implant pre-filtering. defence and attack
        // share a 5000 normalizer, so the same raw roll must rank equally on either stat.
        expect(STAT_NORMALIZERS.defence).toBe(STAT_NORMALIZERS.attack);
        expect(STAT_NORMALIZERS.crit).toBe(25);
    });
});

describe('calculatePriorityScore — custom formula branch', () => {
    it('scores from the formula when no role is given', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const score = calculatePriorityScore(
            stats,
            [],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        // attack 10000 against the 10000 normalizer.
        expect(score).toBeCloseTo(1, 10);
    });

    it('scores 0 with no role and no formula', () => {
        expect(calculatePriorityScore(stats, [], undefined, {}, [], [], false, 0)).toBe(0);
    });

    it('ignores the formula when a role is given', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'speed', kind: 'core', direction: 'max' }],
        };
        const withFormula = calculatePriorityScore(
            stats,
            [],
            'ATTACKER',
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const without = calculatePriorityScore(stats, [], 'ATTACKER', {}, [], [], false, 0);
        expect(withFormula).toBeCloseTo(without, 10);
    });

    it('applies limit penalties on top of a formula score', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const unmet: StatPriority[] = [{ stat: 'speed', minLimit: 600, weight: 1 }];
        const penalised = calculatePriorityScore(
            stats,
            unmet,
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const clean = calculatePriorityScore(
            stats,
            [],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        expect(penalised).toBeLessThan(clean);
    });
});

describe('stat-priority order is inert', () => {
    // The reorder arrows come off StatPriorityRow because of this. Both priorities carry
    // limits the fixture violates, so a scorer that read order would return different
    // numbers for the two arrangements.
    const a: StatPriority = { stat: 'speed', minLimit: 600, weight: 1 };
    const b: StatPriority = { stat: 'crit', minLimit: 90, weight: 1 };

    it('scores the same for a list and its reverse, in role mode', () => {
        expect(calculatePriorityScore(stats, [a, b], 'ATTACKER')).toBeCloseTo(
            calculatePriorityScore(stats, [b, a], 'ATTACKER'),
            10
        );
    });

    it('scores the same for a list and its reverse, in custom mode', () => {
        const formula: CustomFormula = {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
        };
        const forward = calculatePriorityScore(
            stats,
            [a, b],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        const reversed = calculatePriorityScore(
            stats,
            [b, a],
            undefined,
            {},
            [],
            [],
            false,
            0,
            undefined,
            formula
        );
        expect(forward).toBeCloseTo(reversed, 10);
        // Non-vacuity: the penalty must actually bite, or this passes for the wrong reason.
        expect(forward).toBeLessThan(
            calculatePriorityScore(stats, [], undefined, {}, [], [], false, 0, undefined, formula)
        );
    });

    it('violates the same amount for a list and its reverse', () => {
        const hardA: StatPriority = { ...a, hardRequirement: true };
        const hardB: StatPriority = { ...b, hardRequirement: true };
        const forward = calculateHardViolation(stats, [hardA, hardB]);
        expect(forward).toBeCloseTo(calculateHardViolation(stats, [hardB, hardA]), 10);
        expect(forward).toBeGreaterThan(0);
    });
});
