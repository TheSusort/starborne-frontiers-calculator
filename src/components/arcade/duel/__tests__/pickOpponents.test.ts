import { describe, it, expect } from 'vitest';
import {
    anyCandidate,
    bundleGateShips,
    gateLeads,
    canDuel,
    canTeam,
    gearedCandidate,
    isDuelCandidate,
    pickBundle,
    pickOpponents,
    rowPicks,
    shipsOfPicks,
    TEAM_PICK_SHIPS,
} from '../pickOpponents';
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
            const pick = pickOpponents(fleet, 'b', Math.random, gearedCandidate(getGearPiece))!;
            expect(pick).not.toBeNull();
            expect(pick.map((s) => s.id)).not.toContain('b');
            expect(pick[0].id).not.toBe(pick[1].id);
        }
    });

    it('can reach every candidate', () => {
        const seen = new Set<string>();
        for (let k = 0; k < 200; k++) {
            for (const s of pickOpponents(fleet, 'a', Math.random, gearedCandidate(getGearPiece))!)
                seen.add(s.id);
        }
        expect(seen).toEqual(new Set(['b', 'c', 'd']));
    });

    it('never picks an ungeared ship or one whose only gear id is stale', () => {
        const mixed = [ship('a'), ship('b'), ship('c', []), ship('d', ['gone']), ship('e')];
        for (let k = 0; k < 200; k++) {
            const pick = pickOpponents(mixed, 'a', Math.random, gearedCandidate(getGearPiece))!;
            expect(pick.map((s) => s.id).sort()).toEqual(['b', 'e']);
        }
    });

    it('uses the injected random', () => {
        const pick = (r: () => number) =>
            pickOpponents(fleet, 'a', r, gearedCandidate(getGearPiece))!.map((s) => s.id);
        expect(pick(seq(0, 0))).toEqual(['b', 'c']);
        expect(pick(seq(0.99, 0.99))).toEqual(['d', 'c']);
    });

    it('returns null with fewer than two candidates', () => {
        expect(
            pickOpponents([ship('a'), ship('b')], 'a', Math.random, gearedCandidate(getGearPiece))
        ).toBeNull();
        expect(pickOpponents([], 'a', Math.random, gearedCandidate(getGearPiece))).toBeNull();
        const oneGeared = [ship('a'), ship('b'), ship('c', [])];
        expect(
            pickOpponents(oneGeared, 'a', Math.random, gearedCandidate(getGearPiece))
        ).toBeNull();
    });
});

describe('canDuel', () => {
    it('needs a flown ship and two candidates', () => {
        expect(canDuel(fleet, 'a', gearedCandidate(getGearPiece))).toBe(true);
        expect(canDuel(fleet, null, gearedCandidate(getGearPiece))).toBe(false);
        expect(canDuel([ship('a'), ship('b')], 'a', gearedCandidate(getGearPiece))).toBe(false);
    });

    it('is false with one geared candidate and true with two', () => {
        const flown = ship('a', []);
        const ungeared = ship('c', ['gone']);
        expect(canDuel([flown, ship('b'), ungeared], 'a', gearedCandidate(getGearPiece))).toBe(
            false
        );
        expect(
            canDuel([flown, ship('b'), ungeared, ship('e')], 'a', gearedCandidate(getGearPiece))
        ).toBe(true);
    });

    it('does not need the flown ship to have gear', () => {
        expect(
            canDuel([ship('a', []), ship('b'), ship('c')], 'a', gearedCandidate(getGearPiece))
        ).toBe(true);
    });
});

describe('anyCandidate (bare templates)', () => {
    const bare = ['a', 'b', 'c'].map((id) => ship(id, []));
    it('lets gearless ships duel', () => {
        expect(canDuel(bare, 'a', anyCandidate)).toBe(true);
        const pick = pickOpponents(bare, 'a', seq(0, 0), anyCandidate)!;
        expect(pick.map((p) => p.id).sort()).toEqual(['b', 'c']);
    });
    it('still needs two ships besides the flown one', () => {
        expect(canDuel(bare.slice(0, 2), 'a', anyCandidate)).toBe(false);
    });
});

describe('team picks', () => {
    const big = 'abcdefghij'.split('').map((id) => ship(id, []));

    it('canTeam needs eight candidates besides the flown ship', () => {
        expect(canTeam(big.slice(0, 9), 'a', anyCandidate)).toBe(true);
        expect(canTeam(big.slice(0, 8), 'a', anyCandidate)).toBe(false);
        expect(canTeam(big, null, anyCandidate)).toBe(false);
        // A flown ship outside the fleet leaves all nine as candidates.
        expect(canTeam(big.slice(0, 9), 'z', anyCandidate)).toBe(true);
        expect(canTeam(big.slice(0, 9), 'z', (s) => s.id !== 'b')).toBe(true);
        expect(canTeam(big.slice(0, 9), 'z', (s) => s.id !== 'b' && s.id !== 'c')).toBe(false);
    });

    it('gives two disjoint trios and two allies, all distinct and never the flown ship', () => {
        for (let k = 0; k < 200; k++) {
            const bundle = pickBundle(big, 'c', Math.random, anyCandidate, TEAM_PICK_SHIPS)!;
            const picks = rowPicks('team', bundle)!;
            expect(picks.kind).toBe('team');
            if (picks.kind !== 'team') continue;
            const ids = [...picks.gates[0], ...picks.gates[1], ...picks.allies].map((s) => s.id);
            expect(ids).toHaveLength(8);
            expect(new Set(ids).size).toBe(8);
            expect(ids).not.toContain('c');
            expect(shipsOfPicks(picks).map((s) => s.id)).toEqual(ids);
        }
    });

    it('a one-ship row takes the first two of the same bundle', () => {
        const bundle = pickBundle(big, 'a', seq(0), anyCandidate, TEAM_PICK_SHIPS)!;
        expect(bundle.map((s) => s.id)).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
        for (const kind of ['duel', 'dps', 'tank', 'heal'] as const) {
            expect(rowPicks(kind, bundle)).toEqual({
                kind: 'single',
                gates: [bundle[0], bundle[1]],
            });
        }
    });

    it('a bundle too small for a team row gives no team picks', () => {
        const bundle = pickBundle(big.slice(0, 8), 'a', Math.random, anyCandidate, 8)!;
        expect(bundle).toHaveLength(7);
        expect(rowPicks('team', bundle)).toBeNull();
        expect(rowPicks('duel', bundle)?.kind).toBe('single');
        expect(rowPicks('duel', bundle.slice(0, 1))).toBeNull();
    });
});

describe('gate ships', () => {
    const big = 'abcdefghij'.split('').map((id) => ship(id, []));
    const ids = (ships: Ship[]) => ships.map((s) => s.id);

    it('a gate shows its ship, or the first of its trio', () => {
        const bundle = big.slice(1, 9);
        expect(ids(gateLeads(rowPicks('dps', bundle)!))).toEqual(['b', 'c']);
        expect(ids(gateLeads(rowPicks('team', bundle)!))).toEqual(['b', 'e']);
    });

    it('a bundle offers the gate ships of either shape', () => {
        expect(ids(bundleGateShips(big.slice(1, 9)))).toEqual(['b', 'c', 'e']);
        expect(ids(bundleGateShips(big.slice(1, 3)))).toEqual(['b', 'c']);
    });
});
