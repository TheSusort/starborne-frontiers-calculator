import type { ShipTypeName } from '../constants/shipTypes';

// Stats that can only be percentage-based
export const PERCENTAGE_ONLY_STATS = [
    'crit',
    'critDamage',
    'healModifier',
    'shield',
    'hpRegen',
    'defensePenetration',
    'shieldPenetration',
    'damageReduction',
] as const;

export type PercentageOnlyStats = (typeof PERCENTAGE_ONLY_STATS)[number];

// Stats that can be either
export type FlexibleStats = 'hp' | 'attack' | 'defence' | 'speed' | 'hacking' | 'security';

// Combined type for all stat names
export type StatName = PercentageOnlyStats | FlexibleStats;

// Derived (computed) stats that can be used as autogear *limits* but are not
// real gear/base stats. Kept out of StatName so gear rolls, imports, and stat
// display are unaffected.
export type DerivedStatName = 'effectiveHp';

// Stat identifiers usable as autogear limit targets: every base StatName plus
// derived stats resolved on the fly (see resolveLimitStatValue).
export type LimitableStat = StatName | DerivedStatName;

export type StatType = 'flat' | 'percentage';

export interface PercentageStat {
    name: PercentageOnlyStats | FlexibleStats;
    value: number;
    type: 'percentage';
    min?: number;
    max?: number;
    id?: string;
}

export interface FlatStat {
    name: FlexibleStats;
    value: number;
    type: 'flat';
    min?: number;
    max?: number;
    id?: string;
}

// Combined Stat type
export type Stat = PercentageStat | FlatStat;

export interface BaseStats {
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    crit: number;
    critDamage: number;
    speed: number;
    healModifier?: number;
    hpRegen?: number; // Percentage of HP healed per hit
    shield?: number; // Percentage of shield generated per round
    shieldPenetration?: number; // Percentage of shield ignored per hit
    defensePenetration?: number; // Percentage of defense ignored per hit
    damageReduction?: number; // Percentage of incoming damage reduced
}

export interface EngineeringStats {
    stats: EngineeringStat[];
}

export interface EngineeringStat {
    shipType: ShipTypeName;
    stats: Stat[];
}
