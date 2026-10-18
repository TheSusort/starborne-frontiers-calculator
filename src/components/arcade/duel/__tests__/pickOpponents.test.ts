import { describe, it, expect } from 'vitest';
import { canDuel, pickOpponents } from '../pickOpponents';
import type { Ship } from '../../../../types/ship';

const ship = (id: string) => ({ id, name: id }) as Ship;
const fleet = ['a', 'b', 'c', 'd'].map(ship);

/** Deterministic `random` replaying `values`. */
const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

describe('pickOpponents', () => {
    it('never picks the flown ship and returns two distinct ships', () => {
        for (let k = 0; k < 50; k++) {
            const pick = pickOpponents(fleet, 'b', Math.random)!;
            expect(pick).not.toBeNull();
            expect(pick.map((s) => s.id)).not.toContain('b');
            expect(pick[0].id).not.toBe(pick[1].id);
        }
    });

    it('can reach every candidate', () => {
        const seen = new Set<string>();
        for (let k = 0; k < 200; k++) {
            for (const s of pickOpponents(fleet, 'a', Math.random)!) seen.add(s.id);
        }
        expect(seen).toEqual(new Set(['b', 'c', 'd']));
    });

    it('uses the injected random', () => {
        expect(pickOpponents(fleet, 'a', seq(0, 0))!.map((s) => s.id)).toEqual(['b', 'c']);
        expect(pickOpponents(fleet, 'a', seq(0.99, 0.99))!.map((s) => s.id)).toEqual(['d', 'c']);
    });

    it('returns null with fewer than two candidates', () => {
        expect(pickOpponents([ship('a'), ship('b')], 'a', Math.random)).toBeNull();
        expect(pickOpponents([], 'a', Math.random)).toBeNull();
    });

    it('canDuel needs a flown ship and two candidates', () => {
        expect(canDuel(fleet, 'a')).toBe(true);
        expect(canDuel(fleet, null)).toBe(false);
        expect(canDuel([ship('a'), ship('b')], 'a')).toBe(false);
    });
});
