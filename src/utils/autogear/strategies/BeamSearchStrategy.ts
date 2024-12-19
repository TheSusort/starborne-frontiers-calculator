import { AutogearStrategy } from '../AutogearStrategy';
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

const BEAM_WIDTH = 5;

export class BeamSearchStrategy implements AutogearStrategy {
    name = 'Beam Search';
    description = 'Balanced approach keeping multiple possible configurations in consideration';

    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName
    ): GearSuggestion[] {
        let configurations: GearConfiguration[] = [{
            equipment: {},
            score: 0
        }];

        Object.entries(GEAR_SLOTS).forEach(([slotKey, slotData]) => {
            const slotName = slotKey as GearSlotName;
            const newConfigurations: GearConfiguration[] = [];

            const availableGear = inventory.filter(gear =>
                gear.slot === slotName &&
                !Object.values(configurations[0].equipment).includes(gear.id)
            );

            configurations.forEach(config => {
                availableGear.forEach(gear => {
                    const newEquipment = {
                        ...config.equipment,
                        [slotName]: gear.id
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
                        score
                    });
                });
            });

            configurations = newConfigurations
                .sort((a, b) => b.score - a.score)
                .slice(0, BEAM_WIDTH);
        });

        const bestConfig = configurations[0];
        return Object.entries(bestConfig.equipment)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([slotName, gearId]) => ({
                slotName,
                gearId,
                score: bestConfig.score
            }));
    }

    private calculateConfigurationScore(
        stats: BaseStats,
        priorities: StatPriority[],
        equipment: Partial<Record<GearSlotName, string>>,
        getGearPiece: (id: string) => GearPiece | undefined,
        shipRole?: ShipTypeName
    ): number {
        let score = calculatePriorityScore(stats, priorities, shipRole);

        const setCount: Record<string, number> = {};
        Object.values(equipment).forEach(gearId => {
            if (!gearId) return;
            const gear = getGearPiece(gearId);
            if (!gear?.setBonus) return;
            setCount[gear.setBonus] = (setCount[gear.setBonus] || 0) + 1;
        });

        Object.entries(setCount).forEach(([setName, count]) => {
            if (count >= 2) {
                score *= 1.15;
            } else if (count === 1) {
                score *= 1.05;
            }
        });

        return score;
    }
}