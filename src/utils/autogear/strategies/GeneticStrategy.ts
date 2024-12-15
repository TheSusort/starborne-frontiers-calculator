import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';
import { STAT_NORMALIZERS } from '../constants';

interface Individual {
    equipment: Partial<Record<GearSlotName, string>>;
    fitness: number;
}

export class GeneticStrategy implements AutogearStrategy {
    name = 'Genetic Algorithm';
    description = 'Evolution-inspired approach for finding optimal gear combinations';

    private readonly POPULATION_SIZE = 50;
    private readonly GENERATIONS = 30;
    private readonly MUTATION_RATE = 0.1;
    private readonly ELITE_SIZE = 5;

    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): GearSuggestion[] {
        // Create initial population
        let population = this.initializePopulation(ship, inventory);

        // Evaluate initial population
        population = this.evaluatePopulation(
            population,
            ship,
            priorities,
            getGearPiece,
            getEngineeringStatsForShipType
        );

        // Evolution loop
        for (let generation = 0; generation < this.GENERATIONS; generation++) {
            // Select parents and create new population
            const newPopulation: Individual[] = [];

            // Elitism: Keep best individuals
            newPopulation.push(...population.slice(0, this.ELITE_SIZE));

            // Create rest of new population
            while (newPopulation.length < this.POPULATION_SIZE) {
                const parent1 = this.selectParent(population);
                const parent2 = this.selectParent(population);
                const child = this.crossover(parent1, parent2);
                this.mutate(child, inventory);
                newPopulation.push(child);
            }

            // Evaluate new population
            population = this.evaluatePopulation(
                newPopulation,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType
            );
        }

        // Return best solution
        const bestIndividual = population[0];
        return Object.entries(bestIndividual.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestIndividual.fitness
            }));
    }

    private initializePopulation(
        ship: Ship,
        inventory: GearPiece[]
    ): Individual[] {
        const population: Individual[] = [];

        // Create random individuals
        for (let i = 0; i < this.POPULATION_SIZE; i++) {
            const equipment: Partial<Record<GearSlotName, string>> = {};

            // Fill each slot with random piece
            Object.keys(GEAR_SLOTS).forEach(slotKey => {
                const slot = slotKey as GearSlotName;
                const availablePieces = inventory.filter(gear => gear.slot === slot);
                if (availablePieces.length > 0) {
                    const randomPiece = availablePieces[Math.floor(Math.random() * availablePieces.length)];
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
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
    ): Individual[] {
        return population
            .map(individual => ({
                ...individual,
                fitness: this.calculateFitness(
                    individual.equipment,
                    ship,
                    priorities,
                    getGearPiece,
                    getEngineeringStatsForShipType
                )
            }))
            .sort((a, b) => b.fitness - a.fitness);
    }

    private calculateFitness(
        equipment: Partial<Record<GearSlotName, string>>,
        ship: Ship,
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

        let fitness = this.calculatePriorityScore(totalStats, priorities);

        // Add set bonus consideration
        const setCount: Record<string, number> = {};
        Object.values(equipment).forEach(gearId => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
        });

        Object.values(setCount).forEach(count => {
            if (count >= 2) {
                fitness *= 1.15; // 15% bonus for completed sets
            }
        });

        return fitness;
    }

    private selectParent(population: Individual[]): Individual {
        // Tournament selection
        const tournamentSize = 3;
        const tournament = Array(tournamentSize).fill(null).map(() => 
            population[Math.floor(Math.random() * population.length)]
        );
        return tournament.reduce((best, current) => 
            current.fitness > best.fitness ? current : best
        );
    }

    private crossover(parent1: Individual, parent2: Individual): Individual {
        const childEquipment: Partial<Record<GearSlotName, string>> = {};
        
        Object.keys(GEAR_SLOTS).forEach(slotKey => {
            const slot = slotKey as GearSlotName;
            // Randomly choose from either parent
            childEquipment[slot] = Math.random() < 0.5 
                ? parent1.equipment[slot]
                : parent2.equipment[slot];
        });

        return { equipment: childEquipment, fitness: 0 };
    }

    private mutate(
        individual: Individual,
        inventory: GearPiece[]
    ): void {
        Object.keys(GEAR_SLOTS).forEach(slotKey => {
            const slot = slotKey as GearSlotName;
            if (Math.random() < this.MUTATION_RATE) {
                const availablePieces = inventory.filter(gear => gear.slot === slot);
                if (availablePieces.length > 0) {
                    const randomPiece = availablePieces[Math.floor(Math.random() * availablePieces.length)];
                    individual.equipment[slot] = randomPiece.id;
                }
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