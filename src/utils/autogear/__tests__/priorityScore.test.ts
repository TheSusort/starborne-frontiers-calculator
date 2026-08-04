import { describe, it, expect } from 'vitest';
import {
    calculatePriorityScore,
    resolveLimitStatValue,
    calculateHardViolation,
    calculateEffectiveHP,
} from '../priorityScore';
import { BaseStats } from '../../../types/stats';
import { STAT_NORMALIZERS, STATS, DERIVED_STAT_LABELS } from '../../../constants/stats';
import { SetPriority, StatPriority } from '../../../types/autogear';

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

    it('normalizes a defence priority against defence scale, not raw value', () => {
        // defence and attack share a 5000 normalizer, so a single-priority score
        // over the same raw value must match across the two stats.
        const sameValue: BaseStats = { ...stats, attack: 8000, defence: 8000 };
        const defScore = calculatePriorityScore(sameValue, [{ stat: 'defence', weight: 1 }]);
        const atkScore = calculatePriorityScore(sameValue, [{ stat: 'attack', weight: 1 }]);
        expect(defScore).toBeCloseTo(atkScore, 10);
        expect(defScore).toBeCloseTo(8000 / 5000, 10);
    });

    it('normalizes a crit priority against the crit scale', () => {
        const critScore = calculatePriorityScore(stats, [{ stat: 'crit', weight: 1 }]);
        expect(critScore).toBeCloseTo(50 / 25, 10);
    });
});
