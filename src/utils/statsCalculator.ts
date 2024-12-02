import { BaseStats } from '../types/ship';
import { GearSlot, Stat, GearPiece } from '../types/gear';

export const calculateTotalStats = (
    baseStats: BaseStats, 
    equipment: Partial<Record<GearSlot, string>>,
    getGearPiece: (id: string) => GearPiece | undefined
): BaseStats => {
    // Start with base stats
    const totalStats = { ...baseStats };

    // Process all equipped gear
    Object.values(equipment).forEach(gearId => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear) return;

        // Process main stat
        addStatModifier(gear.mainStat);
        
        // Process sub stats
        gear.subStats.forEach(addStatModifier);
    });
    
    return totalStats;

    // Helper function to process each stat
    function addStatModifier(stat: Stat) {
        const isPercentageOnlyStat = ['crit', 'critDamage', 'healModifier'].includes(stat.name);
        
        if (isPercentageOnlyStat) {
            // For percentage-only stats, we simply add the percentages
            totalStats[stat.name] = (totalStats[stat.name] || 0) + stat.value;
        } else if (stat.type === 'percentage') {
            // For percentage stats, calculate bonus based on base stat and add it
            const baseValue = baseStats[stat.name];
            const bonus = baseValue * (stat.value / 100);
            totalStats[stat.name] += bonus;
            // Round to prevent floating point issues
            totalStats[stat.name] = Math.round(totalStats[stat.name] * 100) / 100;
        } else {
            // For flat stats, simply add the value
            totalStats[stat.name] = (totalStats[stat.name] || 0) + stat.value;
        }
    }
}; 