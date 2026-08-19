import { describe, it, expect } from 'vitest';
import {
    assumedCalibrationEligible,
    withAssumedCalibration,
    makeAssumedCalibrationGetter,
} from '../assumedCalibration';
import { GearPiece } from '../../../types/gear';

/** Minimal gear piece; defaults are calibration-eligible today (level 16, 6 stars). */
function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [{ name: 'hp', value: 500, type: 'flat' }],
        setBonus: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// assumedCalibrationEligible
// ---------------------------------------------------------------------------
describe('assumedCalibrationEligible', () => {
    it('accepts level 16 6-star gear', () => {
        expect(assumedCalibrationEligible(makeGear(), false)).toBe(true);
    });

    it('accepts level 16 5-star gear', () => {
        expect(assumedCalibrationEligible(makeGear({ stars: 5 }), false)).toBe(true);
    });

    it('rejects gear below 5 stars', () => {
        expect(assumedCalibrationEligible(makeGear({ stars: 4 }), false)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ stars: 4 }), true)).toBe(false);
    });

    it('rejects implants in every slot', () => {
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_major' }), true)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_minor_1' }), true)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ slot: 'implant_ultimate' }), true)).toBe(
            false
        );
    });

    it('rejects sub-16 gear when simulated levels are NOT allowed', () => {
        expect(assumedCalibrationEligible(makeGear({ level: 0 }), false)).toBe(false);
        expect(assumedCalibrationEligible(makeGear({ level: 15 }), false)).toBe(false);
    });

    it('accepts sub-16 gear when simulated levels ARE allowed', () => {
        expect(assumedCalibrationEligible(makeGear({ level: 0 }), true)).toBe(true);
        expect(assumedCalibrationEligible(makeGear({ level: 15 }), true)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// withAssumedCalibration
// ---------------------------------------------------------------------------
describe('withAssumedCalibration', () => {
    it('bakes the calibrated value into the main stat', () => {
        const result = withAssumedCalibration(makeGear(), false);
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('leaves sub-stats untouched', () => {
        const result = withAssumedCalibration(makeGear(), false);
        expect(result.subStats).toEqual([{ name: 'hp', value: 500, type: 'flat' }]);
    });

    it('does not mutate the input piece', () => {
        const gear = makeGear();
        withAssumedCalibration(gear, false);
        expect(gear.mainStat).toEqual({ name: 'attack', value: 1000, type: 'flat' });
    });

    it('preserves id, slot, set bonus and stars', () => {
        const gear = makeGear({ id: 'g-9', setBonus: 'DECIMATION', stars: 5 });
        const result = withAssumedCalibration(gear, false);
        expect(result.id).toBe('g-9');
        expect(result.slot).toBe('weapon');
        expect(result.setBonus).toBe('DECIMATION');
        expect(result.stars).toBe(5);
    });

    it('returns ineligible pieces unchanged (same reference)', () => {
        const implant = makeGear({ slot: 'implant_major' });
        expect(withAssumedCalibration(implant, true)).toBe(implant);

        const lowStar = makeGear({ stars: 4 });
        expect(withAssumedCalibration(lowStar, true)).toBe(lowStar);

        const unleveled = makeGear({ level: 0 });
        expect(withAssumedCalibration(unleveled, false)).toBe(unleveled);
    });

    it('returns a piece with no main stat unchanged (same reference)', () => {
        const noMain = makeGear({ mainStat: null });
        expect(withAssumedCalibration(noMain, false)).toBe(noMain);
    });

    it('calibrates sub-16 gear when simulated levels are allowed', () => {
        const result = withAssumedCalibration(makeGear({ level: 0 }), true);
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    // The double-application guard. Downstream consumers (statsCalculator,
    // fastScoring/gearRegistry) apply the bonus themselves when
    // gear.calibration.shipId matches the ship being scored. Stripping the
    // metadata is what stops them applying it a SECOND time on top of ours.
    it('strips calibration metadata so downstream cannot apply the bonus again', () => {
        const gear = makeGear({ calibration: { shipId: 'ship-1' } });
        const result = withAssumedCalibration(gear, false);
        expect(result.calibration).toBeUndefined();
        expect(result.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('gives a piece calibrated elsewhere the same value as an uncalibrated one', () => {
        const mine = withAssumedCalibration(makeGear({ calibration: { shipId: 'other' } }), false);
        const free = withAssumedCalibration(makeGear(), false);
        expect(mine.mainStat).toEqual(free.mainStat);
    });

    it('calibrates 5-star differently from 6-star when bonuses diverge', () => {
        // hp/flat has value5Star: 1.525 and value6Star: 1.5 (multiply type)
        const hp5 = withAssumedCalibration(
            makeGear({ stars: 5, mainStat: { name: 'hp', value: 4000, type: 'flat' } }),
            false
        );
        expect(hp5.mainStat).toEqual({ name: 'hp', value: 6100, type: 'flat' });

        const hp6 = withAssumedCalibration(
            makeGear({ stars: 6, mainStat: { name: 'hp', value: 4000, type: 'flat' } }),
            false
        );
        expect(hp6.mainStat).toEqual({ name: 'hp', value: 6000, type: 'flat' });
    });
});

// ---------------------------------------------------------------------------
// makeAssumedCalibrationGetter
// ---------------------------------------------------------------------------
describe('makeAssumedCalibrationGetter', () => {
    it('transforms whatever the wrapped getter returns', () => {
        const inner = (id: string) => (id === 'gear-1' ? makeGear() : undefined);
        const getter = makeAssumedCalibrationGetter(inner, false);
        expect(getter('gear-1')?.mainStat).toEqual({ name: 'attack', value: 2000, type: 'flat' });
    });

    it('passes undefined straight through for an unknown id', () => {
        const getter = makeAssumedCalibrationGetter(() => undefined, false);
        expect(getter('nope')).toBeUndefined();
    });

    // The getter is called once per gear per scored loadout in the slow path's
    // hot loop. Without memoisation it would allocate a fresh object every call.
    it('memoises: repeated calls return the identical object and hit the inner getter once', () => {
        let calls = 0;
        const inner = (_id: string) => {
            calls++;
            return makeGear();
        };
        const getter = makeAssumedCalibrationGetter(inner, false);
        const first = getter('gear-1');
        const second = getter('gear-1');
        expect(first).toBe(second);
        expect(calls).toBe(1);
    });

    it('composes over an upgraded-stats getter: calibrates the SIMULATED value', () => {
        // Mirrors AutogearPage's upgradedGearGetter, which swaps in the
        // simulated level-16 main stat for a sub-16 piece. The calibration
        // bonus must land on 1200 (the simulated value), not on 300.
        const raw = makeGear({ level: 0, mainStat: { name: 'attack', value: 300, type: 'flat' } });
        const upgraded = (_id: string): GearPiece => ({
            ...raw,
            mainStat: { name: 'attack', value: 1200, type: 'flat' },
        });
        const getter = makeAssumedCalibrationGetter(upgraded, true);
        expect(getter('gear-1')?.mainStat).toEqual({
            name: 'attack',
            value: 2400,
            type: 'flat',
        });
    });
});
