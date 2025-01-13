import { Ship } from '../../types/ship';
import { EngineeringStat } from '../../types/stats';
import { EnhancedStatDistribution } from '../../types/analysis';
import { analyzeStatDistribution } from './statDistribution';
import { GearPiece } from '../../types/gear';
import { ShipTypeName } from '../../constants';

export function analyzeEnhancedStatDistribution(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): EnhancedStatDistribution {
    return {
        slotContributions: analyzeStatDistribution(
            ship.equipment,
            getGearPiece,
            ship,
            getEngineeringStatsForShipType
        ),
    };
}
