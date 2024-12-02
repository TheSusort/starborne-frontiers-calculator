import { FactionName } from '../constants/factions';
import { GearSlot } from './gear';
import { ShipTypeName } from '../constants/shipTypes';

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
    faction: FactionName;
    type: ShipTypeName;
    baseStats: BaseStats;
    stats: BaseStats;
    equipment: Partial<Record<GearSlot, string>>;
}

export interface Faction {
    name: FactionName;
    iconUrl: string;
}

export interface ShipType {
    name: ShipTypeName;
    iconUrl: string;
}