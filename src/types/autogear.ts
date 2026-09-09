import type { ShipTypeName } from '../constants/shipTypes';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';
import { StatName, LimitableStat } from './stats';

export interface StatPriority {
    stat: LimitableStat;
    weight?: number;
    minLimit?: number;
    maxLimit?: number;
    hardRequirement?: boolean;
}

export interface SetPriority {
    setName: string;
    count: number;
    kind?: 'implant';
}

export interface GearSuggestion {
    slotName: string;
    gearId: string;
    score: number;
}

export interface StatBonus {
    /** A real `StatName` or a derived stat (`effectiveHp`, `directDamage`) — resolved
     *  through `resolveLimitStatValue`, so a derived stat weighs correctly here. */
    stat: LimitableStat;
    percentage: number;
    mode?: 'additive' | 'multiplier';
}

export interface FleetBuff {
    stat: StatName;
    percentage: number; // e.g. 30 for +30%
}

export type FormulaRowKind = 'core' | 'bonus';
export type FormulaDirection = 'max' | 'min';

/** Exponent applied to a core row's term. Slight / Normal / Heavy. */
export type CoreImportance = 0.5 | 1 | 2;

export interface CustomFormulaRow {
    stat: LimitableStat;
    kind: FormulaRowKind;
    direction: FormulaDirection;
    /** Exponent for a core row. Defaults to 1. Unused on a bonus row. */
    importance?: CoreImportance;
    /** Coefficient for a bonus row, as a percentage. Defaults to 100. Unused on a core row. */
    percentage?: number;
}

export interface CustomFormula {
    rows: CustomFormulaRow[];
    /** The role this formula was seeded from. Drives the Reset button and the label. */
    seededFrom?: ShipTypeName;
}

export interface SavedAutogearConfig {
    shipId: string;
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    algorithm: AutogearAlgorithm;
    optimizeImplants?: boolean;
    includeCalibratedGear?: boolean;
    /** Score every calibration-eligible piece as if calibrated to this ship. */
    assumeCalibrated?: boolean;
    useArenaModifiers?: boolean;
    excludedImplantTypes?: string[];
    fleetBuffs?: FleetBuff[];
    customFormula?: CustomFormula;
}
