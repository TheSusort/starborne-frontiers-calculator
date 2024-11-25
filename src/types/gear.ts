import { GearSetName } from "../constants/gearSets";

export type StatName = 'hp' | 'attack' | 'defence' | 'crit' | 'critDamage' | 'hacking' | 'speed' | 'security' | 'healModifier';
export type StatType = 'flat' | 'percentage';
export type GearSlot = 'weapon' | 'hull' | 'generator' | 'sensor' | 'software' | 'thrusters';
export type Rarity = 'rare' | 'epic' | 'legendary';


export interface Stat {
    name: StatName;
    value: number;
    type: StatType;
}

export interface GearPiece {
    id: string;
    slot: GearSlot;
    mainStat: Stat;
    subStats: Stat[];
    setBonus: GearSetBonus;
    stars: number;
    rarity: Rarity;
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