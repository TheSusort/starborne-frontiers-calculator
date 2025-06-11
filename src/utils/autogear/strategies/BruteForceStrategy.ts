import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { EngineeringStat, StatName } from '../../../types/stats';
import { calculateTotalScore } from '../scoring';

interface GearConfiguration {
    equipment: Partial<Record<GearSlotName, string>>;
    score: number;
}

/**
 * Brute Force Strategy DEPRECATED
 *
 * This strategy tries every possible combination to find the absolute best gear setup.
 * It is a very slow strategy that is not likely to find the optimal gear combinations.
 *
 * Shortly explained:
 * 1. Try every possible combination
 * 2. Return the best gear combination
 */
export class BruteForceStrategy extends BaseStrategy {
    name = 'Brute Force';
    description = 'Tries every possible combination to find the absolute best gear setup';

    private scoreCache: Map<string, number> = new Map();
    private readonly BATCH_SIZE = 50000;

    async findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        availableInventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[]
    ): Promise<GearSuggestion[]> {
        this.scoreCache.clear();
        const inventoryBySlot = this.groupAndFilterInventory(availableInventory, shipRole);

        // Initialize progress tracking
        this.initializeProgress(this.calculateTotalCombinations(inventoryBySlot));

        const bestConfig = await this.findBestConfiguration(
            ship,
            priorities,
            inventoryBySlot,
            {},
            this.getOptimizedSlotOrder(inventoryBySlot, setPriorities),
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities
        );

        return Object.entries(bestConfig.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestConfig.score,
            }));
    }

    private getOptimizedSlotOrder(
        inventoryBySlot: Record<GearSlotName, GearPiece[]>,
        setPriorities?: SetPriority[]
    ): GearSlotName[] {
        // Process slots with set pieces first if we have set priorities
        if (setPriorities && setPriorities.length > 0) {
            return Object.entries(inventoryBySlot)
                .sort(([, a], [, b]) => {
                    const aSetPieces = a.filter((gear) =>
                        setPriorities.some((p) => p.setName === gear.setBonus)
                    ).length;
                    const bSetPieces = b.filter((gear) =>
                        setPriorities.some((p) => p.setName === gear.setBonus)
                    ).length;
                    if (aSetPieces !== bSetPieces) {
                        return bSetPieces - aSetPieces;
                    }
                    return a.length - b.length;
                })
                .map(([slot]) => slot as GearSlotName);
        }

        // Fall back to original ordering
        return Object.entries(inventoryBySlot)
            .sort(([, a], [, b]) => a.length - b.length)
            .map(([slot]) => slot as GearSlotName);
    }

    private calculateTotalCombinations(inventoryBySlot: Record<GearSlotName, GearPiece[]>): number {
        return Object.values(inventoryBySlot).reduce((total, items) => total * items.length, 1);
    }

    private groupAndFilterInventory(
        inventory: GearPiece[],
        shipRole?: ShipTypeName
    ): Record<GearSlotName, GearPiece[]> {
        const result: Record<GearSlotName, GearPiece[]> = {} as Record<GearSlotName, GearPiece[]>;

        // Initialize slots
        Object.keys(GEAR_SLOTS).forEach((slot) => {
            result[slot as GearSlotName] = [];
        });

        // Group gear by slot and pre-filter obviously bad choices
        inventory.forEach((gear) => {
            // For role-specific optimization, skip gear that doesn't contribute to the role
            if (shipRole && !this.isGearRelevantForRole(gear, shipRole)) {
                return;
            }

            result[gear.slot].push(gear);
        });

        return result;
    }

    private isGearRelevantForRole(gear: GearPiece, role: ShipTypeName): boolean {
        const relevantStats: Record<ShipTypeName, string[]> = {
            Attacker: ['attack', 'crit', 'critDamage'],
            Defender: ['hp', 'defence'],
            Debuffer: ['hacking', 'attack', 'crit', 'critDamage'],
            Supporter: ['hp', 'healModifier', 'crit', 'critDamage'],
            SupporterBuffer: ['speed', 'hp', 'defence'],
        };
        const stats = relevantStats[role] || [];
        const gearStats = gear.subStats.map((stat) => stat.name);
        gearStats.push(gear.mainStat?.name as StatName);
        return stats.some((stat) => gearStats.includes(stat as StatName));
    }

    private getCacheKey(equipment: Partial<Record<GearSlotName, string>>): string {
        return JSON.stringify(equipment);
    }

    private findBestConfiguration(
        ship: Ship,
        priorities: StatPriority[],
        inventoryBySlot: Record<GearSlotName, GearPiece[]>,
        currentEquipment: Partial<Record<GearSlotName, string>>,
        remainingSlots: GearSlotName[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[]
    ): Promise<GearConfiguration> {
        return new Promise((resolve) => {
            let batchCount = 0;
            let bestConfig: GearConfiguration = { equipment: {}, score: -Infinity };

            const processNextBatch = () => {
                const processConfiguration = (
                    equipment: Partial<Record<GearSlotName, string>>,
                    slots: GearSlotName[]
                ): boolean => {
                    if (slots.length === 0) {
                        this.incrementProgress();
                        batchCount++;

                        const cacheKey = this.getCacheKey(equipment);
                        if (this.scoreCache.has(cacheKey)) {
                            const score = this.scoreCache.get(cacheKey)!;
                            if (score > bestConfig.score) {
                                bestConfig = { equipment: { ...equipment }, score };
                            }
                            return false;
                        }

                        const score = calculateTotalScore(
                            ship,
                            equipment,
                            priorities,
                            getGearPiece,
                            getEngineeringStatsForShipType,
                            shipRole,
                            setPriorities
                        );

                        this.scoreCache.set(cacheKey, score);
                        if (score > bestConfig.score) {
                            bestConfig = { equipment: { ...equipment }, score };
                        }
                        return false;
                    }

                    const [currentSlot, ...nextSlots] = slots;
                    const availableGear = inventoryBySlot[currentSlot];

                    for (const gear of availableGear) {
                        if (Object.values(equipment).includes(gear.id)) {
                            continue;
                        }

                        const newEquipment = {
                            ...equipment,
                            [currentSlot]: gear.id,
                        };

                        if (processConfiguration(newEquipment, nextSlots)) {
                            return true;
                        }

                        if (batchCount >= this.BATCH_SIZE) {
                            batchCount = 0;
                            return true;
                        }
                    }

                    return processConfiguration(equipment, nextSlots);
                };

                const needsYield = processConfiguration(currentEquipment, remainingSlots);

                if (needsYield && this.currentOperation < this.totalOperations) {
                    setTimeout(processNextBatch, 0);
                } else {
                    resolve(bestConfig);
                }
            };

            processNextBatch();
        });
    }
}
