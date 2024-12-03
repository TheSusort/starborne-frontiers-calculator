import { BaseStats, Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { StatPriority, GearSuggestion } from '../types/autogear';
import { GEAR_SLOTS, GearSlotName } from '../constants';
import { calculateTotalStats } from './statsCalculator';

export const findOptimalGear = (
    ship: Ship,
    priorities: StatPriority[],
    inventory: GearPiece[],
    getGearPiece: (id: string) => GearPiece | undefined
): GearSuggestion[] => {
    const suggestions: GearSuggestion[] = [];
    const currentEquipment = { ...ship.equipment };

    // Process each slot independently
    Object.entries(GEAR_SLOTS).forEach(([slotKey, slotData]) => {
        const slotName = slotKey as GearSlotName;
        const availableGear: GearPiece[] = inventory.filter((gear: GearPiece) =>
            gear.slot === slotName &&
            !Object.values(currentEquipment).includes(gear.id)
        );

        let bestGear: GearPiece | null = null;
        let bestScore = -Infinity;

        // Ensure availableGear is not empty before processing
        if (availableGear.length > 0) {
            availableGear.forEach((gear: GearPiece) => {
                // Create a test equipment setup
                const testEquipment = {
                    ...currentEquipment,
                    [slotName]: gear.id
                };

                // Calculate total stats with this gear
                const totalStats = calculateTotalStats(ship.baseStats, testEquipment, getGearPiece);

                // Calculate score based on priorities
                let score = calculatePriorityScore(totalStats, priorities);

                // Add bonus for set completion if applicable
                if (gear.setBonus) {
                    const setCount = Object.values(testEquipment)
                        .map(id => id ? getGearPiece(id) : null)
                        .filter(g => g?.setBonus === gear.setBonus)
                        .length;

                    if (setCount >= 2) {
                        score *= 1.1; // 10% bonus for completing a set
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestGear = gear;
                }
            });
        }

        if (bestGear) {
            suggestions.push({
                slotName,
                gearId: bestGear['id'],
                score: bestScore
            });
            // Update current equipment for next slot's calculations
            currentEquipment[slotName] = bestGear['id'];
        }
    });

    return suggestions;
};

const calculatePriorityScore = (
    stats: BaseStats,
    priorities: StatPriority[]
): number => {
    let totalScore = 0;

    priorities.forEach(priority => {
        const statValue = stats[priority.stat] || 0;

        // If there's a max limit and we're over it, penalize heavily
        if (priority.maxLimit && statValue > priority.maxLimit) {
            totalScore -= (statValue - priority.maxLimit) * priority.weight * 100;
            return;
        }

        // Calculate score based on weight and value
        let score = statValue * priority.weight;

        // Apply diminishing returns for values approaching max limit
        if (priority.maxLimit) {
            const ratio = statValue / priority.maxLimit;
            if (ratio > 0.8) {
                score *= (1 - (ratio - 0.8)); // Reduce score as we approach limit
            }
        }

        totalScore += score;
    });

    return totalScore;
};