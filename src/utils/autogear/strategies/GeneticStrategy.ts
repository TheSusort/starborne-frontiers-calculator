import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority } from '../../../types/autogear';
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
        ignoreEquipped?: boolean,
        setPriorities?: SetPriority[]
    ): Promise<GearSuggestion[]> {
        // Filter inventory based on ignoreEquipped setting
        const availableInventory = this.filterInventory(inventory, ship.id, ignoreEquipped);

        // Initialize progress tracking (population size * generations)
        const totalOperations = this.POPULATION_SIZE * this.GENERATIONS;
        this.initializeProgress(totalOperations);

        let population = this.initializePopulation(availableInventory, getGearPiece, setPriorities);
        population = this.evaluatePopulation(
            population,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities
        );

        for (let generation = 0; generation < this.GENERATIONS; generation++) {
            const newPopulation: Individual[] = [];
            newPopulation.push(...population.slice(0, this.ELITE_SIZE));

            while (newPopulation.length < this.POPULATION_SIZE) {
                const parent1 = this.selectParent(population);
                const parent2 = this.selectParent(population);
                const child = this.crossover(parent1, parent2);
                this.mutate(child, availableInventory, getGearPiece, setPriorities);
                newPopulation.push(child);
                this.incrementProgress();
            }

            population = this.evaluatePopulation(
                newPopulation,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole,
                setPriorities
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

    private initializePopulation(
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        setPriorities?: SetPriority[]
    ): Individual[] {
        const population: Individual[] = [];

        for (let i = 0; i < this.POPULATION_SIZE; i++) {
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
        setPriorities?: SetPriority[]
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
                    shipRole,
                    setPriorities
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
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[]
    ): number {
        return calculateTotalScore(
            ship,
            equipment,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities
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
