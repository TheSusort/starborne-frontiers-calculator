/** @deprecated Use GeneticStrategy instead */
import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, CustomFormula } from '../../../types/autogear';
import { AutogearResult, ScoringInputs } from '../AutogearStrategy';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import type { EquipmentSlotName } from '../../../constants/gearTypes';
import { calculateTotalStats } from '../../ship/statsCalculator';
import { BaseStats, EngineeringStat } from '../../../types/stats';
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
        availableInventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        scoringInputs: ScoringInputs
    ): Promise<AutogearResult> {
        const setGroups = this.groupInventoryBySets(
            availableInventory,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            scoringInputs.customFormula
        );

        // Sort set groups by priority
        setGroups.sort((a, b) => {
            const aHasPriority = scoringInputs.setPriorities?.some((p) => p.setName === a.setName)
                ? 1
                : 0;
            const bHasPriority = scoringInputs.setPriorities?.some((p) => p.setName === b.setName)
                ? 1
                : 0;
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
        const equipment: Partial<Record<EquipmentSlotName, string>> = {};
        const usedSlots = new Set<EquipmentSlotName>();

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
                scoringInputs
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
            scoringInputs
        );

        // Ensure progress is complete
        this.completeProgress();

        const suggestions = Object.entries(equipment)
            .filter((entry): entry is [EquipmentSlotName, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: 0,
            }));

        return {
            suggestions,
            hardRequirementsMet: true,
            attempts: 1,
        };
    }

    private groupInventoryBySets(
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        customFormula?: CustomFormula
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
                    getEngineeringStatsForShipType,
                    customFormula
                );
                return { setName, pieces, score };
            })
            .filter((group) => group.pieces.length >= 2) // Only keep sets with enough pieces
            .sort((a, b) => b.score - a.score); // Sort by potential score
    }

    // Ranks sets ahead of any per-slot assignment, using `priorities` plus a Custom formula
    // (`shipRole` is always `undefined` here, so `calculatePriorityScore` runs
    // `customFormulaScore` when one is supplied). `roleBasis` is NOT threaded through: it only
    // ever applies alongside a role (`roleHostsBasis`, priorityScore.ts), and this phase never
    // has one. Role and formula scoring apply again later, in
    // `findBestSetCombination`/`fillRemainingSlots`'s real per-slot assignment.
    private evaluateSetPotential(
        pieces: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        customFormula?: CustomFormula
    ): number {
        // shipRole/setPriorities/statBonuses/roleBasis are deliberately absent — see this
        // method's doc for why this phase only ever scores against `priorities` + a formula.
        const scoringInputs: ScoringInputs = {
            shipRole: undefined,
            setPriorities: undefined,
            statBonuses: undefined,
            tryToCompleteSets: undefined,
            arenaModifiers: undefined,
            fleetBuffs: undefined,
            customFormula,
            roleBasis: undefined,
        };

        // Find best possible combination of pieces from this set
        const slots = new Set(pieces.map((p) => p.slot));
        const testEquipment: Partial<Record<EquipmentSlotName, string>> = {};

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
                            getEngineeringStatsForShipType(ship.type),
                            ship.id
                        );
                        const currentScore = this.calculateStatScore(
                            currentStats.final,
                            priorities,
                            scoringInputs
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
            getEngineeringStatsForShipType,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            customFormula
        );
    }

    private async findBestSetCombination(
        pieces: GearPiece[],
        usedSlots: Set<EquipmentSlotName>,
        ship: Ship,
        priorities: StatPriority[],
        currentEquipment: Partial<Record<EquipmentSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        scoringInputs: ScoringInputs
    ): Promise<GearPiece[]> {
        const availableSlots = pieces.map((p) => p.slot).filter((slot) => !usedSlots.has(slot));

        if (availableSlots.length < 2) return []; // Need at least 2 pieces for a set

        const bestCombination: GearPiece[] = [];
        let bestScore = -Infinity;

        // Get set priority if it exists
        const setPriority = scoringInputs.setPriorities?.find(
            (p) => p.setName === pieces[0].setBonus
        );
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
                    getEngineeringStatsForShipType(ship.type),
                    ship.id
                );

                const score =
                    this.calculateStatScore(totalStats.final, priorities, scoringInputs) *
                    priorityMultiplier;

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
        equipment: Partial<Record<EquipmentSlotName, string>>,
        usedSlots: Set<EquipmentSlotName>,
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        scoringInputs: ScoringInputs
    ): Promise<void> {
        for (const slot of Object.keys(GEAR_SLOTS) as GearSlotName[]) {
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
                        getEngineeringStatsForShipType(ship.type),
                        ship.id
                    );

                    const score = this.calculateStatScore(
                        totalStats.final,
                        priorities,
                        scoringInputs
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
        scoringInputs: ScoringInputs,
        setCount?: Record<string, number>
    ): number {
        return calculatePriorityScore(
            stats,
            priorities,
            scoringInputs.shipRole,
            setCount,
            scoringInputs.setPriorities,
            scoringInputs.statBonuses,
            undefined,
            undefined,
            undefined,
            scoringInputs.customFormula,
            scoringInputs.roleBasis
        );
    }
}
