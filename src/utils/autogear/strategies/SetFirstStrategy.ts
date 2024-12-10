import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';

interface SetGroup {
    setName: string;
    pieces: GearPiece[];
    score: number;
}

export class SetFirstStrategy implements AutogearStrategy {
    name = 'Set-First Algorithm';
    description = 'Prioritizes completing gear sets before individual stat optimization';

    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): GearSuggestion[] {
        // Group inventory by sets
        const setGroups = this.groupInventoryBySets(inventory, ship, priorities, getGearPiece, getEngineeringStatsForShipType);
        
        // Start with empty equipment
        const equipment: Partial<Record<GearSlotName, string>> = {};
        const usedSlots = new Set<GearSlotName>();

        // First, try to fit complete sets
        setGroups.forEach(group => {
            const setPieces = this.findBestSetCombination(
                group.pieces,
                usedSlots,
                ship,
                priorities,
                equipment,
                getGearPiece,
                getEngineeringStatsForShipType
            );

            setPieces.forEach(piece => {
                equipment[piece.slot] = piece.id;
                usedSlots.add(piece.slot);
            });
        });

        // Fill remaining slots with best individual pieces
        this.fillRemainingSlots(
            equipment,
            usedSlots,
            inventory,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType
        );

        // Convert to suggestions
        return Object.entries(equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0 // Score will be calculated later
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
        inventory.forEach(gear => {
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
            .filter(group => group.pieces.length >= 2) // Only keep sets with enough pieces
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
        const slots = new Set(pieces.map(p => p.slot));
        const testEquipment: Partial<Record<GearSlotName, string>> = {};
        
        slots.forEach(slot => {
            const bestPiece = pieces
                .filter(p => p.slot === slot)
                .reduce((best, current) => {
                    const currentStats = calculateTotalStats(
                        ship.baseStats,
                        { ...testEquipment, [slot]: current.id },
                        getGearPiece,
                        ship.refits,
                        ship.implants,
                        getEngineeringStatsForShipType(ship.type)
                    );
                    const currentScore = this.calculatePriorityScore(currentStats, priorities);

                    if (!best || currentScore > best.score) {
                        return { piece: current, score: currentScore };
                    }
                    return best;
                }, null as { piece: GearPiece; score: number } | null);

            if (bestPiece) {
                testEquipment[slot] = bestPiece.piece.id;
            }
        });

        const totalStats = calculateTotalStats(
            ship.baseStats,
            testEquipment,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        );

        return this.calculatePriorityScore(totalStats, priorities) * 1.15; // Include set bonus in potential
    }

    private findBestSetCombination(
        pieces: GearPiece[],
        usedSlots: Set<GearSlotName>,
        ship: Ship,
        priorities: StatPriority[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): GearPiece[] {
        const availableSlots = pieces
            .map(p => p.slot)
            .filter(slot => !usedSlots.has(slot));

        if (availableSlots.length < 2) return []; // Need at least 2 pieces for a set

        const bestCombination: GearPiece[] = [];
        let bestScore = -Infinity;

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
                    [piece2.slot]: piece2.id
                };

                const totalStats = calculateTotalStats(
                    ship.baseStats,
                    testEquipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type)
                );

                const score = this.calculatePriorityScore(totalStats, priorities) * 1.15;

                if (score > bestScore) {
                    bestScore = score;
                    bestCombination.length = 0;
                    bestCombination.push(piece1, piece2);
                }
            }
        }

        return bestCombination;
    }

    private fillRemainingSlots(
        equipment: Partial<Record<GearSlotName, string>>,
        usedSlots: Set<GearSlotName>,
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): void {
        Object.keys(GEAR_SLOTS).forEach(slotKey => {
            const slot = slotKey as GearSlotName;
            if (usedSlots.has(slot)) return;

            let bestScore = -Infinity;
            let bestGearId: string | undefined;

            inventory
                .filter(gear => gear.slot === slot)
                .forEach(gear => {
                    const testEquipment = { ...equipment, [slot]: gear.id };
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
                equipment[slot] = bestGearId;
                usedSlots.add(slot);
            }
        });
    }

    private calculatePriorityScore(
        stats: BaseStats,
        priorities: StatPriority[]
    ): number {
        let totalScore = 0;

        priorities.forEach((priority, index) => {
            const statValue = stats[priority.stat] || 0;
            const orderMultiplier = Math.pow(2, priorities.length - index - 1);

            if (priority.maxLimit && statValue > priority.maxLimit) {
                totalScore -= (statValue - priority.maxLimit) * priority.weight * orderMultiplier * 100;
                return;
            }

            let score = statValue * priority.weight * orderMultiplier;

            if (priority.maxLimit) {
                const ratio = statValue / priority.maxLimit;
                if (ratio > 0.8) {
                    score *= (1 - (ratio - 0.8));
                }
            }

            totalScore += score;
        });

        return totalScore;
    }
} 