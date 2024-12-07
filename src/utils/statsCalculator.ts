import { BaseStats, Stat } from '../types/stats';
import { Implant, Refit } from '../types/ship';
import { GearPiece } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';
import { GearSlotName } from '../constants/gearTypes';
export const calculateTotalStats = (
    baseStats: BaseStats,
    equipment: Partial<Record<GearSlotName, string>>,
    getGearPiece: (id: string) => GearPiece | undefined,
    refits: Refit[] = [],
    implants: Implant[] = []
): BaseStats => {
    // Start with base stats
    const totalStats = { ...baseStats };
    const statsAfterGear = { ...baseStats };

    // Process all equipped gear
    Object.values(equipment).forEach(gearId => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear) return;

        // Process main stat
        addStatModifier(gear.mainStat, totalStats, baseStats);

        // Process sub stats
        gear.subStats.forEach(stat => addStatModifier(stat, totalStats, baseStats));
    });

    // Store stats after gear for implant calculations
    Object.assign(statsAfterGear, totalStats);

    // Process set bonuses
    applySetBonuses();

    // Process refits (calculated from base stats)
    refits.forEach(refit => {
        refit.stats.forEach(stat => addStatModifier(stat, totalStats, baseStats));
    });

    // Process implants (calculated from stats after gear)
    implants.forEach(implant => {
        implant.stats.forEach(stat => addStatModifier(stat, totalStats, statsAfterGear));
    });

    return totalStats;

    // Helper function to count set pieces
    function countSetPieces(): Record<string, number> {
        const setCounts: Record<string, number> = {};

        Object.values(equipment).forEach(gearId => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus || !GEAR_SETS[gear.setBonus].name) return;

            setCounts[GEAR_SETS[gear.setBonus].name] = (setCounts[GEAR_SETS[gear.setBonus].name] || 0) + 1;
        });

        return setCounts;
    }

    // Helper function to apply set bonuses
    function applySetBonuses() {
        const setCounts = countSetPieces();

        Object.entries(setCounts).forEach(([setType, count]) => {
            // Calculate how many times the set bonus should apply (2-piece sets)
            const bonusCount = Math.floor(count / 2);
            if (bonusCount === 0) return;

            // Find a piece with this set bonus to get the bonus stats
            const gearWithBonus = Object.values(equipment)
                .map(id => id && getGearPiece(id))
                .find(gear => gear && GEAR_SETS[gear.setBonus].name === setType);

            if (!gearWithBonus || (!gearWithBonus.setBonus || !GEAR_SETS[gearWithBonus.setBonus].stats)) return;

            // Apply the set bonus multiple times if applicable
            for (let i = 0; i < bonusCount; i++) {
                GEAR_SETS[gearWithBonus.setBonus].stats.forEach(stat =>
                    addStatModifier(stat, totalStats, baseStats)
                );
            }
        });
    }

    // Updated addStatModifier to take baseStats parameter
    function addStatModifier(stat: Stat, target: BaseStats, base: BaseStats) {
        const isPercentageOnlyStat = ['crit', 'critDamage', 'healModifier'].includes(stat.name);

        if (isPercentageOnlyStat) {
            target[stat.name] = (target[stat.name] || 0) + stat.value;
        } else if (stat.type === 'percentage') {
            const baseValue = base[stat.name];
            const bonus = baseValue * (stat.value / 100);
            target[stat.name] += bonus;
            target[stat.name] = Math.round(target[stat.name] * 100) / 100;
        } else {
            target[stat.name] = (target[stat.name] || 0) + stat.value;
        }
    }
};