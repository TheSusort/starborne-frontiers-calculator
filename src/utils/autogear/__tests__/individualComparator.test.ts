import { describe, it, expect } from 'vitest';
import { compareIndividuals } from '../individualComparator';

describe('compareIndividuals', () => {
    it('feasible beats infeasible regardless of fitness', () => {
        const feasibleLowFit = { fitness: 10, violation: 0 };
        const infeasibleHighFit = { fitness: 1000, violation: 0.01 };
        expect(compareIndividuals(feasibleLowFit, infeasibleHighFit)).toBeLessThan(0);
        expect(compareIndividuals(infeasibleHighFit, feasibleLowFit)).toBeGreaterThan(0);
    });

    it('among feasible, higher fitness ranks first', () => {
        const a = { fitness: 100, violation: 0 };
        const b = { fitness: 50, violation: 0 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('among infeasible, lower violation ranks first', () => {
        const a = { fitness: 10, violation: 0.1 };
        const b = { fitness: 1000, violation: 0.2 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('among infeasible with equal violation, higher fitness ranks first', () => {
        const a = { fitness: 100, violation: 0.1 };
        const b = { fitness: 50, violation: 0.1 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('returns 0 for identical individuals', () => {
        const a = { fitness: 100, violation: 0 };
        const b = { fitness: 100, violation: 0 };
        expect(compareIndividuals(a, b)).toBe(0);
    });

    it('sorts an array in feasibility-first order', () => {
        const arr = [
            { fitness: 1000, violation: 0.5 },
            { fitness: 10, violation: 0 },
            { fitness: 500, violation: 0.1 },
            { fitness: 100, violation: 0 },
        ];
        arr.sort(compareIndividuals);
        // feasible individuals (violation===0) rank first, sorted by fitness desc: 100, 10
        // infeasible individuals rank after, sorted by violation asc: 500(0.1), 1000(0.5)
        expect(arr.map((x) => x.fitness)).toEqual([100, 10, 500, 1000]);
    });
});
