import { describe, it, expect } from 'vitest';
import {
    isCalibrationEligible,
    getCalibratedMainStat,
    getBaseMainStat,
    reverseCalibrationStatValue,
} from '../calibrationUtils';
import { GearPiece } from '../../../types/gear';
import { Stat } from '../../../types/stats';

/** Helper to build a minimal gear piece with sensible defaults. */
function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// isCalibrationEligible
// ---------------------------------------------------------------------------
describe('isCalibrationEligible', () => {
    it('returns true for level 16, 6-star gear', () => {
        expect(isCalibrationEligible(makeGear())).toBe(true);
    });

    it('returns true for level 16, 5-star gear', () => {
        expect(isCalibrationEligible(makeGear({ stars: 5 }))).toBe(true);
    });

    it('returns false for gear below level 16', () => {
        expect(isCalibrationEligible(makeGear({ level: 15 }))).toBe(false);
    });

    it('returns false for gear below 5 stars', () => {
        expect(isCalibrationEligible(makeGear({ stars: 4 }))).toBe(false);
    });

    it('returns false for implants', () => {
        expect(isCalibrationEligible(makeGear({ slot: 'implant_major' }))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getBaseMainStat
// ---------------------------------------------------------------------------
describe('getBaseMainStat', () => {
    it('returns mainStat as-is (stored values are always base)', () => {
        const gear = makeGear({ mainStat: { name: 'attack', value: 1000, type: 'flat' } });
        expect(getBaseMainStat(gear)).toEqual({ name: 'attack', value: 1000, type: 'flat' });
    });

    it('returns null when gear has no mainStat', () => {
        expect(getBaseMainStat(makeGear({ mainStat: null }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getCalibratedMainStat
// ---------------------------------------------------------------------------
describe('getCalibratedMainStat', () => {
    it('doubles flat attack for 6-star gear', () => {
        const gear = makeGear({ mainStat: { name: 'attack', value: 1000, type: 'flat' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('doubles flat attack for 5-star gear', () => {
        const gear = makeGear({
            stars: 5,
            mainStat: { name: 'attack', value: 800, type: 'flat' },
        });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'attack', value: 1600, type: 'flat' });
    });

    it('adds 7 percentage points for 6-star percentage attack', () => {
        const gear = makeGear({ mainStat: { name: 'attack', value: 50, type: 'percentage' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'attack', value: 57, type: 'percentage' });
    });

    it('adds 5 percentage points for 5-star percentage attack', () => {
        const gear = makeGear({
            stars: 5,
            mainStat: { name: 'attack', value: 40, type: 'percentage' },
        });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'attack', value: 45, type: 'percentage' });
    });

    it('applies 1.5x multiplier to flat HP for 6-star', () => {
        const gear = makeGear({ mainStat: { name: 'hp', value: 5000, type: 'flat' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'hp', value: 7500, type: 'flat' });
    });

    it('applies 1.5x multiplier to flat defence for 6-star', () => {
        const gear = makeGear({ mainStat: { name: 'defence', value: 1000, type: 'flat' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'defence', value: 1500, type: 'flat' });
    });

    it('adds +5 to flat speed for 6-star', () => {
        const gear = makeGear({ mainStat: { name: 'speed', value: 45, type: 'flat' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'speed', value: 50, type: 'flat' });
    });

    it('adds +7 percentage points to crit for 6-star', () => {
        const gear = makeGear({ mainStat: { name: 'crit', value: 50, type: 'percentage' } });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'crit', value: 57, type: 'percentage' });
    });

    it('returns mainStat unchanged for ineligible gear', () => {
        const gear = makeGear({
            level: 12,
            mainStat: { name: 'attack', value: 500, type: 'flat' },
        });
        const result = getCalibratedMainStat(gear);
        expect(result).toEqual({ name: 'attack', value: 500, type: 'flat' });
    });

    it('returns null when mainStat is null', () => {
        expect(getCalibratedMainStat(makeGear({ mainStat: null }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// reverseCalibrationStatValue — round-trip consistency
// ---------------------------------------------------------------------------
describe('reverseCalibrationStatValue', () => {
    const roundTripCases: Array<{ stat: Stat; stars: number; label: string }> = [
        { stat: { name: 'attack', value: 1000, type: 'flat' }, stars: 6, label: 'flat attack 6★' },
        { stat: { name: 'attack', value: 800, type: 'flat' }, stars: 5, label: 'flat attack 5★' },
        {
            stat: { name: 'attack', value: 50, type: 'percentage' },
            stars: 6,
            label: 'pct attack 6★',
        },
        { stat: { name: 'hp', value: 5000, type: 'flat' }, stars: 6, label: 'flat hp 6★' },
        {
            stat: { name: 'defence', value: 1000, type: 'flat' },
            stars: 6,
            label: 'flat defence 6★',
        },
        { stat: { name: 'speed', value: 45, type: 'flat' }, stars: 6, label: 'flat speed 6★' },
        {
            stat: { name: 'hacking', value: 100, type: 'flat' },
            stars: 6,
            label: 'flat hacking 6★',
        },
    ];

    it.each(roundTripCases)(
        'getCalibratedMainStat → reverseCalibrationStatValue round-trips for $label',
        ({ stat, stars }) => {
            const gear = makeGear({ mainStat: stat, stars });
            const calibrated = getCalibratedMainStat(gear)!;
            const reversed = reverseCalibrationStatValue(calibrated, stars);
            expect(reversed).toBe(stat.value);
        }
    );
});
