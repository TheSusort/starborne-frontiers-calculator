import { GearPiece, GearSlot } from './gear';

export interface BaseStats {
    hp: number;
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    hacking: number;
    speed: number;
}

export interface Ship {
    id: string;
    name: string;
    baseStats: BaseStats;
    equipment: Partial<Record<GearSlot, GearPiece>>;
} 