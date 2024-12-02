import { FactionName } from '../constants/factions';
import { GearSlotName } from '../constants/gearTypes';
import { ShipTypeName } from '../constants/shipTypes';
import { RarityName } from '../constants/rarities';

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
    rarity: RarityName;
    faction: FactionName;
    type: ShipTypeName;
    baseStats: BaseStats;
    stats: BaseStats;
    equipment: Partial<Record<GearSlotName, string>>;
}

export interface Faction {
    name: FactionName;
    iconUrl: string;
}

export interface ShipType {
    name: ShipTypeName;
    iconUrl: string;
}
