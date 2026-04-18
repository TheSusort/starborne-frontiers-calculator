import { AutogearStrategy, AutogearResult } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, SetPriority, StatBonus } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { EngineeringStat } from '../../../types/stats';
import { calculateTotalScore, calculateHardViolation, clearScoreCache } from '../scoring';
import { calculateTotalStats } from '../../ship/statsCalculator';
import { compareIndividuals } from '../individualComparator';
import { BaseStrategy } from '../BaseStrategy';
import { performanceTracker } from '../performanceTimer';
import { applyArenaModifiers } from '../arenaModifiers';

interface Individual {
    equipment: Partial<Record<GearSlotName, string>>;
    fitness: number;
    violation: number;
}

/**
 * Genetic Strategy
 *
 * This strategy uses a genetic algorithm to find the optimal gear combinations.
 * It is a more advanced strategy that is more likely to find the optimal gear combinations.
 *
 * Shortly explained:
 * 1. Create a population of random gear combinations
 * 2. Evaluate the fitness of each gear combination
 * 3. Select the best gear combinations
 * 4. Breed the best gear combinations to create a new generation by crossover and mutation
 * 5. Repeat steps 2-4 for a number of generations
 * 6. Return the best gear combination
 */
export class GeneticStrategy extends BaseStrategy implements AutogearStrategy {
    name = 'Genetic Algorithm';
    description = 'Evolution-inspired approach for finding optimal gear combinations';

    private readonly MUTATION_RATE = 0.15; // 15% chance to mutate each gear piece

    private getPopulationSize(inventorySize: number, hasImplants: boolean): number {
        const multiplier = hasImplants ? 18 : 4.5;
        return Math.min(2400, Math.max(900, Math.floor(inventorySize * multiplier)));
    }

    private getGenerations(populationSize: number, hasImplants: boolean): number {
        const baseOperations = hasImplants ? 360000 : 105000;
        return Math.min(120, Math.max(40, Math.floor(baseOperations / populationSize)));
    }

    private getEliteSize(populationSize: number): number {
        // Maintain 3% elite size, but allow for larger elite groups with bigger populations
        // This ensures we keep the best solutions while exploring more
        return Math.max(12, Math.min(75, Math.floor(populationSize * 0.03)));
    }

    /**
     * Determine which slots to optimize based on the available inventory.
     * If inventory contains implants, include them (except ultimate).
     */
    private getSlotsToOptimize(inventory: GearPiece[]): GearSlotName[] {
        const hasImplants = inventory.some((gear) => gear.slot.startsWith('implant_'));

        const slots = [...Object.keys(GEAR_SLOTS)] as GearSlotName[];

        if (hasImplants) {
            // Add implant slots except ultimate
            slots.push(
                'implant_major' as GearSlotName,
                'implant_minor_alpha' as GearSlotName,
                'implant_minor_gamma' as GearSlotName,
                'implant_minor_sigma' as GearSlotName
            );
        }

        return slots;
    }

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        availableInventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Promise<AutogearResult> {
        performanceTracker.reset();
        performanceTracker.startTimer('GeneticAlgorithm');

        // Clear cache at the start of each run
        clearScoreCache();

        // Create a cached version of getGearPiece to avoid repeated lookups
        // This cache is scoped to this optimization run
        const gearCache = new Map<string, GearPiece | undefined>();
        const cachedGetGearPiece = (id: string): GearPiece | undefined => {
            if (!gearCache.has(id)) {
                gearCache.set(id, getGearPiece(id));
            }
            return gearCache.get(id);
        };

        const hasImplants = availableInventory.some((gear) => gear.slot.startsWith('implant_'));

        // Initialize progress tracking (population size * generations)
        const populationSize = this.getPopulationSize(availableInventory.length, hasImplants);
        const generations = this.getGenerations(populationSize, hasImplants);
        const totalOperations = populationSize * generations;
        this.initializeProgress(totalOperations);

        const eliteSize = this.getEliteSize(populationSize);

        performanceTracker.startTimer('InitializePopulation');
        let population = this.initializePopulation(
            availableInventory,
            cachedGetGearPiece,
            setPriorities,
            populationSize
        );
        performanceTracker.endTimer('InitializePopulation');

        performanceTracker.startTimer('InitialEvaluation');
        population = this.evaluatePopulation(
            population,
            ship,
            priorities,
            cachedGetGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses,
            tryToCompleteSets,
            arenaModifiers
        );
        performanceTracker.endTimer('InitialEvaluation');

        performanceTracker.startTimer('GeneticGenerations');
        let bestIndividual: Individual = population[0];
        let generationsWithoutImprovement = 0;
        // Allow more generations without improvement (reduced from 50 to 15)
        // This prevents premature convergence
        const maxGenerationsWithoutImprovement = Math.max(15, Math.floor(generations * 0.3));

        for (let generation = 0; generation < generations; generation++) {
            const newPopulation: Individual[] = [];
            newPopulation.push(...population.slice(0, eliteSize));

            performanceTracker.startTimer('Breeding');
            while (newPopulation.length < populationSize) {
                const parent1 = this.selectParent(population);
                const parent2 = this.selectParent(population);
                const child = this.crossover(parent1, parent2);
                this.mutate(child, availableInventory, cachedGetGearPiece, setPriorities);
                newPopulation.push(child);
                this.incrementProgress();
            }
            performanceTracker.endTimer('Breeding');

            performanceTracker.startTimer('Evaluation');
            population = this.evaluatePopulation(
                newPopulation,
                ship,
                priorities,
                cachedGetGearPiece,
                getEngineeringStatsForShipType,
                shipRole,
                setPriorities,
                statBonuses,
                tryToCompleteSets,
                arenaModifiers
            );
            performanceTracker.endTimer('Evaluation');

            // Check for improvement
            const currentBest = population[0];
            if (compareIndividuals(currentBest, bestIndividual) < 0) {
                bestIndividual = currentBest;
                generationsWithoutImprovement = 0;
            } else {
                generationsWithoutImprovement++;
                // Early termination if no improvement for several generations
                if (generationsWithoutImprovement >= maxGenerationsWithoutImprovement) {
                    break;
                }
            }

            // Allow UI to update
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        performanceTracker.endTimer('GeneticGenerations');

        // Ensure progress is complete
        this.completeProgress();

        performanceTracker.endTimer('GeneticAlgorithm');

        return {
            suggestions: Object.entries(bestIndividual.equipment)
                .filter((entry): entry is [string, string] => entry[1] !== undefined)
                .map(([slotName, gearId]) => ({
                    slotName,
                    gearId,
                    score: bestIndividual.fitness,
                })),
            hardRequirementsMet: bestIndividual.violation === 0,
            attempts: 1,
        };
    }

    private initializePopulation(
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities: SetPriority[] | undefined,
        populationSize: number
    ): Individual[] {
        const population: Individual[] = [];
        const slotsToOptimize = this.getSlotsToOptimize(inventory);

        for (let i = 0; i < populationSize; i++) {
            const equipment: Partial<Record<GearSlotName, string>> = {};

            slotsToOptimize.forEach((slot) => {
                equipment[slot] = this.getPreferredGearForSlot(
                    slot,
                    inventory,
                    equipment,
                    getGearPiece,
                    setPriorities
                );
            });

            population.push({ equipment, fitness: 0, violation: 0 });
        }

        return population;
    }

    private evaluatePopulation(
        population: Individual[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Individual[] {
        performanceTracker.startTimer('EvaluatePopulation');

        const result = population
            .map((individual) => {
                const { fitness, violation } = this.calculateFitness(
                    individual.equipment,
                    ship,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType,
                    shipRole,
                    setPriorities,
                    statBonuses,
                    tryToCompleteSets,
                    arenaModifiers
                );
                return { ...individual, fitness, violation };
            })
            .sort(compareIndividuals);

        performanceTracker.endTimer('EvaluatePopulation');
        return result;
    }

    private calculateFitness(
        equipment: Partial<Record<GearSlotName, string>>,
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): { fitness: number; violation: number } {
        performanceTracker.startTimer('CalculateFitness');

        // Split equipment into gear and implants for proper scoring
        const gearOnly: Partial<Record<GearSlotName, string>> = {};
        const implantsOnly: Partial<Record<GearSlotName, string>> = {};

        Object.entries(equipment).forEach(([slot, gearId]) => {
            if (slot.startsWith('implant_')) {
                implantsOnly[slot] = gearId;
            } else {
                gearOnly[slot] = gearId;
            }
        });

        // Only override implants if we're optimizing them (i.e., if there are implant slots in equipment)
        // Otherwise, keep the ship's existing implants for scoring
        const hasImplantSlots = Object.keys(implantsOnly).length > 0;
        const shipWithNewImplants: Ship = hasImplantSlots
            ? { ...ship, implants: implantsOnly }
            : ship;

        const fitness = calculateTotalScore(
            shipWithNewImplants,
            gearOnly,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses,
            tryToCompleteSets,
            arenaModifiers
        );

        // Compute violation from the same post-modifier stats calculateTotalScore uses.
        const totalStats = calculateTotalStats(
            shipWithNewImplants.baseStats,
            gearOnly,
            getGearPiece,
            shipWithNewImplants.refits,
            shipWithNewImplants.implants,
            getEngineeringStatsForShipType(shipWithNewImplants.type),
            shipWithNewImplants.id
        );
        const statsForViolation =
            arenaModifiers && Object.keys(arenaModifiers).length > 0
                ? applyArenaModifiers(totalStats.final, arenaModifiers)
                : totalStats.final;
        const violation = calculateHardViolation(statsForViolation, priorities);

        performanceTracker.endTimer('CalculateFitness');
        return { fitness, violation };
    }

    private selectParent(population: Individual[]): Individual {
        // Tournament selection
        const tournamentSize = 3;
        const tournament = Array(tournamentSize)
            .fill(null)
            .map(() => population[Math.floor(Math.random() * population.length)]);
        return tournament.reduce((best, current) =>
            compareIndividuals(current, best) < 0 ? current : best
        );
    }

    private crossover(parent1: Individual, parent2: Individual): Individual {
        const childEquipment: Partial<Record<GearSlotName, string>> = {};

        // Get all slots present in either parent
        const allSlots = new Set([
            ...Object.keys(parent1.equipment),
            ...Object.keys(parent2.equipment),
        ]);

        // Use comparator-based weighting: favor the better parent
        const parent1IsBetter = compareIndividuals(parent1, parent2) < 0;
        const parent1Weight = parent1IsBetter ? 0.7 : 0.3;

        allSlots.forEach((slot) => {
            // Weighted choice favoring the fitter parent
            const useParent1 = Math.random() < parent1Weight;
            childEquipment[slot] = useParent1 ? parent1.equipment[slot] : parent2.equipment[slot];
        });

        return { equipment: childEquipment, fitness: 0, violation: 0 };
    }

    private mutate(
        individual: Individual,
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): void {
        const slotsToOptimize = this.getSlotsToOptimize(inventory);

        slotsToOptimize.forEach((slot) => {
            if (Math.random() < this.MUTATION_RATE) {
                individual.equipment[slot] = this.getPreferredGearForSlot(
                    slot,
                    inventory,
                    individual.equipment,
                    getGearPiece,
                    setPriorities
                );
            }
        });
    }

    private getPreferredGearForSlot(
        slot: GearSlotName,
        inventory: GearPiece[],
        currentEquipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): string | undefined {
        const availablePieces = inventory.filter((gear) => gear.slot === slot);
        if (availablePieces.length === 0) return undefined;

        // OPTIMIZATION: Implants don't have set bonuses - just pick randomly for diversity
        const isImplantSlot = slot.startsWith('implant_');
        if (isImplantSlot) {
            return availablePieces[Math.floor(Math.random() * availablePieces.length)].id;
        }

        // For gear: If no set priorities or random chance for diversity (20%)
        if (!setPriorities || setPriorities.length === 0 || Math.random() < 0.2) {
            // Pick random piece to maintain diversity
            return availablePieces[Math.floor(Math.random() * availablePieces.length)].id;
        }

        // Count current sets
        const setCount: Record<string, number> = {};
        Object.values(currentEquipment).forEach((gearId) => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
        });

        // Find pieces that would contribute to desired sets with weighted scoring
        const piecesWithSetScore = availablePieces.map((piece) => {
            let score = 0;
            if (piece.setBonus) {
                const currentCount = setCount[piece.setBonus] || 0;
                const relevantPriority = setPriorities.find((p) => p.setName === piece.setBonus);
                if (relevantPriority) {
                    // Higher score if we're closer to completing the set
                    const remaining = Math.max(0, relevantPriority.count - currentCount);
                    if (remaining > 0) {
                        // Weight based on priority count and how close we are to completing
                        score =
                            relevantPriority.count * 10 + (relevantPriority.count - remaining) * 5;
                    }
                }
            }
            return { piece, score };
        });

        // Sort by score descending
        piecesWithSetScore.sort((a, b) => b.score - a.score);

        // Prefer pieces that contribute to desired sets (top 50%)
        const bestPieces = piecesWithSetScore.filter((p) => p.score > 0);
        if (bestPieces.length > 0) {
            // Select from top candidates with weighted randomness (favor higher scores)
            const topCandidates = bestPieces.slice(
                0,
                Math.max(1, Math.ceil(bestPieces.length * 0.5))
            );
            return topCandidates[Math.floor(Math.random() * topCandidates.length)].piece.id;
        }

        // Fall back to random piece if no good set pieces found
        return availablePieces[Math.floor(Math.random() * availablePieces.length)].id;
    }
}
