import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { EngineeringStat } from '../../../types/stats';
import { calculateTotalScore } from '../scoring';
import { BaseStrategy } from '../BaseStrategy';

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

    private readonly POPULATION_SIZE = 1000; // Number of solutions in each generation
    private readonly GENERATIONS = 30; // How many iterations to evolve
    private readonly MUTATION_RATE = 0.1; // 10% chance to mutate each gear piece
    private readonly ELITE_SIZE = 5; // Number of best solutions to keep unchanged

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        ignoreEquipped?: boolean
    ): Promise<GearSuggestion[]> {
        // Filter inventory based on ignoreEquipped setting
        const availableInventory = this.filterInventory(inventory, ignoreEquipped || false);

        // Initialize progress tracking (population size * generations)
        const totalOperations = this.POPULATION_SIZE * this.GENERATIONS;
        this.initializeProgress(totalOperations);

        let population = this.initializePopulation(availableInventory);
        population = this.evaluatePopulation(
            population,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole
        );

        for (let generation = 0; generation < this.GENERATIONS; generation++) {
            const newPopulation: Individual[] = [];
            newPopulation.push(...population.slice(0, this.ELITE_SIZE));

            while (newPopulation.length < this.POPULATION_SIZE) {
                const parent1 = this.selectParent(population);
                const parent2 = this.selectParent(population);
                const child = this.crossover(parent1, parent2);
                this.mutate(child, availableInventory);
                newPopulation.push(child);
                this.incrementProgress();
            }

            population = this.evaluatePopulation(
                newPopulation,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole
            );

            // Allow UI to update
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Ensure progress is complete
        this.completeProgress();

        const bestIndividual = population[0];
        return Object.entries(bestIndividual.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestIndividual.fitness,
            }));
    }

    private initializePopulation(inventory: GearPiece[]): Individual[] {
        const population: Individual[] = [];

        // Create random individuals
        for (let i = 0; i < this.POPULATION_SIZE; i++) {
            const equipment: Partial<Record<GearSlotName, string>> = {};

            // Fill each slot with random piece
            Object.keys(GEAR_SLOTS).forEach((slotKey) => {
                const slot = slotKey as GearSlotName;
                const availablePieces = inventory.filter((gear) => gear.slot === slot);
                if (availablePieces.length > 0) {
                    const randomPiece =
                        availablePieces[Math.floor(Math.random() * availablePieces.length)];
                    equipment[slot] = randomPiece.id;
                }
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
        shipRole?: ShipTypeName
    ): Individual[] {
        return population
            .map((individual) => ({
                ...individual,
                fitness: this.calculateFitness(
                    individual.equipment,
                    ship,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType,
                    shipRole
                ),
            }))
            .sort((a, b) => b.fitness - a.fitness);
    }

    private calculateFitness(
        equipment: Partial<Record<GearSlotName, string>>,
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): number {
        return calculateTotalScore(
            ship,
            equipment,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole
        );
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

    private mutate(individual: Individual, inventory: GearPiece[]): void {
        Object.keys(GEAR_SLOTS).forEach((slotKey) => {
            const slot = slotKey as GearSlotName;
            if (Math.random() < this.MUTATION_RATE) {
                const availablePieces = inventory.filter((gear) => gear.slot === slot);
                if (availablePieces.length > 0) {
                    const randomPiece =
                        availablePieces[Math.floor(Math.random() * availablePieces.length)];
                    individual.equipment[slot] = randomPiece.id;
                }
            }
        });
    }
}
