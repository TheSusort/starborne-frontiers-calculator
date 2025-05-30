import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../ship/statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';
import { calculatePriorityScore, calculateTotalScore } from '../scoring';

interface SetGroup {
    setName: string;
    pieces: GearPiece[];
    score: number;
}

/**
 * Set-First Strategy
 *
 * This strategy prioritizes completing gear sets before individual stat optimization.
 * It is a more balanced strategy that is more likely to find the optimal gear combinations.
 *
 * Shortly explained:
 * 1. Group inventory by sets
 * 2. Try to fit complete sets
 * 3. Fill remaining slots with best individual pieces
 * 4. Return the best gear combination
 */
export class SetFirstStrategy extends BaseStrategy {
    name = 'Set-First Approach';
    description = 'Prioritizes completing gear sets before individual stat optimization';

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        getShipFromGearId: (gearId: string) => Ship | undefined,
        shipRole?: ShipTypeName,
        ignoreEquipped?: boolean,
        setPriorities?: SetPriority[]
    ): Promise<GearSuggestion[]> {
        // Filter inventory based on ignoreEquipped setting
        const availableInventory = this.filterInventory(
            inventory,
            ship.id,
            getShipFromGearId,
            ignoreEquipped
        );

        const setGroups = this.groupInventoryBySets(
            availableInventory,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType
        );

        // Sort set groups by priority
        setGroups.sort((a, b) => {
            const aHasPriority = setPriorities?.some((p) => p.setName === a.setName) ? 1 : 0;
            const bHasPriority = setPriorities?.some((p) => p.setName === b.setName) ? 1 : 0;
            if (aHasPriority !== bHasPriority) {
                return bHasPriority - aHasPriority;
            }
            return b.score - a.score;
        });

        // Initialize progress (set evaluations + remaining slots)
        const totalOperations =
            setGroups.length * availableInventory.length + Object.keys(GEAR_SLOTS).length;
        this.initializeProgress(totalOperations);

        // Group inventory by sets
        const equipment: Partial<Record<GearSlotName, string>> = {};
        const usedSlots = new Set<GearSlotName>();

        // First, try to fit complete sets
        for (const group of setGroups) {
            const setPieces = await this.findBestSetCombination(
                group.pieces,
                usedSlots,
                ship,
                priorities,
                equipment,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole,
                setPriorities
            );

            setPieces.forEach((piece) => {
                equipment[piece.slot] = piece.id;
                usedSlots.add(piece.slot);
            });
            this.incrementProgress();
        }

        // Fill remaining slots with best individual pieces
        await this.fillRemainingSlots(
            equipment,
            usedSlots,
            availableInventory,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities
        );

        // Ensure progress is complete
        this.completeProgress();

        return Object.entries(equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0,
            }));
    }

    private groupInventoryBySets(
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): SetGroup[] {
        const setGroups: Record<string, GearPiece[]> = {};

        // Group pieces by set
        inventory.forEach((gear) => {
            if (!gear.setBonus) return;
            if (!setGroups[gear.setBonus]) {
                setGroups[gear.setBonus] = [];
            }
            setGroups[gear.setBonus].push(gear);
        });

        // Convert to array and calculate potential scores
        return Object.entries(setGroups)
            .map(([setName, pieces]): SetGroup => {
                const score = this.evaluateSetPotential(
                    pieces,
                    ship,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType
                );
                return { setName, pieces, score };
            })
            .filter((group) => group.pieces.length >= 2) // Only keep sets with enough pieces
            .sort((a, b) => b.score - a.score); // Sort by potential score
    }

    private evaluateSetPotential(
        pieces: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): number {
        // Find best possible combination of pieces from this set
        const slots = new Set(pieces.map((p) => p.slot));
        const testEquipment: Partial<Record<GearSlotName, string>> = {};

        slots.forEach((slot) => {
            const bestPiece = pieces
                .filter((p) => p.slot === slot)
                .reduce(
                    (best, current) => {
                        const currentStats = calculateTotalStats(
                            ship.baseStats,
                            { ...testEquipment, [slot]: current.id },
                            getGearPiece,
                            ship.refits,
                            ship.implants,
                            getEngineeringStatsForShipType(ship.type)
                        );
                        const currentScore = this.calculateStatScore(
                            currentStats.final,
                            priorities
                        );

                        if (!best || currentScore > best.score) {
                            return { piece: current, score: currentScore };
                        }
                        return best;
                    },
                    null as { piece: GearPiece; score: number } | null
                );

            if (bestPiece) {
                testEquipment[slot] = bestPiece.piece.id;
            }
        });

        return calculateTotalScore(
            ship,
            testEquipment,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType
        );
    }

    private async findBestSetCombination(
        pieces: GearPiece[],
        usedSlots: Set<GearSlotName>,
        ship: Ship,
        priorities: StatPriority[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[]
    ): Promise<GearPiece[]> {
        const availableSlots = pieces.map((p) => p.slot).filter((slot) => !usedSlots.has(slot));

        if (availableSlots.length < 2) return []; // Need at least 2 pieces for a set

        const bestCombination: GearPiece[] = [];
        let bestScore = -Infinity;

        // Get set priority if it exists
        const setPriority = setPriorities?.find((p) => p.setName === pieces[0].setBonus);
        const priorityMultiplier = setPriority ? 1.5 : 1.15; // Higher multiplier for required sets

        // Try different combinations of pieces
        for (let i = 0; i < pieces.length; i++) {
            for (let j = i + 1; j < pieces.length; j++) {
                const piece1 = pieces[i];
                const piece2 = pieces[j];

                if (piece1.slot === piece2.slot) continue;
                if (usedSlots.has(piece1.slot) || usedSlots.has(piece2.slot)) continue;

                const testEquipment = {
                    ...currentEquipment,
                    [piece1.slot]: piece1.id,
                    [piece2.slot]: piece2.id,
                };

                const totalStats = calculateTotalStats(
                    ship.baseStats,
                    testEquipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type)
                );

                const score =
                    this.calculateStatScore(
                        totalStats.final,
                        priorities,
                        shipRole,
                        undefined,
                        setPriorities
                    ) * priorityMultiplier;

                if (score > bestScore) {
                    bestScore = score;
                    bestCombination.length = 0;
                    bestCombination.push(piece1, piece2);
                }
            }
        }

        return bestCombination;
    }

    private async fillRemainingSlots(
        equipment: Partial<Record<GearSlotName, string>>,
        usedSlots: Set<GearSlotName>,
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[]
    ): Promise<void> {
        for (const slotKey of Object.keys(GEAR_SLOTS)) {
            const slot = slotKey as GearSlotName;
            if (usedSlots.has(slot)) {
                this.incrementProgress();
                continue;
            }

            let bestScore = -Infinity;
            let bestGearId: string | undefined;

            inventory
                .filter((gear) => gear.slot === slot)
                .forEach((gear) => {
                    const testEquipment = { ...equipment, [slot]: gear.id };
                    const totalStats = calculateTotalStats(
                        ship.baseStats,
                        testEquipment,
                        getGearPiece,
                        ship.refits,
                        ship.implants,
                        getEngineeringStatsForShipType(ship.type)
                    );

                    const score = this.calculateStatScore(
                        totalStats.final,
                        priorities,
                        shipRole,
                        undefined,
                        setPriorities
                    );
                    if (score > bestScore) {
                        bestScore = score;
                        bestGearId = gear.id;
                    }
                });

            if (bestGearId) {
                equipment[slot] = bestGearId;
                usedSlots.add(slot);
            }
            this.incrementProgress();
        }
    }

    private calculateStatScore(
        stats: BaseStats,
        priorities: StatPriority[],
        shipRole?: ShipTypeName,
        setCount?: Record<string, number>,
        setPriorities?: SetPriority[]
    ): number {
        return calculatePriorityScore(stats, priorities, shipRole, setCount, setPriorities);
    }
}
