import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';
import { calculatePriorityScore, calculateTotalScore } from '../scoring';

/**
 * Two-Pass Strategy
 *
 * This strategy is a fast algorithm that first optimizes stats, then looks for set opportunities.
 * It is a more balanced strategy that is more likely to find the optimal gear combinations.
 *
 * Shortly explained:
 * 1. First pass: Find best gear pieces based on individual stats
 * 2. Second pass: Look for set bonus opportunities
 * 3. Return the best gear combination
 */
export class TwoPassStrategy extends BaseStrategy {
    name = 'Two-Pass Algorithm';
    description = 'Fast algorithm that first optimizes stats, then looks for set opportunities';

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): Promise<GearSuggestion[]> {
        // Initialize progress tracking (slots * gear + potential set combinations)
        const totalOperations = Object.keys(GEAR_SLOTS).length * inventory.length +
            inventory.filter(g => g.setBonus).length;
        this.initializeProgress(totalOperations);

        // First pass: Find best gear pieces based on individual stats
        const firstPassEquipment = await this.firstPass(ship, priorities, inventory, getGearPiece, getEngineeringStatsForShipType, shipRole);

        // Second pass: Look for set bonus opportunities
        const finalEquipment = await this.secondPass(
            ship,
            priorities,
            inventory,
            firstPassEquipment,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole
        );

        // Ensure progress is complete
        this.completeProgress();

        // Convert to suggestions
        return Object.entries(finalEquipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0 // Score will be calculated later
            }));
    }

    private async firstPass(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): Promise<Partial<Record<GearSlotName, string>>> {
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

                    const score = this.calculateStatScore(totalStats, priorities, shipRole);
                    if (score > bestScore) {
                        bestScore = score;
                        bestGearId = gear.id;
                    }
                    this.incrementProgress();
                });

            if (bestGearId) {
                equipment[slotName] = bestGearId;
            }
        });

        return equipment;
    }

    private async secondPass(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): Promise<Partial<Record<GearSlotName, string>>> {
        const setCount = this.countSets(currentEquipment, getGearPiece);
        const potentialSets = this.findPotentialSets(inventory, currentEquipment, getGearPiece);

        // Try to complete sets that are close to completion
        potentialSets.forEach(({ setName, pieces }) => {
            if (setCount[setName] === 1) { // We have one piece of this set
                const baseScore = this.evaluateEquipment(
                    ship, currentEquipment, priorities, getGearPiece, getEngineeringStatsForShipType, shipRole
                );

                // Try each possible piece that could complete the set
                pieces.forEach(piece => {
                    const testEquipment = { ...currentEquipment };
                    testEquipment[piece.slot] = piece.id;

                    const newScore = this.evaluateEquipment(
                        ship, testEquipment, priorities, getGearPiece, getEngineeringStatsForShipType, shipRole
                    );

                    // If this improves our score, keep it
                    if (newScore > baseScore) {
                        currentEquipment[piece.slot] = piece.id;
                    }
                    this.incrementProgress();
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

    private calculateStatScore(
        stats: BaseStats,
        priorities: StatPriority[],
        shipRole?: ShipTypeName
    ): number {
        return calculatePriorityScore(stats, priorities, shipRole);
    }

    private evaluateEquipment(
        ship: Ship,
        equipment: Partial<Record<GearSlotName, string>>,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): number {
        return calculateTotalScore(ship, equipment, priorities, getGearPiece, getEngineeringStatsForShipType, shipRole);
    }
}