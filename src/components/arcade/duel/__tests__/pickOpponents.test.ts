import { describe, it, expect } from 'vitest';
import { canDuel, isDuelCandidate, pickOpponents } from '../pickOpponents';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';

/** Gear ids that resolve; any other id is stale. */
const inventory = new Set(['g1', 'g2', 'g3', 'g4', 'g5']);
const getGearPiece = (id: string) => (inventory.has(id) ? ({ id } as GearPiece) : undefined);

const ship = (id: string, gear: string[] = [`g${id.charCodeAt(0) - 96}`]) =>
    ({
        id,
        name: id,
        equipment: Object.fromEntries(gear.map((g, i) => [['weapon', 'hull', 'generator'][i], g])),
    }) as unknown as Ship;
const fleet = ['a', 'b', 'c', 'd'].map((id) => ship(id));

/** Deterministic `random` replaying `values`. */
const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
};

describe('isDuelCandidate', () => {
    it('needs at least one equipped piece that resolves', () => {
        expect(isDuelCandidate(ship('a', ['g1']), getGearPiece)).toBe(true);
        expect(isDuelCandidate(ship('a', ['gone', 'g2']), getGearPiece)).toBe(true);
        expect(isDuelCandidate(ship('a', []), getGearPiece)).toBe(false);
        expect(isDuelCandidate(ship('a', ['gone']), getGearPiece)).toBe(false);
        expect(isDuelCandidate({ id: 'x', name: 'x' } as Ship, getGearPiece)).toBe(false);
    });
});

describe('pickOpponents', () => {
    it('never picks the flown ship and returns two distinct ships', () => {
        for (let k = 0; k < 50; k++) {
            const pick = pickOpponents(fleet, 'b', Math.random, getGearPiece)!;
            expect(pick).not.toBeNull();
            expect(pick.map((s) => s.id)).not.toContain('b');
            expect(pick[0].id).not.toBe(pick[1].id);
        }
    });

    it('can reach every candidate', () => {
        const seen = new Set<string>();
        for (let k = 0; k < 200; k++) {
            for (const s of pickOpponents(fleet, 'a', Math.random, getGearPiece)!) seen.add(s.id);
        }
        expect(seen).toEqual(new Set(['b', 'c', 'd']));
    });

    it('never picks an ungeared ship or one whose only gear id is stale', () => {
        const mixed = [ship('a'), ship('b'), ship('c', []), ship('d', ['gone']), ship('e')];
        for (let k = 0; k < 200; k++) {
            const pick = pickOpponents(mixed, 'a', Math.random, getGearPiece)!;
            expect(pick.map((s) => s.id).sort()).toEqual(['b', 'e']);
        }
    });

    it('uses the injected random', () => {
        const pick = (r: () => number) =>
            pickOpponents(fleet, 'a', r, getGearPiece)!.map((s) => s.id);
        expect(pick(seq(0, 0))).toEqual(['b', 'c']);
        expect(pick(seq(0.99, 0.99))).toEqual(['d', 'c']);
    });

    it('returns null with fewer than two candidates', () => {
        expect(pickOpponents([ship('a'), ship('b')], 'a', Math.random, getGearPiece)).toBeNull();
        expect(pickOpponents([], 'a', Math.random, getGearPiece)).toBeNull();
        const oneGeared = [ship('a'), ship('b'), ship('c', [])];
        expect(pickOpponents(oneGeared, 'a', Math.random, getGearPiece)).toBeNull();
    });
});

describe('canDuel', () => {
    it('needs a flown ship and two candidates', () => {
        expect(canDuel(fleet, 'a', getGearPiece)).toBe(true);
        expect(canDuel(fleet, null, getGearPiece)).toBe(false);
        expect(canDuel([ship('a'), ship('b')], 'a', getGearPiece)).toBe(false);
    });

    it('is false with one geared candidate and true with two', () => {
        const flown = ship('a', []);
        const ungeared = ship('c', ['gone']);
        expect(canDuel([flown, ship('b'), ungeared], 'a', getGearPiece)).toBe(false);
        expect(canDuel([flown, ship('b'), ungeared, ship('e')], 'a', getGearPiece)).toBe(true);
    });

    it('does not need the flown ship to have gear', () => {
        expect(canDuel([ship('a', []), ship('b'), ship('c')], 'a', getGearPiece)).toBe(true);
    });
});
