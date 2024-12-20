import { AutogearStrategy } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { EngineeringStat, StatName } from '../../../types/stats';
import { calculateTotalScore } from '../scoring';

interface GearConfiguration {
    equipment: Partial<Record<GearSlotName, string>>;
    score: number;
}

export class BruteForceStrategy implements AutogearStrategy {
    name = 'Brute Force';
    description = 'Tries every possible combination to find the absolute best gear setup';

    // Cache for memoization
    private scoreCache: Map<string, number> = new Map();
    private progressCallback?: (progress: { current: number; total: number; percentage: number }) => void;
    private totalCombinations: number = 0;
    private combinationsTried: number = 0;

    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): GearSuggestion[] {
        // Reset cache and progress tracking
        this.scoreCache.clear();
        this.combinationsTried = 0;

        // Group and pre-filter inventory
        const inventoryBySlot = this.groupAndFilterInventory(inventory, shipRole);

        // Calculate total combinations for progress tracking
        this.totalCombinations = this.calculateTotalCombinations(inventoryBySlot);
        // Start with empty configuration
        const bestConfig = this.findBestConfiguration(
            ship,
            priorities,
            inventoryBySlot,
            {},
            this.getOptimizedSlotOrder(inventoryBySlot),
            getGearPiece,
            getEngineeringStatsForShipType,
            shipRole
        );

        return Object.entries(bestConfig.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestConfig.score
            }));
    }

    private getOptimizedSlotOrder(inventoryBySlot: Record<GearSlotName, GearPiece[]>): GearSlotName[] {
        // Process slots with fewer options first to reduce branching
        return Object.entries(inventoryBySlot)
            .sort(([, a], [, b]) => a.length - b.length)
            .map(([slot]) => slot as GearSlotName);
    }

    private calculateTotalCombinations(inventoryBySlot: Record<GearSlotName, GearPiece[]>): number {
        return Object.values(inventoryBySlot)
            .reduce((total, items) => total * (items.length), 1);
    }

    private groupAndFilterInventory(
        inventory: GearPiece[],
        shipRole?: ShipTypeName
    ): Record<GearSlotName, GearPiece[]> {
        const result: Record<GearSlotName, GearPiece[]> = {} as Record<GearSlotName, GearPiece[]>;

        // Initialize slots
        Object.keys(GEAR_SLOTS).forEach(slot => {
            result[slot as GearSlotName] = [];
        });

        // Group gear by slot and pre-filter obviously bad choices
        inventory.forEach(gear => {

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
            Debuffer: ['hacking', 'attack'],
            Supporter: ['hp', 'healModifier', 'crit', 'critDamage']
        };
        const stats = relevantStats[role] || [];
        const gearStats = gear.subStats.map(stat => stat.name);
        gearStats.push(gear.mainStat.name);
        return stats.some(stat => gearStats.includes(stat as StatName));
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
        shipRole?: ShipTypeName
    ): GearConfiguration {
        if (remainingSlots.length === 0) {
            this.combinationsTried++;

            // Report progress
            if (this.progressCallback && this.totalCombinations > 0) {
                this.progressCallback({
                    current: this.combinationsTried,
                    total: this.totalCombinations,
                    percentage: Math.round((this.combinationsTried / this.totalCombinations) * 100)
                });
            }

            // Use cached score if available
            const cacheKey = this.getCacheKey(currentEquipment);
            if (this.scoreCache.has(cacheKey)) {
                return {
                    equipment: { ...currentEquipment },
                    score: this.scoreCache.get(cacheKey)!
                };
            }

            const score = calculateTotalScore(
                ship,
                currentEquipment,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole
            );

            // Cache the score
            this.scoreCache.set(cacheKey, score);
            return { equipment: { ...currentEquipment }, score };
        }

        const [currentSlot, ...nextSlots] = remainingSlots;
        const availableGear = inventoryBySlot[currentSlot];
        let bestConfig: GearConfiguration = { equipment: {}, score: -Infinity };

        // Try each piece of gear in the current slot
        for (const gear of availableGear) {
            // Skip if piece is already used
            if (Object.values(currentEquipment).includes(gear.id)) {
                continue;
            }

            const newEquipment = {
                ...currentEquipment,
                [currentSlot]: gear.id
            };

            const result = this.findBestConfiguration(
                ship,
                priorities,
                inventoryBySlot,
                newEquipment,
                nextSlots,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole
            );

            if (result.score > bestConfig.score) {
                bestConfig = result;
            }
        }

        return bestConfig;
    }

    public setProgressCallback(callback: (progress: { current: number; total: number; percentage: number }) => void) {
        this.progressCallback = callback;
    }
}