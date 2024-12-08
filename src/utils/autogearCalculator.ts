import { BaseStats } from '../types/stats';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { StatPriority, GearSuggestion } from '../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../constants';
import { calculateTotalStats } from './statsCalculator';
import { EngineeringStat } from '../types/stats';
interface GearConfiguration {
    equipment: Partial<Record<GearSlotName, string>>;
    score: number;
}

const BEAM_WIDTH = 5; // Keep top 5 configurations at each step

export const findOptimalGear = (
    ship: Ship,
    priorities: StatPriority[],
    inventory: GearPiece[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): GearSuggestion[] => {

    // Start with empty configuration
    let configurations: GearConfiguration[] = [{
        equipment: {},
        score: 0
    }];

    // Process each slot
    Object.entries(GEAR_SLOTS).forEach(([slotKey, slotData]) => {
        const slotName = slotKey as GearSlotName;
        const newConfigurations: GearConfiguration[] = [];

        // Get available gear for this slot
        const availableGear = inventory.filter(gear =>
            gear.slot === slotName &&
            !Object.values(configurations[0].equipment).includes(gear.id)
        );

        // For each current configuration
        configurations.forEach(config => {
            // Try each possible gear piece
            availableGear.forEach(gear => {
                const newEquipment = {
                    ...config.equipment,
                    [slotName]: gear.id
                };

                const totalStats = calculateTotalStats(
                    ship.baseStats,
                    newEquipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type)
                );

                const score = calculateConfigurationScore(
                    totalStats,
                    priorities,
                    newEquipment,
                    getGearPiece
                );

                newConfigurations.push({
                    equipment: newEquipment,
                    score
                });
            });
        });

        // Keep only the top configurations
        configurations = newConfigurations
            .sort((a, b) => b.score - a.score)
            .slice(0, BEAM_WIDTH);
    });

    // Convert best configuration to suggestions
    const bestConfig = configurations[0];
    return Object.entries(bestConfig.equipment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([slotName, gearId]) => ({
            slotName,
            gearId,
            score: bestConfig.score
        }));
};

const calculateConfigurationScore = (
    stats: BaseStats,
    priorities: StatPriority[],
    equipment: Partial<Record<GearSlotName, string>>,
    getGearPiece: (id: string) => GearPiece | undefined
): number => {
    let score = calculatePriorityScore(stats, priorities);

    // Calculate set bonuses more accurately
    const setCount: Record<string, number> = {};
    Object.values(equipment).forEach(gearId => {
        if (!gearId) return;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) return;
        setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
    });

    // Apply set bonus multipliers
    Object.entries(setCount).forEach(([setName, count]) => {
        if (count >= 2) {
            score *= 1.15; // 15% bonus for each completed set
        } else if (count === 1) {
            score *= 1.05; // 5% bonus for potential future set completion
        }
    });

    return score;
};

const calculatePriorityScore = (
    stats: BaseStats,
    priorities: StatPriority[]
): number => {
    let totalScore = 0;

    // Apply exponential weighting based on priority order
    priorities.forEach((priority, index) => {
        const statValue = stats[priority.stat] || 0;
        const orderMultiplier = Math.pow(2, priorities.length - index - 1);

        // If there's a max limit and we're over it, penalize heavily
        if (priority.maxLimit && statValue > priority.maxLimit) {
            totalScore -= (statValue - priority.maxLimit) * priority.weight * orderMultiplier * 100;
            return;
        }

        // Calculate score based on weight, value, and priority order
        let score = statValue * priority.weight * orderMultiplier;

        // Apply diminishing returns for values approaching max limit
        if (priority.maxLimit) {
            const ratio = statValue / priority.maxLimit;
            if (ratio > 0.8) {
                score *= (1 - (ratio - 0.8));
            }
        }

        totalScore += score;
    });

    return totalScore;
};