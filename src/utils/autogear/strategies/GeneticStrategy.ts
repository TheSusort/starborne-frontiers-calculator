import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { EngineeringStat } from '../../../types/stats';
import { calculateTotalScore, clearScoreCache } from '../scoring';
import { BaseStrategy } from '../BaseStrategy';
import { performanceTracker } from '../performanceTimer';

interface Individual {
    equipment: Partial<Record<GearSlotName, string>>;
    fitness: number;
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

    private readonly MUTATION_RATE = 0.1; // 10% chance to mutate each gear piece

    private getPopulationSize(inventorySize: number): number {
        return Math.min(1200, Math.max(250, Math.floor(inventorySize * 2)));
    }

    private getGenerations(populationSize: number): number {
        return Math.min(50, Math.max(20, Math.floor(40000 / populationSize)));
    }

    private getEliteSize(populationSize: number): number {
        return Math.max(3, Math.min(10, Math.floor(populationSize * 0.01)));
    }

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        availableInventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[]
    ): Promise<GearSuggestion[]> {
        performanceTracker.reset();
        performanceTracker.startTimer('GeneticAlgorithm');

        // Clear cache at the start of each run
        clearScoreCache();

        // Initialize progress tracking (population size * generations)
        const totalOperations =
            this.getPopulationSize(availableInventory.length) *
            this.getGenerations(this.getPopulationSize(availableInventory.length));
        this.initializeProgress(totalOperations);

        const populationSize = this.getPopulationSize(availableInventory.length);
        const generations = this.getGenerations(populationSize);
        const eliteSize = this.getEliteSize(populationSize);

        performanceTracker.startTimer('InitializePopulation');
        let population = this.initializePopulation(availableInventory, getGearPiece, setPriorities);
        performanceTracker.endTimer('InitializePopulation');

        performanceTracker.startTimer('InitialEvaluation');
        population = this.evaluatePopulation(
            population,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses
        );
        performanceTracker.endTimer('InitialEvaluation');

        performanceTracker.startTimer('GeneticGenerations');
        let bestFitness = population[0]?.fitness || 0;
        let generationsWithoutImprovement = 0;
        const maxGenerationsWithoutImprovement = 50;

        for (let generation = 0; generation < generations; generation++) {
            const newPopulation: Individual[] = [];
            newPopulation.push(...population.slice(0, eliteSize));

            performanceTracker.startTimer('Breeding');
            while (newPopulation.length < populationSize) {
                const parent1 = this.selectParent(population);
                const parent2 = this.selectParent(population);
                const child = this.crossover(parent1, parent2);
                this.mutate(child, availableInventory, getGearPiece, setPriorities);
                newPopulation.push(child);
                this.incrementProgress();
            }
            performanceTracker.endTimer('Breeding');

            performanceTracker.startTimer('Evaluation');
            population = this.evaluatePopulation(
                newPopulation,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole,
                setPriorities,
                statBonuses
            );
            performanceTracker.endTimer('Evaluation');

            // Check for improvement
            const currentBestFitness = population[0]?.fitness || 0;
            if (currentBestFitness > bestFitness) {
                bestFitness = currentBestFitness;
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

        const bestIndividual = population[0];
        return Object.entries(bestIndividual.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestIndividual.fitness,
            }));
    }

    private initializePopulation(
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): Individual[] {
        const population: Individual[] = [];

        for (let i = 0; i < this.getPopulationSize(inventory.length); i++) {
            const equipment: Partial<Record<GearSlotName, string>> = {};

            Object.keys(GEAR_SLOTS).forEach((slotKey) => {
                const slot = slotKey as GearSlotName;
                equipment[slot] = this.getPreferredGearForSlot(
                    slot,
                    inventory,
                    equipment,
                    getGearPiece,
                    setPriorities
                );
            });

            population.push({ equipment, fitness: 0 });
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
        statBonuses?: StatBonus[]
    ): Individual[] {
        performanceTracker.startTimer('EvaluatePopulation');

        const result = population
            .map((individual) => {
                const fitness = this.calculateFitness(
                    individual.equipment,
                    ship,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType,
                    shipRole,
                    setPriorities,
                    statBonuses
                );

                return {
                    ...individual,
                    fitness,
                };
            })
            .sort((a, b) => b.fitness - a.fitness);

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
        statBonuses?: StatBonus[]
    ): number {
        performanceTracker.startTimer('CalculateFitness');
        const result = calculateTotalScore(
            ship,
            equipment,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses
        );
        performanceTracker.endTimer('CalculateFitness');
        return result;
    }

    private selectParent(population: Individual[]): Individual {
        // Tournament selection
        const tournamentSize = 3;
        const tournament = Array(tournamentSize)
            .fill(null)
            .map(() => population[Math.floor(Math.random() * population.length)]);
        return tournament.reduce((best, current) =>
            current.fitness > best.fitness ? current : best
        );
    }

    private crossover(parent1: Individual, parent2: Individual): Individual {
        const childEquipment: Partial<Record<GearSlotName, string>> = {};

        Object.keys(GEAR_SLOTS).forEach((slotKey) => {
            const slot = slotKey as GearSlotName;
            // Randomly choose from either parent
            childEquipment[slot] =
                Math.random() < 0.5 ? parent1.equipment[slot] : parent2.equipment[slot];
        });

        return { equipment: childEquipment, fitness: 0 };
    }

    private mutate(
        individual: Individual,
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): void {
        Object.keys(GEAR_SLOTS).forEach((slotKey) => {
            const slot = slotKey as GearSlotName;
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

        if (!setPriorities || setPriorities.length === 0 || Math.random() < 0.5) {
            // Sometimes pick random piece to maintain diversity
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

        // Find pieces that would contribute to desired sets
        const piecesWithSetScore = availablePieces.map((piece) => {
            let score = 0;
            if (piece.setBonus) {
                const currentCount = setCount[piece.setBonus] || 0;
                const relevantPriority = setPriorities.find((p) => p.setName === piece.setBonus);
                if (relevantPriority && currentCount < relevantPriority.count) {
                    score = 1;
                }
            }
            return { piece, score };
        });

        // Prefer pieces that contribute to desired sets
        const bestPieces = piecesWithSetScore.filter((p) => p.score > 0);
        if (bestPieces.length > 0) {
            return bestPieces[Math.floor(Math.random() * bestPieces.length)].piece.id;
        }

        // Fall back to random piece if no good set pieces found
        return availablePieces[Math.floor(Math.random() * availablePieces.length)].id;
    }
}
