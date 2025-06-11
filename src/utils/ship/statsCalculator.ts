import { BaseStats, EngineeringStat, PERCENTAGE_ONLY_STATS, Stat } from '../../types/stats';
import { Refit } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { GEAR_SETS } from '../../constants/gearSets';
import { GearSlotName } from '../../constants/gearTypes';
import { PercentageOnlyStats } from '../../types/stats';

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
    engineeringStats: EngineeringStat | undefined
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

    // Process gear
    Object.values(equipment || {}).forEach((gearId) => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear) return;

        if (gear.mainStat) {
            addStatModifier(gear.mainStat, breakdown.afterGear, breakdown.afterEngineering);
        }
        gear.subStats?.forEach((stat) =>
            addStatModifier(stat, breakdown.afterGear, breakdown.afterEngineering)
        );
    });
    Object.assign(breakdown.afterSets, breakdown.afterGear);

    // Process set bonuses separately
    applySetBonuses();
    Object.assign(breakdown.final, breakdown.afterSets);

    // Process implants
    Object.values(implants || {}).forEach((implantId) => {
        if (!implantId) return;
        const implant = getGearPiece(implantId);
        if (!implant) return;

        implant.subStats?.forEach((stat) =>
            addStatModifier(stat, breakdown.final, breakdown.afterEngineering)
        );
    });

    return breakdown;

    // Helper function to apply set bonuses
    function applySetBonuses() {
        const setCounts = countSetPieces();

        Object.entries(setCounts).forEach(([setType, count]) => {
            const bonusCount = Math.floor(count / 2);
            if (bonusCount === 0) return;

            const gearWithBonus = Object.values(equipment)
                .map((id) => id && getGearPiece(id))
                .find((gear) => gear && gear.setBonus && GEAR_SETS[gear.setBonus].name === setType);

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
            if (!gear?.setBonus || !GEAR_SETS[gear.setBonus].name) return;

            setCounts[GEAR_SETS[gear.setBonus].name] =
                (setCounts[GEAR_SETS[gear.setBonus].name] || 0) + 1;
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
