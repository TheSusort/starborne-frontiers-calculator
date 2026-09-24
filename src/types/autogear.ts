import type { ShipTypeName } from '../constants/shipTypes';
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

/** One stat feeding what a `basis`-bearing row scores on — a derived stat's primary factor, or
 *  a plain stat's own value. Weighted in the game's own multiplier units divided by 100: a 200%
 *  attack skill is `{ stat: 'attack', weight: 2.0 }` and a clause dealing 25% of max HP is
 *  `{ stat: 'hp', weight: 0.25 }`. */
export interface BasisTerm {
    stat: LimitableStat;
    weight: number;
}

export interface CustomFormulaRow {
    stat: LimitableStat;
    kind: FormulaRowKind;
    direction: FormulaDirection;
    /** Exponent for a core row. Defaults to 1. Unused on a bonus row. */
    importance?: CoreImportance;
    /** Coefficient for a bonus row, as a percentage. Defaults to 100. Unused on a core row. */
    percentage?: number;
    /** A weighted sum that replaces what this row scores on: on a derived stat, its primary
     *  factor (`directDamage`'s is attack; `effectiveHp`'s is HP); on a plain stat, the stat's
     *  own value. Honoured only on a `kind: 'core'`, `direction: 'max'` row — a minimised term
     *  is `1/(1+n)` and so is not scale-invariant. Absent means the row scores exactly as it
     *  did before bases existed. */
    basis?: BasisTerm[];
}

export interface CustomFormula {
    rows: CustomFormulaRow[];
    /** The role this formula was seeded from. Drives the Reset button and the label. */
    seededFrom?: ShipTypeName;
}

/** A transcription of a ship's kit (`deriveBasis`, `basisDerivation.ts`), replacing the role
 *  formula's primary quantity rather than the player's own preference. `produces` names the axis
 *  the basis measures; a role scorer applies `terms` only when `roleHostsBasis(role, produces)`
 *  is true (`offFormula/roleBasisHost.ts`) — every other role ignores it entirely. */
export interface RoleBasis {
    produces: 'damage' | 'repair' | 'shield';
    terms: BasisTerm[];
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
    optimizeImplants?: boolean;
    includeCalibratedGear?: boolean;
    /** Score every calibration-eligible piece as if calibrated to this ship. */
    assumeCalibrated?: boolean;
    useArenaModifiers?: boolean;
    excludedImplantTypes?: string[];
    fleetBuffs?: FleetBuff[];
    customFormula?: CustomFormula;
    roleBasis?: RoleBasis;
}
