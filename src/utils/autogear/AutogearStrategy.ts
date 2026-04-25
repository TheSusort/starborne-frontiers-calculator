import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import type { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { EngineeringStat, StatName } from '../../types/stats';

export interface HardRequirementViolation {
    stat: StatName;
    kind: 'min' | 'max';
    limit: number;
    actual: number;
}

export interface AutogearResult {
    suggestions: GearSuggestion[];
    hardRequirementsMet: boolean;
    /** Only populated when hardRequirementsMet === false. */
    violations?: HardRequirementViolation[];
    /** 1..5 — how many GA passes were run. 1 for strategies without reruns. */
    attempts: number;
}

export interface AutogearProgress {
    current: number;
    total: number;
    percentage: number;
    /** Set by strategies that run multiple attempts; otherwise omitted. */
    attempt?: number;
    maxAttempts?: number;
}

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
    ): Promise<AutogearResult> | AutogearResult;
    setProgressCallback(callback: (progress: AutogearProgress) => void): void;
}

export enum AutogearAlgorithm {
    TwoPass = 'twoPass',
    SetFirst = 'setFirst',
    BeamSearch = 'beamSearch',
    Genetic = 'genetic',
}
