import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { EngineeringStat } from '../../types/stats';

export interface AutogearStrategy {
    name: string;
    description: string;
    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Promise<GearSuggestion[]> | GearSuggestion[];
    setProgressCallback(
        callback: (progress: { current: number; total: number; percentage: number }) => void
    ): void;
}

export enum AutogearAlgorithm {
    TwoPass = 'twoPass',
    SetFirst = 'setFirst',
    BeamSearch = 'beamSearch',
    Genetic = 'genetic',
    // BruteForce = 'bruteForce',
}
