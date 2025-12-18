import { BaseStats, EngineeringStat, PERCENTAGE_ONLY_STATS, Stat } from '../../types/stats';
import { Refit } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS } from '../../constants/gearSets';
import { GearSlotName } from '../../constants/gearTypes';
import { PercentageOnlyStats } from '../../types/stats';
import { getCalibratedMainStat, isCalibrationEligible } from '../gear/calibrationCalculator';

// Cache for gear piece stats to avoid recalculating
const gearStatsCache = new Map<string, { mainStat?: Stat; subStats?: Stat[] }>();

export interface StatBreakdown {
    base: BaseStats;
    afterRefits: BaseStats;
    afterEngineering: BaseStats;
    afterGear: BaseStats;
    afterSets: BaseStats;
    final: BaseStats;
}

export const calculateTotalStats = (
    baseStats: BaseStats,
    equipment: Partial<Record<GearSlotName, string>>,
    getGearPiece: (id: string) => GearPiece | undefined,
    refits: Refit[] = [],
    implants: Partial<Record<GearSlotName, string>> = {},
    engineeringStats: EngineeringStat | undefined,
    shipId?: string // Optional ship ID to check if calibrated gear should apply bonus
): StatBreakdown => {
    const breakdown: StatBreakdown = {
        base: { ...baseStats },
        afterRefits: { ...baseStats },
        afterEngineering: { ...baseStats },
        afterGear: { ...baseStats },
        afterSets: { ...baseStats },
        final: { ...baseStats },
    };

    // Process refits
    refits.forEach((refit) => {
        refit.stats.forEach((stat) => addStatModifier(stat, breakdown.afterRefits, baseStats));
    });
    Object.assign(breakdown.afterEngineering, breakdown.afterRefits);

    // Process engineering stats
    if (engineeringStats) {
        engineeringStats.stats.forEach((stat) =>
            addStatModifier(stat, breakdown.afterEngineering, baseStats)
        );
    }
    Object.assign(breakdown.afterGear, breakdown.afterEngineering);

    // Process gear with caching
    Object.values(equipment || {}).forEach((gearId) => {
        if (!gearId) return;

        const gear = getGearPiece(gearId);
        if (!gear) return;

        // Check if gear is calibrated and should apply bonus
        const shouldApplyCalibration =
            shipId && gear.calibration?.shipId === shipId && isCalibrationEligible(gear);

        // Get main stat - apply calibration if applicable
        let mainStat = gear.mainStat;
        if (shouldApplyCalibration && mainStat) {
            mainStat = getCalibratedMainStat(gear);
        }

        if (mainStat) {
            addStatModifier(mainStat, breakdown.afterGear, breakdown.afterEngineering);
        }
        if (gear.subStats) {
            gear.subStats.forEach((stat) =>
                addStatModifier(stat, breakdown.afterGear, breakdown.afterEngineering)
            );
        }
    });
    Object.assign(breakdown.afterSets, breakdown.afterGear);

    // Process set bonuses separately
    applySetBonuses();
    Object.assign(breakdown.final, breakdown.afterSets);

    // Process implants - first apply regular subStats
    Object.values(implants || {}).forEach((implantId) => {
        if (!implantId) return;
        const implant = getGearPiece(implantId);
        if (!implant) return;

        implant.subStats?.forEach((stat) =>
            addStatModifier(stat, breakdown.final, breakdown.afterEngineering)
        );
    });

    // Process special ultimate implants that alter stats based on other stats
    Object.values(implants || {}).forEach((implantId) => {
        if (!implantId) return;
        const implant = getGearPiece(implantId);
        if (!implant || !implant.setBonus) return;

        const percentageMultiplier = getSpecialImplantMultiplier(implant.setBonus, implant.rarity);
        if (percentageMultiplier === null) return;

        if (implant.setBonus === 'CODE_GUARD') {
            // CODE_GUARD: Increase security by X% of current hacking
            const hackingValue = breakdown.final.hacking || 0;
            const securityBonus = hackingValue * (percentageMultiplier / 100);
            breakdown.final.security = (breakdown.final.security || 0) + securityBonus;
        } else if (implant.setBonus === 'CIPHER_LINK') {
            // CIPHER_LINK: Increase hacking by X% of current security
            const securityValue = breakdown.final.security || 0;
            const hackingBonus = securityValue * (percentageMultiplier / 100);
            breakdown.final.hacking = (breakdown.final.hacking || 0) + hackingBonus;
        }
    });

    return breakdown;

    // Helper function to apply set bonuses
    function applySetBonuses() {
        const setCounts = countSetPieces();

        Object.entries(setCounts).forEach(([setType, count]) => {
            const bonusCount = Math.floor(count / (GEAR_SETS[setType]?.minPieces || 2));
            if (bonusCount === 0) return;

            const gearWithBonus = Object.values(equipment)
                .map((id) => id && getGearPiece(id))
                .find((gear) => gear && gear.setBonus && gear.setBonus === setType);
            if (
                !gearWithBonus ||
                !gearWithBonus.setBonus ||
                !GEAR_SETS[gearWithBonus.setBonus].stats
            )
                return;

            for (let i = 0; i < bonusCount; i++) {
                GEAR_SETS[gearWithBonus.setBonus].stats.forEach((stat) =>
                    addStatModifier(stat, breakdown.afterSets, breakdown.afterEngineering)
                );
            }
        });
    }

    // Helper function to count set pieces
    function countSetPieces(): Record<string, number> {
        const setCounts: Record<string, number> = {};

        Object.values(equipment || {}).forEach((gearId) => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;

            setCounts[gear.setBonus] = (setCounts[gear.setBonus] || 0) + 1;
        });

        return setCounts;
    }

    // Updated addStatModifier to take baseStats parameter
    function addStatModifier(stat: Stat, target: BaseStats, base: BaseStats) {
        const isPercentageOnlyStat = PERCENTAGE_ONLY_STATS.includes(
            stat.name as PercentageOnlyStats
        );

        if (isPercentageOnlyStat) {
            target[stat.name] = (target[stat.name] || 0) + stat.value;
        } else if (stat.type === 'percentage') {
            const baseValue = base[stat.name];
            const bonus = (baseValue ?? 0) * (stat.value / 100);
            target[stat.name] += bonus;
        } else {
            target[stat.name] = (target[stat.name] || 0) + stat.value;
        }
    }
};

/**
 * Get the percentage multiplier for special ultimate implants (CODE_GUARD, CIPHER_LINK)
 * based on their rarity. Returns null if the implant type doesn't have a special multiplier.
 */
function getSpecialImplantMultiplier(setBonus: string, rarity: string): number | null {
    if (setBonus === 'CODE_GUARD') {
        const multipliers: Record<string, number> = {
            common: 20,
            uncommon: 25,
            rare: 30,
            epic: 35,
            legendary: 40,
        };
        return multipliers[rarity] ?? null;
    }

    if (setBonus === 'CIPHER_LINK') {
        const multipliers: Record<string, number> = {
            common: 20,
            uncommon: 25,
            rare: 31,
            epic: 37,
            legendary: 45,
        };
        return multipliers[rarity] ?? null;
    }

    return null;
}

// Function to clear the gear stats cache
export function clearGearStatsCache(): void {
    gearStatsCache.clear();
}
