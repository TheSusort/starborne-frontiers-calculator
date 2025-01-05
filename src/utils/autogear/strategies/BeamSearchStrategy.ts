import { BaseStrategy } from '../BaseStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { calculateTotalStats } from '../../statsCalculator';
import { BaseStats } from '../../../types/stats';
import { EngineeringStat } from '../../../types/stats';
import { calculatePriorityScore } from '../scoring';

interface GearConfiguration {
    equipment: Partial<Record<GearSlotName, string>>;
    score: number;
}

/**
 * Beam Search Strategy
 *
 * This strategy uses a beam search to find the optimal gear combinations.
 * It is a more balanced strategy that is more likely to find the optimal gear combinations.
 *
 * Shortly explained:
 * 1. Create a beam of possible configurations
 * 2. Evaluate the score of each configuration
 * 3. Select the best configurations
 * 4. Return the best configurations
 */
export class BeamSearchStrategy extends BaseStrategy {
    name = 'Beam Search';
    description = 'Balanced approach keeping multiple possible configurations in consideration';

    private readonly BEAM_WIDTH = 10;

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

        // Calculate total operations:
        // For each slot:
        //   - We have BEAM_WIDTH configurations
        //   - Each configuration tries each available piece for that slot
        let totalOperations = 0;
        Object.keys(GEAR_SLOTS).forEach((slotKey) => {
            const slotName = slotKey as GearSlotName;
            const slotGear = availableInventory.filter((gear) => gear.slot === slotName);
            totalOperations += slotGear.length * this.BEAM_WIDTH;
        });

        this.initializeProgress(totalOperations);

        let configurations: GearConfiguration[] = [
            {
                equipment: {},
                score: 0,
            },
        ];

        for (const [slotKey] of Object.entries(GEAR_SLOTS)) {
            const slotName = slotKey as GearSlotName;
            configurations = await this.processSlot(
                slotName,
                configurations,
                availableInventory,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole
            );
        }

        // Ensure progress is complete
        this.completeProgress();

        const bestConfig = configurations[0];
        return Object.entries(bestConfig.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestConfig.score,
            }));
    }

    private async processSlot(
        slotName: GearSlotName,
        currentConfigurations: GearConfiguration[],
        inventory: GearPiece[],
        ship: Ship,
        priorities: StatPriority[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): Promise<GearConfiguration[]> {
        const newConfigurations: GearConfiguration[] = [];

        const availableGear = inventory.filter(
            (gear) =>
                gear.slot === slotName &&
                !Object.values(currentConfigurations[0].equipment).includes(gear.id)
        );

        for (const config of currentConfigurations) {
            for (const gear of availableGear) {
                const newEquipment = {
                    ...config.equipment,
                    [slotName]: gear.id,
                };

                const totalStats = calculateTotalStats(
                    ship.baseStats,
                    newEquipment,
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    getEngineeringStatsForShipType(ship.type)
                );

                const score = this.calculateConfigurationScore(
                    totalStats,
                    priorities,
                    newEquipment,
                    getGearPiece,
                    shipRole
                );

                newConfigurations.push({
                    equipment: newEquipment,
                    score,
                });

                this.incrementProgress();
            }
        }

        const result = newConfigurations
            .sort((a, b) => b.score - a.score)
            .slice(0, this.BEAM_WIDTH);

        // Allow UI to update
        await new Promise((resolve) => setTimeout(resolve, 0));

        return result;
    }

    private calculateConfigurationScore(
        stats: BaseStats,
        priorities: StatPriority[],
        equipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        shipRole?: ShipTypeName
    ): number {
        const setCount: Record<string, number> = {};
        Object.values(equipment).forEach((gearId) => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
        });

        let score = calculatePriorityScore(stats, priorities, shipRole, setCount);

        Object.entries(setCount).forEach(([_, count]) => {
            if (count >= 2) {
                score *= 1.15;
            } else if (count === 1) {
                score *= 1.05;
            }
        });

        return score;
    }
}
