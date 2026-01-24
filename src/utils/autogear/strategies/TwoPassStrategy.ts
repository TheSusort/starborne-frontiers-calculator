import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../ship/statsCalculator';
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
        availableInventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean
    ): Promise<GearSuggestion[]> {
        // Initialize progress tracking (slots * gear + potential set combinations)
        const totalOperations =
            Object.keys(GEAR_SLOTS).length * availableInventory.length +
            availableInventory.filter((g) => g.setBonus).length;
        this.initializeProgress(totalOperations);

        // First pass: Find best gear pieces based on individual stats
        const firstPassEquipment = await this.firstPass(
            ship,
            priorities,
            availableInventory,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses,
            tryToCompleteSets
        );

        // Second pass: Look for set bonus opportunities
        const finalEquipment = await this.secondPass(
            ship,
            priorities,
            availableInventory,
            firstPassEquipment,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses,
            tryToCompleteSets
        );

        // Ensure progress is complete
        this.completeProgress();

        // Convert to suggestions
        return Object.entries(finalEquipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0, // Score will be calculated later
            }));
    }

    private async firstPass(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        _tryToCompleteSets?: boolean
    ): Promise<Partial<Record<GearSlotName, string>>> {
        const equipment: Partial<Record<GearSlotName, string>> = {};

        // Process each slot independently
        Object.entries(GEAR_SLOTS).forEach(([slotKey, _]) => {
            const slotName = slotKey as GearSlotName;
            let bestScore = -Infinity;
            let bestGearId: string | undefined;

            // Find best gear for this slot based on pure stats
            inventory
                .filter((gear) => gear.slot === slotName)
                .forEach((gear) => {
                    const testEquipment = { ...equipment, [slotName]: gear.id };
                    const totalStats = calculateTotalStats(
                        ship.baseStats,
                        testEquipment,
                        getGearPiece,
                        ship.refits,
                        ship.implants,
                        getEngineeringStatsForShipType(ship.type),
                        ship.id
                    );

                    const score = this.calculateStatScore(
                        totalStats.final,
                        priorities,
                        shipRole,
                        undefined,
                        setPriorities,
                        statBonuses
                    );
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
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        _tryToCompleteSets?: boolean
    ): Promise<Partial<Record<GearSlotName, string>>> {
        const setCount = this.countSets(currentEquipment, getGearPiece);
        const potentialSets = this.findPotentialSets(
            inventory,
            currentEquipment,
            getGearPiece,
            setPriorities
        );

        // Try to complete sets that are close to completion or required
        potentialSets.forEach(({ setName, pieces, priority }) => {
            // Prioritize sets that are required
            const shouldTrySet = priority || setCount[setName] >= 1;
            if (shouldTrySet) {
                // We have one piece of this set
                const baseScore = this.evaluateEquipment(
                    ship,
                    currentEquipment,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType,
                    shipRole,
                    setPriorities,
                    statBonuses
                );

                // Try each possible piece that could complete the set
                pieces.forEach((piece) => {
                    const testEquipment = { ...currentEquipment };
                    testEquipment[piece.slot] = piece.id;

                    const newScore = this.evaluateEquipment(
                        ship,
                        testEquipment,
                        priorities,
                        getGearPiece,
                        getEngineeringStatsForShipType,
                        shipRole,
                        setPriorities,
                        statBonuses
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
        Object.values(equipment).forEach((gearId) => {
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
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): Array<{ setName: string; pieces: GearPiece[]; priority?: SetPriority }> {
        const sets: Record<string, GearPiece[]> = {};

        // Group inventory items by set
        inventory.forEach((gear) => {
            if (!gear.setBonus) return;
            if (!sets[gear.setBonus]) {
                sets[gear.setBonus] = [];
            }
            sets[gear.setBonus].push(gear);
        });

        return Object.entries(sets)
            .map(([setName, pieces]) => {
                const priority = setPriorities?.find((p) => p.setName === setName);
                return { setName, pieces, priority };
            })
            .filter(({ setName, priority }) => {
                // Include sets that we either:
                // 1. Already have pieces of, or
                // 2. Are in our setPriorities
                const existingPieces = Object.values(currentEquipment).filter((gearId) => {
                    const gear = gearId ? getGearPiece(gearId) : undefined;
                    return gear?.setBonus === setName;
                });
                return existingPieces.length >= 1 || priority !== undefined;
            });
    }

    private calculateStatScore(
        stats: BaseStats,
        priorities: StatPriority[],
        shipRole?: ShipTypeName,
        setCount?: Record<string, number>,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[]
    ): number {
        return calculatePriorityScore(
            stats,
            priorities,
            shipRole,
            setCount,
            setPriorities,
            statBonuses
        );
    }

    private evaluateEquipment(
        ship: Ship,
        equipment: Partial<Record<GearSlotName, string>>,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[]
    ): number {
        return calculateTotalScore(
            ship,
            equipment,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses
        );
    }
}
