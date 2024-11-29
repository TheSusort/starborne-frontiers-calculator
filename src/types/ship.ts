import { GearPiece, GearSlot } from './gear';

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

export interface Ship {
    id: string;
    name: string;
    baseStats: BaseStats;
    stats: BaseStats;
    equipment: Partial<Record<GearSlot, GearPiece>>;
} 