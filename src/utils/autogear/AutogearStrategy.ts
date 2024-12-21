import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { StatPriority, GearSuggestion } from '../../types/autogear';
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
        shipRole?: ShipTypeName
    ): GearSuggestion[];
}

export enum AutogearAlgorithm {
    TwoPass = 'twoPass',
    SetFirst = 'setFirst',
    BeamSearch = 'beamSearch',
    Genetic = 'genetic',
    BruteForce = 'bruteForce'
}

export const AUTOGEAR_STRATEGIES: Record<AutogearAlgorithm, {
    name: string;
    description: string;
}> = {
    [AutogearAlgorithm.TwoPass]: {
        name: 'Two-Pass Algorithm',
        description: 'Fast algorithm that first optimizes stats, then looks for set opportunities'
    },
    [AutogearAlgorithm.SetFirst]: {
        name: 'Set-First Approach',
        description: 'Prioritizes completing gear sets before individual stat optimization'
    },
    [AutogearAlgorithm.BeamSearch]: {
        name: 'Beam Search',
        description: 'Balanced approach keeping multiple possible configurations in consideration'
    },
    [AutogearAlgorithm.Genetic]: {
        name: 'Genetic Algorithm',
        description: 'Evolution-inspired approach for finding optimal gear combinations'
    },
    [AutogearAlgorithm.BruteForce]: {
        name: 'Brute Force',
        description: 'Tries every possible combination to find the absolute best gear setup (may crash browser)'
    }
};