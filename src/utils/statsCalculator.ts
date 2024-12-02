import { BaseStats } from '../types/ship';
import { GearSlot, Stat, GearPiece } from '../types/gear';
import { GEAR_SETS } from '../constants/gearSets';

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

    // Process set bonuses
    applySetBonuses();
    
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
                GEAR_SETS[gearWithBonus.setBonus].stats.forEach(addStatModifier);
            }
        });
    }

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