import { ShipTypeName } from '../constants';

// Stats that can only be percentage-based
export const PERCENTAGE_ONLY_STATS = ['crit', 'critDamage', 'healModifier'] as const;

export type PercentageOnlyStats = (typeof PERCENTAGE_ONLY_STATS)[number];

// Stats that can only be flat values
export type FlatOnlyStats = 'hacking' | 'security';

// Stats that can be either
export type FlexibleStats = 'hp' | 'attack' | 'defence' | 'speed';

// Combined type for all stat names
export type StatName = PercentageOnlyStats | FlatOnlyStats | FlexibleStats;

export type StatType = 'flat' | 'percentage';

export interface PercentageStat {
  name: PercentageOnlyStats | FlexibleStats;
  value: number;
  type: 'percentage';
}

export interface FlatStat {
  name: FlatOnlyStats | FlexibleStats;
  value: number;
  type: 'flat';
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
  healModifier: number;
}

export interface EngineeringStats {
  stats: EngineeringStat[];
}

export interface EngineeringStat {
  shipType: ShipTypeName;
  stats: Stat[];
}
