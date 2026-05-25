import { describe, it, expect } from 'vitest';
import { calculatePriorityScore } from '../priorityScore';
import { BaseStats } from '../../../types/stats';
import { SetPriority } from '../../../types/autogear';

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
});
