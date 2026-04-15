import { describe, it, expect, beforeEach } from 'vitest';
import { calculateTotalStats, clearGearStatsCache } from '../statsCalculator';
import { GearPiece } from '../../../types/gear';
import { BaseStats } from '../../../types/stats';

/** Minimal base stats — only attack matters for these tests. */
const BASE_STATS: BaseStats = {
    hp: 10000,
    attack: 5000,
    defence: 5000,
    hacking: 100,
    security: 100,
    speed: 100,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    defensePenetration: 0,
};

/**
 * Build a calibration-eligible gear piece (level 16, 6-star)
 * with a flat attack main stat that has a known base value.
 *
 * Calibrated flat attack 6★ has a 2x multiplier, so
 *   base = 1000  →  calibrated = 2000
 */
function makeCalibratedWeapon(calibratedToShipId: string): GearPiece {
    return {
        id: 'weapon-cal',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        calibration: { shipId: calibratedToShipId },
    };
}

function makeUncalibratedWeapon(): GearPiece {
    return {
        id: 'weapon-base',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
    };
}

const SHIP_A = 'ship-a';
const SHIP_B = 'ship-b';

describe('calculateTotalStats — calibration', () => {
    beforeEach(() => {
        clearGearStatsCache();
    });

    it('applies calibration bonus when gear is calibrated to the target ship', () => {
        const weapon = makeCalibratedWeapon(SHIP_A);
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined,
            SHIP_A // target ship matches calibration
        );

        // Base attack (5000) + calibrated main stat (2000) = 7000
        expect(result.final.attack).toBe(BASE_STATS.attack + 2000);
    });

    it('does NOT apply calibration bonus when gear is calibrated to a different ship', () => {
        const weapon = makeCalibratedWeapon(SHIP_B);
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined,
            SHIP_A // target ship does NOT match calibration
        );

        // Base attack (5000) + base main stat (1000) = 6000
        // The bug was that removeCalibrationStats halved the base to 500,
        // giving 5500 instead of 6000.
        expect(result.final.attack).toBe(BASE_STATS.attack + 1000);
    });

    it('does NOT apply calibration bonus when no shipId is provided', () => {
        const weapon = makeCalibratedWeapon(SHIP_A);
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined
            // no shipId
        );

        // Should use base stat (1000), not calibrated
        expect(result.final.attack).toBe(BASE_STATS.attack + 1000);
    });

    it('treats uncalibrated gear the same regardless of shipId', () => {
        const weapon = makeUncalibratedWeapon();
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const withShip = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined,
            SHIP_A
        );

        clearGearStatsCache();

        const withoutShip = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined
        );

        expect(withShip.final.attack).toBe(withoutShip.final.attack);
        expect(withShip.final.attack).toBe(BASE_STATS.attack + 1000);
    });

    it('calibration bonus only applies to the main stat, not sub stats', () => {
        const weapon: GearPiece = {
            ...makeCalibratedWeapon(SHIP_A),
            subStats: [{ name: 'attack', value: 200, type: 'flat' }],
        };
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined,
            SHIP_A
        );

        // Base (5000) + calibrated main (2000) + sub (200) = 7200
        expect(result.final.attack).toBe(BASE_STATS.attack + 2000 + 200);
    });

    it('does not apply calibration to ineligible gear (below level 16)', () => {
        const weapon: GearPiece = {
            ...makeCalibratedWeapon(SHIP_A),
            level: 12,
        };
        const gearMap: Record<string, GearPiece> = { [weapon.id]: weapon };

        const result = calculateTotalStats(
            BASE_STATS,
            { weapon: weapon.id },
            (id) => gearMap[id],
            [],
            {},
            undefined,
            SHIP_A
        );

        // Ineligible — uses base value (1000)
        expect(result.final.attack).toBe(BASE_STATS.attack + 1000);
    });
});
