import { describe, it, expect } from 'vitest';
import { getEmptySlotCount, hasEmptySlots } from '../missingGear';
import { Ship } from '../../../types/ship';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
    id: 'test-ship',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'terran',
    type: 'attacker',
    baseStats: {
        hp: 100,
        attack: 50,
        defence: 30,
        hacking: 10,
        security: 10,
        speed: 20,
        crit: 5,
        critDamage: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
    ...overrides,
});

describe('getEmptySlotCount', () => {
    it('returns 11 for a ship with no equipment or implants', () => {
        expect(getEmptySlotCount(makeShip())).toBe(11);
    });

    it('returns 0 for a fully equipped ship', () => {
        const ship = makeShip({
            equipment: {
                weapon: 'g1',
                hull: 'g2',
                generator: 'g3',
                sensor: 'g4',
                software: 'g5',
                thrusters: 'g6',
            },
            implants: {
                implant_minor_alpha: 'i1',
                implant_minor_gamma: 'i2',
                implant_minor_sigma: 'i3',
                implant_major: 'i4',
                implant_ultimate: 'i5',
            },
        });
        expect(getEmptySlotCount(ship)).toBe(0);
    });

    it('counts only empty gear slots (not filled ones)', () => {
        const ship = makeShip({
            equipment: { weapon: 'g1', hull: 'g2' },
            implants: { implant_major: 'i1' },
        });
        // 4 empty gear + 4 empty implant = 8
        expect(getEmptySlotCount(ship)).toBe(8);
    });

    it('treats falsy values as empty', () => {
        const ship = makeShip({
            equipment: { weapon: '', hull: 'g2' },
        });
        // weapon is falsy so still empty: 5 empty gear + 5 empty implant = 10
        expect(getEmptySlotCount(ship)).toBe(10);
    });
});

describe('hasEmptySlots', () => {
    it('returns true for a ship with empty slots', () => {
        expect(hasEmptySlots(makeShip())).toBe(true);
    });

    it('returns false for a fully equipped ship', () => {
        const ship = makeShip({
            equipment: {
                weapon: 'g1',
                hull: 'g2',
                generator: 'g3',
                sensor: 'g4',
                software: 'g5',
                thrusters: 'g6',
            },
            implants: {
                implant_minor_alpha: 'i1',
                implant_minor_gamma: 'i2',
                implant_minor_sigma: 'i3',
                implant_major: 'i4',
                implant_ultimate: 'i5',
            },
        });
        expect(hasEmptySlots(ship)).toBe(false);
    });
});
