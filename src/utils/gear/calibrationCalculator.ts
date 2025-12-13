import { GearPiece } from '../../types/gear';
import { Stat, StatName, BaseStats } from '../../types/stats';
import { ShipTypeName } from '../../constants';
import { calculatePriorityScore } from '../autogear/scoring';
import { calculateTotalStats } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';
import { PERCENTAGE_ONLY_STATS, PercentageOnlyStats } from '../../types/stats';

/**
 * Calibration stat increases by main stat type and star level.
 * Based on game expansion rules:
 * - Flat attack: doubles (100% increase)
 * - Flat HP: 5★ 4000→6100 (+52.5%), 6★ 5000→7500 (+50%)
 * - Flat defense: +50%
 * - Percentage stats: 5★ 40%→45% (+5pp), 6★ 50%→57% (+7pp)
 * - Flat hacking/security: +10%
 * - Flat speed: +5
 */

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
    hpRegen: {
        flat: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
        percentage: { type: 'addPercentagePoints', value5Star: 5, value6Star: 7 },
    },
    healModifier: {
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
function reverseCalibrationStatValue(stat: Stat, stars: number): number {
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
function getBaseMainStat(gear: GearPiece): Stat | null {
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

/**
 * Calculate the calibration bonus value for display purposes.
 * Returns the difference between calibrated and base (uncalibrated) value.
 * Always calculates from base stat, even if gear is already calibrated.
 */
export function getCalibrationBonus(gear: GearPiece): number {
    if (!gear.mainStat || !isCalibrationEligible(gear)) {
        return 0;
    }

    // Get base stat (reverse calibration if already calibrated)
    const baseStat = getBaseMainStat(gear);
    if (!baseStat) return 0;

    const calibratedValue = calculateCalibratedStatValue(baseStat, gear.stars);
    return calibratedValue - baseStat.value;
}

/**
 * Create a copy of the gear piece with calibration stats applied to main stat.
 * Always calculates from base stat to ensure consistency.
 */
export function applyCalibrationStats(gear: GearPiece): GearPiece {
    if (!isCalibrationEligible(gear)) {
        return gear;
    }

    // Get calibrated stat (which internally uses base stat)
    const calibratedMainStat = getCalibratedMainStat(gear);

    return {
        ...gear,
        mainStat: calibratedMainStat,
    };
}

/**
 * Calculate gear stats with optional calibration applied.
 * Always uses base (uncalibrated) stats for current calculations,
 * even if the gear is already calibrated.
 */
function calculateGearStats(piece: GearPiece, withCalibration: boolean): BaseStats {
    // For current stats, always use base (uncalibrated) version
    // For calibrated stats, apply calibration bonus
    let gearToUse: GearPiece;
    if (withCalibration) {
        // Apply calibration bonus to base stat
        gearToUse = applyCalibrationStats(piece);
    } else {
        // Use base stat (reverse calibration if already calibrated)
        const baseMainStat = getBaseMainStat(piece);
        gearToUse = {
            ...piece,
            mainStat: baseMainStat,
        };
    }

    // Calculate total crit from this gear piece for crit-capping
    let totalGearCrit = 0;
    if (gearToUse.mainStat?.name === 'crit') {
        totalGearCrit += gearToUse.mainStat.value;
    }
    gearToUse.subStats?.forEach((stat) => {
        if (stat.name === 'crit') {
            totalGearCrit += stat.value;
        }
    });

    // Adjust base crit so that final crit = 100% (crit-capped)
    const baseCrit = Math.max(0, 100 - totalGearCrit);

    const breakdown = calculateTotalStats(
        // Empty base stats with adjusted crit for crit-capping
        {
            hp: 30000,
            attack: 8000,
            defence: 8000,
            hacking: 200,
            security: 200,
            speed: 150,
            crit: baseCrit,
            critDamage: 150,
            healModifier: 0,
            defensePenetration: 0,
        },
        // Single piece of gear
        { [gearToUse.slot]: gearToUse.id },
        // Gear piece getter - return the potentially modified gear
        (id) => (id === gearToUse.id ? gearToUse : undefined),
        // No refits, implants, or engineering
        [],
        {},
        undefined
    );

    // Add set bonus stats if the piece has a set
    // Note: We apply set bonus optimistically (assuming set will be complete)
    // This is for ranking purposes - in reality, set bonus only applies with minPieces
    if (gearToUse.setBonus && GEAR_SETS[gearToUse.setBonus]) {
        const setBonus = GEAR_SETS[gearToUse.setBonus];
        if (setBonus.stats) {
            // Use the base stats (afterEngineering) for percentage calculations
            // This matches how addStatModifier works in calculateTotalStats
            const baseStats = breakdown.afterEngineering;
            setBonus.stats.forEach((stat) => {
                const isPercentageOnlyStat = PERCENTAGE_ONLY_STATS.includes(
                    stat.name as PercentageOnlyStats
                );

                if (isPercentageOnlyStat) {
                    // For percentage-only stats (crit, critDamage, etc.), add directly
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + stat.value;
                } else if (stat.type === 'percentage') {
                    // For percentage stats on flexible stats (attack, hp, etc.), calculate from base
                    const baseValue = baseStats[stat.name] || 0;
                    const bonus = baseValue * (stat.value / 100);
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + bonus;
                } else {
                    // For flat stats, add directly
                    breakdown.final[stat.name] = (breakdown.final[stat.name] || 0) + stat.value;
                }
            });
        }
    }

    return breakdown.final;
}

export interface CalibrationResult {
    piece: GearPiece;
    currentScore: number;
    calibratedScore: number;
    improvement: number;
    improvementPercentage: number;
}

/**
 * Analyze calibration potential for all eligible gear pieces.
 * Scores gear by role and calculates the improvement from calibration.
 */
export function analyzeCalibrationPotential(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count?: number
): CalibrationResult[] {
    // Filter to only calibration-eligible gear (level 16, 5-6 stars) that is not already calibrated
    const eligiblePieces = inventory.filter(
        (piece) => isCalibrationEligible(piece) && !piece.calibration?.shipId
    );

    const results: CalibrationResult[] = eligiblePieces.map((piece) => {
        const currentStats = calculateGearStats(piece, false);
        const currentScore = calculatePriorityScore(currentStats, [], shipRole);

        const calibratedStats = calculateGearStats(piece, true);
        const calibratedScore = calculatePriorityScore(calibratedStats, [], shipRole);

        const improvement = calibratedScore - currentScore;
        const improvementPercentage = currentScore > 0 ? (improvement / currentScore) * 100 : 0;

        return {
            piece,
            currentScore,
            calibratedScore,
            improvement,
            improvementPercentage,
        };
    });

    // Sort by current score descending (best gear for this role first)
    const sorted = results.sort((a, b) => b.currentScore - a.currentScore);

    // If count is specified, limit results; otherwise return all sorted results
    return count !== undefined ? sorted.slice(0, count) : sorted;
}
