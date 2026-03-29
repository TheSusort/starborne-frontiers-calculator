/**
 * Pure calibration utility functions that have no dependency on statsCalculator.
 * Extracted to break the circular dependency:
 *   calibrationCalculator ↔ statsCalculator
 *
 * Both calibrationCalculator and statsCalculator import from this file.
 */

import { GearPiece } from '../../types/gear';
import { Stat, StatName } from '../../types/stats';

interface CalibrationBonus {
    type: 'multiply' | 'add' | 'addPercentagePoints';
    value5Star: number;
    value6Star: number;
}

const CALIBRATION_BONUSES: Partial<
    Record<StatName, Record<'flat' | 'percentage', CalibrationBonus>>
> = {
    attack: {
        flat: { type: 'multiply', value5Star: 2, value6Star: 2 }, // Doubles
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    hp: {
        flat: { type: 'multiply', value5Star: 1.525, value6Star: 1.5 }, // 4000→6100, 5000→7500
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    defence: {
        flat: { type: 'multiply', value5Star: 1.5, value6Star: 1.5 }, // +50%
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    hacking: {
        flat: { type: 'multiply', value5Star: 1.1, value6Star: 1.1 }, // +10%
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    security: {
        flat: { type: 'multiply', value5Star: 1.1, value6Star: 1.1 }, // +10%
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    speed: {
        flat: { type: 'add', value5Star: 5, value6Star: 5 }, // +5
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    crit: {
        flat: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    critDamage: {
        flat: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
};

/**
 * Check if a gear piece is eligible for calibration.
 * Requirements: level 16, stars 5 or 6
 */
export function isCalibrationEligible(gear: GearPiece): boolean {
    return (
        gear.level === 16 &&
        (gear.stars === 5 || gear.stars === 6) &&
        !gear.slot.includes('implant')
    );
}

/**
 * Calculate the calibrated value for a stat.
 */
function calculateCalibratedStatValue(stat: Stat, stars: number): number {
    const bonus = CALIBRATION_BONUSES[stat.name]?.[stat.type];
    if (!bonus) {
        // Default to percentage point addition for unknown stats
        const ppBonus = stars === 6 ? 7 : 5;
        return stat.value + ppBonus;
    }

    const bonusValue = stars === 6 ? bonus.value6Star : bonus.value5Star;

    switch (bonus.type) {
        case 'multiply':
            return Math.round(stat.value * bonusValue);
        case 'add':
            return stat.value + bonusValue;
        case 'addPercentagePoints':
            return stat.value + bonusValue;
        default:
            return stat.value;
    }
}

/**
 * Reverse the calibration bonus to get the base (uncalibrated) stat value.
 * This is used to calculate what the stat would be without calibration.
 */
export function reverseCalibrationStatValue(stat: Stat, stars: number): number {
    const bonus = CALIBRATION_BONUSES[stat.name]?.[stat.type];
    if (!bonus) {
        // Default to subtracting percentage points for unknown stats
        const ppBonus = stars === 6 ? 7 : 5;
        return stat.value - ppBonus;
    }

    const bonusValue = stars === 6 ? bonus.value6Star : bonus.value5Star;

    switch (bonus.type) {
        case 'multiply':
            // If calibrated = original * multiplier, then original = calibrated / multiplier
            return Math.round(stat.value / bonusValue);
        case 'add':
            // If calibrated = original + bonus, then original = calibrated - bonus
            return stat.value - bonusValue;
        case 'addPercentagePoints':
            // If calibrated = original + pp, then original = calibrated - pp
            return stat.value - bonusValue;
        default:
            return stat.value;
    }
}

/**
 * Get the base (uncalibrated) main stat for a gear piece.
 * The stored mainStat value should always be the base value, regardless of calibration status.
 * Calibration metadata only indicates which ship it's calibrated to.
 */
export function getBaseMainStat(gear: GearPiece): Stat | null {
    // Always return the stored mainStat as-is - it should always be the base value
    // Calibration is just metadata about which ship it's calibrated to
    return gear.mainStat;
}

/**
 * Get the calibrated main stat for a gear piece.
 * Returns the main stat with calibration bonus applied.
 */
export function getCalibratedMainStat(gear: GearPiece): Stat | null {
    if (!gear.mainStat || !isCalibrationEligible(gear)) {
        return gear.mainStat;
    }

    // Always calculate from base stat to ensure consistency
    const baseStat = getBaseMainStat(gear);
    if (!baseStat) return null;

    return {
        ...baseStat,
        value: calculateCalibratedStatValue(baseStat, gear.stars),
    };
}
