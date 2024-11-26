import { GearSetName } from "../constants/gearSets";

// Stats that can only be percentage-based
export type PercentageOnlyStats = 'crit' | 'critDamage' | 'healModifier';

// Stats that can only be flat values
export type FlatOnlyStats = 'hacking' | 'security';

// Stats that can be either
export type FlexibleStats = 'hp' | 'attack' | 'defence' | 'speed';

// Combined type for all stat names
export type StatName = PercentageOnlyStats | FlatOnlyStats | FlexibleStats;

export type StatType = 'flat' | 'percentage';
export type GearSlot = 'weapon' | 'hull' | 'generator' | 'sensor' | 'software' | 'thrusters';
export type Rarity = 'rare' | 'epic' | 'legendary';


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

export interface GearPiece {
    id: string;
    slot: GearSlot;
    level: number;
    stars: number;
    rarity: Rarity;
    mainStat: Stat;
    subStats: Stat[];
    setBonus: GearSetName;
}

export interface GearSetBonus {
    name: GearSetName;
    stats: Stat[];
}

export interface GearLoadout {
    weapon?: GearPiece;
    hull?: GearPiece;
    generator?: GearPiece;
    sensor?: GearPiece;
    software?: GearPiece;
    thrusters?: GearPiece;
} 