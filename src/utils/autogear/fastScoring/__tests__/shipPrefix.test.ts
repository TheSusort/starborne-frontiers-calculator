import { describe, it, expect } from 'vitest';
import type { Ship } from '../../../../types/ship';
import { computeShipPrefix } from '../shipPrefix';
import { statVectorToBaseStats, STAT_INDEX } from '../../../fastScoring/statVector';
import { calculateTotalStats } from '../../../ship/statsCalculator';
import { makeTestShip, makeTestEngineering, TEST_BASE_STATS } from './fixtures/testInventory';

describe('computeShipPrefix', () => {
    it('matches calculateTotalStats afterEngineering with no refits or engineering', () => {
        const ship = makeTestShip();
        const prefix = computeShipPrefix(ship, undefined);
        const slow = calculateTotalStats(
            ship.baseStats,
            {},
            () => undefined,
            [],
            {},
            undefined,
            ship.id
        );
        expect(prefix[STAT_INDEX.hp]).toBeCloseTo(slow.afterEngineering.hp, 9);
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(slow.afterEngineering.attack, 9);
    });

    it('applies refits additively on top of base stats', () => {
        const ship = makeTestShip({
            refits: [
                { stats: [{ name: 'attack', value: 1000, type: 'flat' }] },
                { stats: [{ name: 'attack', value: 10, type: 'percentage' }] }, // +10% of base attack
            ] as unknown as Ship['refits'],
        });
        const prefix = computeShipPrefix(ship, undefined);
        const expectedAttack = TEST_BASE_STATS.attack + 1000 + TEST_BASE_STATS.attack * 0.1;
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
    });

    it('applies engineering stats on top of base+refits', () => {
        const ship = makeTestShip();
        const eng = makeTestEngineering(); // +500 attack flat, +5% hp
        const prefix = computeShipPrefix(ship, eng);
        const expectedAttack = TEST_BASE_STATS.attack + 500;
        const expectedHp = TEST_BASE_STATS.hp + TEST_BASE_STATS.hp * 0.05;
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
        expect(prefix[STAT_INDEX.hp]).toBeCloseTo(expectedHp, 9);
    });

    it('full parity with calculateTotalStats.afterEngineering for every stat', () => {
        const ship = makeTestShip({
            refits: [
                { stats: [{ name: 'attack', value: 500, type: 'flat' }] },
            ] as unknown as Ship['refits'],
        });
        const eng = makeTestEngineering();
        const prefix = computeShipPrefix(ship, eng);
        const slow = calculateTotalStats(
            ship.baseStats,
            {},
            () => undefined,
            ship.refits,
            {},
            eng,
            ship.id
        );
        const asBase = statVectorToBaseStats(prefix);
        for (const key of [
            'hp',
            'attack',
            'defence',
            'speed',
            'hacking',
            'security',
            'crit',
            'critDamage',
        ] as const) {
            expect(asBase[key]).toBeCloseTo(slow.afterEngineering[key] ?? 0, 9);
        }
    });
});
