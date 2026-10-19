import { beforeEach, describe, it, expect } from 'vitest';
import { filterFleet, orderFleet, readLastShipId, writeLastShipId } from '../fleetOrder';
import type { Ship } from '../../../../types/ship';

const s = (id: string, rarity: string, level: number, faction = 'MPL', name = id) =>
    ({ id, name, rarity, level, faction }) as Ship;

describe('orderFleet', () => {
    const fleet = [
        s('a', 'rare', 60),
        s('b', 'legendary', 40),
        s('c', 'legendary', 60),
        s('d', 'epic', 1),
    ];

    it('orders by rarity desc, then level desc', () => {
        expect(orderFleet(fleet, null).map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    });

    it('puts the last chosen ship first', () => {
        expect(orderFleet(fleet, 'a').map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
    });

    it('ignores a last id that is no longer owned', () => {
        expect(orderFleet(fleet, 'gone').map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    });
});

describe('filterFleet', () => {
    const fleet = [s('1', 'rare', 1, 'MPL', 'Aegis'), s('2', 'rare', 1, 'XAOC', 'Hermes')];

    it('matches name case-insensitively', () => {
        expect(filterFleet(fleet, 'aeg', '').map((x) => x.id)).toEqual(['1']);
    });

    it('filters by faction', () => {
        expect(filterFleet(fleet, '', 'XAOC').map((x) => x.id)).toEqual(['2']);
    });
});

describe('last ship storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips', () => {
        expect(readLastShipId()).toBeNull();
        writeLastShipId('x');
        expect(readLastShipId()).toBe('x');
    });
});
