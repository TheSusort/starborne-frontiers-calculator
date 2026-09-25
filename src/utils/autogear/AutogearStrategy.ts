import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import type {
    StatPriority,
    GearSuggestion,
    SetPriority,
    StatBonus,
    FleetBuff,
    CustomFormula,
    RoleBasis,
} from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { EngineeringStat, LimitableStat } from '../../types/stats';

export interface HardRequirementViolation {
    stat: LimitableStat;
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

/**
 * Every player-configurable input a strategy scores gear against, as one object. Each key is
 * required (not `field?:`) with a `T | undefined` value: a caller must consciously write
 * `field: undefined` to opt out, so a field omitted at a forward site is a `tsc` error instead
 * of a silently-undefined argument (#548). Distinct from `GearScoringInputs` (`gearScoringInputs.ts`),
 * which is the two gear-lookup VIEWS a run scores through, not these scoring PARAMETERS.
 */
export interface ScoringInputs {
    shipRole: ShipTypeName | undefined;
    setPriorities: SetPriority[] | undefined;
    statBonuses: StatBonus[] | undefined;
    tryToCompleteSets: boolean | undefined;
    arenaModifiers: Record<string, number> | null | undefined;
    fleetBuffs: FleetBuff[] | undefined;
    customFormula: CustomFormula | undefined;
    roleBasis: RoleBasis | undefined;
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
        scoringInputs: ScoringInputs
    ): Promise<AutogearResult> | AutogearResult;
    setProgressCallback(callback: (progress: AutogearProgress) => void): void;
}

export enum AutogearAlgorithm {
    TwoPass = 'twoPass',
    SetFirst = 'setFirst',
    Genetic = 'genetic',
}
