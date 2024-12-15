import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';
import { STAT_NORMALIZERS } from '../constants';

export class TwoPassStrategy implements AutogearStrategy {
    name = 'Two-Pass Algorithm';
    description = 'Fast algorithm that first optimizes stats, then looks for set opportunities';

    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): GearSuggestion[] {
        // First pass: Find best gear pieces based on individual stats
        const firstPassEquipment = this.firstPass(ship, priorities, inventory, getGearPiece, getEngineeringStatsForShipType);
        
        // Second pass: Look for set bonus opportunities
        const finalEquipment = this.secondPass(
            ship,
            priorities,
            inventory,
            firstPassEquipment,
            getGearPiece,
            getEngineeringStatsForShipType
        );

        // Convert to suggestions
        return Object.entries(finalEquipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0 // Score will be calculated later
            }));
    }

    private firstPass(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): Partial<Record<GearSlotName, string>> {
        const equipment: Partial<Record<GearSlotName, string>> = {};

        // Process each slot independently
        Object.entries(GEAR_SLOTS).forEach(([slotKey, _]) => {
            const slotName = slotKey as GearSlotName;
            let bestScore = -Infinity;
            let bestGearId: string | undefined;

            // Find best gear for this slot based on pure stats
            inventory
                .filter(gear => gear.slot === slotName)
                .forEach(gear => {
                    const testEquipment = { ...equipment, [slotName]: gear.id };
                    const totalStats = calculateTotalStats(
                        ship.baseStats,
                        testEquipment,
                        getGearPiece,
                        ship.refits,
                        ship.implants,
                        getEngineeringStatsForShipType(ship.type)
                    );

                    const score = this.calculatePriorityScore(totalStats, priorities);
                    if (score > bestScore) {
                        bestScore = score;
                        bestGearId = gear.id;
                    }
                });

            if (bestGearId) {
                equipment[slotName] = bestGearId;
            }
        });

        return equipment;
    }

    private secondPass(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): Partial<Record<GearSlotName, string>> {
        const setCount = this.countSets(currentEquipment, getGearPiece);
        const potentialSets = this.findPotentialSets(inventory, currentEquipment, getGearPiece);

        // Try to complete sets that are close to completion
        potentialSets.forEach(({ setName, pieces }) => {
            if (setCount[setName] === 1) { // We have one piece of this set
                const baseScore = this.calculateTotalScore(
                    ship, currentEquipment, priorities, getGearPiece, getEngineeringStatsForShipType
                );

                // Try each possible piece that could complete the set
                pieces.forEach(piece => {
                    const testEquipment = { ...currentEquipment };
                    testEquipment[piece.slot] = piece.id;

                    const newScore = this.calculateTotalScore(
                        ship, testEquipment, priorities, getGearPiece, getEngineeringStatsForShipType
                    );

                    // If this improves our score, keep it
                    if (newScore > baseScore) {
                        currentEquipment[piece.slot] = piece.id;
                    }
                });
            }
        });

        return currentEquipment;
    }

    private countSets(
        equipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined
    ): Record<string, number> {
        const setCount: Record<string, number> = {};
        Object.values(equipment).forEach(gearId => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
        });
        return setCount;
    }

    private findPotentialSets(
        inventory: GearPiece[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined
    ): Array<{ setName: string; pieces: GearPiece[] }> {
        const sets: Record<string, GearPiece[]> = {};

        // Group inventory items by set
        inventory.forEach(gear => {
            if (!gear.setBonus) return;
            if (!sets[gear.setBonus]) {
                sets[gear.setBonus] = [];
            }
            sets[gear.setBonus].push(gear);
        });

        return Object.entries(sets)
            .map(([setName, pieces]) => ({ setName, pieces }))
            .filter(({ setName }) => {
                // Only include sets where we already have at least one piece
                const existingPieces = Object.values(currentEquipment)
                    .filter(gearId => {
                        const gear = gearId ? getGearPiece(gearId) : undefined;
                        return gear?.setBonus === setName;
                    });
                return existingPieces.length === 1; // We have exactly one piece
            });
    }

    private calculateTotalScore(
        ship: Ship,
        equipment: Partial<Record<GearSlotName, string>>,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): number {
        const totalStats = calculateTotalStats(
            ship.baseStats,
            equipment,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        );

        let score = this.calculatePriorityScore(totalStats, priorities);

        // Add set bonus consideration
        const setCount = this.countSets(equipment, getGearPiece);
        Object.values(setCount).forEach(count => {
            if (count >= 2) {
                score *= 1.15; // 15% bonus for completed sets
            }
        });

        return score;
    }

    private calculatePriorityScore(
        stats: BaseStats,
        priorities: StatPriority[]
    ): number {
        let totalScore = 0;

        priorities.forEach((priority, index) => {
            const statValue = stats[priority.stat] || 0;
            const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
            const normalizedValue = statValue / normalizer;
            const orderMultiplier = Math.pow(2, priorities.length - index - 1);

            if (priority.maxLimit) {
                const normalizedLimit = priority.maxLimit / normalizer;
                if (normalizedValue > normalizedLimit) {
                    totalScore -= (normalizedValue - normalizedLimit) * priority.weight * orderMultiplier * 100;
                    return;
                }

                let score = normalizedValue * priority.weight * orderMultiplier;
                const ratio = normalizedValue / normalizedLimit;
                if (ratio > 0.8) {
                    score *= (1 - (ratio - 0.8));
                }
                totalScore += score;
            } else {
                totalScore += normalizedValue * priority.weight * orderMultiplier;
            }
        });

        return totalScore;
    }
} 