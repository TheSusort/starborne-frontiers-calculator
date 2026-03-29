import { GearPiece } from '../../types/gear';
import {
    Stat,
    BaseStats,
    PERCENTAGE_ONLY_STATS,
    PercentageOnlyStats,
    EngineeringStat,
} from '../../types/stats';
import { ShipTypeName, GearSlotName } from '../../constants';
import { calculatePriorityScore } from '../autogear/priorityScore';
import { calculateTotalStats } from '../ship/statsCalculator';
import { GEAR_SETS } from '../../constants/gearSets';
import { Ship } from '../../types/ship';
import {
    isCalibrationEligible,
    getCalibratedMainStat,
    getBaseMainStat,
    reverseCalibrationStatValue,
} from './calibrationUtils';

// Re-export the pure calibration functions so existing imports from this module continue to work
export { isCalibrationEligible, getCalibratedMainStat };

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
 * Create a copy of the gear piece with calibration stats removed from main stat.
 * Used when scoring calibrated gear for ships other than the one it's calibrated to.
 * Since imported calibrated gear has boosted stats, this reverses the bonus to get base stats.
 */
export function removeCalibrationStats(gear: GearPiece): GearPiece {
    if (!isCalibrationEligible(gear) || !gear.calibration?.shipId) {
        return gear;
    }

    if (!gear.mainStat) {
        return gear;
    }

    const baseMainStat: Stat = {
        ...gear.mainStat,
        value: reverseCalibrationStatValue(gear.mainStat, gear.stars),
    };

    return {
        ...gear,
        mainStat: baseMainStat,
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

export interface SlotCalibrationResult {
    slot: GearSlotName;
    gear: GearPiece | null;
    currentScore: number;
    calibratedScore: number;
    improvement: number;
    improvementPercentage: number;
    isEligible: boolean;
}

/**
 * Analyze calibration impact for a specific ship's equipped gear.
 * Returns per-slot analysis showing how much each slot would improve if calibrated.
 */
export function analyzeShipCalibrationImpact(
    ship: Ship,
    shipRole: ShipTypeName,
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): {
    currentTotalScore: number;
    calibratedTotalScore: number;
    totalImprovement: number;
    totalImprovementPercentage: number;
    slots: SlotCalibrationResult[];
} {
    const GEAR_SLOT_NAMES: GearSlotName[] = [
        'weapon',
        'hull',
        'generator',
        'sensor',
        'software',
        'thrusters',
    ];

    // Calculate current total score with all gear
    const currentTotalStats = calculateTotalStats(
        ship.baseStats,
        ship.equipment,
        getGearPiece,
        ship.refits,
        ship.implants,
        getEngineeringStatsForShipType(ship.type),
        ship.id
    );
    const currentTotalScore = calculatePriorityScore(currentTotalStats.final, [], shipRole);

    // Calculate per-slot improvements
    const slotResults: SlotCalibrationResult[] = GEAR_SLOT_NAMES.map((slot) => {
        const gearId = ship.equipment[slot];
        const gear = gearId ? getGearPiece(gearId) : null;

        if (!gear) {
            return {
                slot,
                gear: null,
                currentScore: 0,
                calibratedScore: 0,
                improvement: 0,
                improvementPercentage: 0,
                isEligible: false,
            };
        }

        // Check if this gear is eligible for calibration
        const eligible = isCalibrationEligible(gear) && !gear.calibration?.shipId;

        // Current score is the total ship score (same for all slots)
        const currentScore = currentTotalScore;

        // Calculate calibrated score: total ship score if this slot's gear were calibrated
        let calibratedScore = currentTotalScore;
        if (eligible) {
            // Create a modified equipment object with calibrated gear for this slot
            const calibratedGear = applyCalibrationStats(gear);
            const calibratedEquipment = {
                ...ship.equipment,
                [slot]: calibratedGear.id,
            };

            // Create a gear getter that returns calibrated gear for this slot only
            const getCalibratedGearPiece = (id: string) => {
                if (id === gear.id) {
                    return calibratedGear;
                }
                return getGearPiece(id);
            };

            const calibratedStats = calculateTotalStats(
                ship.baseStats,
                calibratedEquipment,
                getCalibratedGearPiece,
                ship.refits,
                ship.implants,
                getEngineeringStatsForShipType(ship.type),
                ship.id
            );
            calibratedScore = calculatePriorityScore(calibratedStats.final, [], shipRole);
        }

        const improvement = calibratedScore - currentTotalScore;
        const improvementPercentage =
            currentTotalScore > 0 ? (improvement / currentTotalScore) * 100 : 0;

        return {
            slot,
            gear,
            currentScore,
            calibratedScore,
            improvement,
            improvementPercentage,
            isEligible: eligible,
        };
    });

    // Calculate total improvement if all eligible gear were calibrated
    const allCalibratedEquipment: Partial<Record<GearSlotName, string>> = { ...ship.equipment };
    const allCalibratedGearGetter = (id: string) => {
        const gear = getGearPiece(id);
        if (!gear) return undefined;

        // Apply calibration if eligible
        if (isCalibrationEligible(gear) && !gear.calibration?.shipId) {
            return applyCalibrationStats(gear);
        }
        return gear;
    };

    const calibratedTotalStats = calculateTotalStats(
        ship.baseStats,
        allCalibratedEquipment,
        allCalibratedGearGetter,
        ship.refits,
        ship.implants,
        getEngineeringStatsForShipType(ship.type),
        ship.id
    );
    const calibratedTotalScore = calculatePriorityScore(calibratedTotalStats.final, [], shipRole);

    const totalImprovement = calibratedTotalScore - currentTotalScore;
    const totalImprovementPercentage =
        currentTotalScore > 0 ? (totalImprovement / currentTotalScore) * 100 : 0;

    return {
        currentTotalScore,
        calibratedTotalScore,
        totalImprovement,
        totalImprovementPercentage,
        slots: slotResults,
    };
}
