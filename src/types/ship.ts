import { FactionName } from '../constants/factions';
import { GearSlotName } from '../constants/gearTypes';
import { ShipTypeName } from '../constants/shipTypes';
import { RarityName } from '../constants/rarities';
import { Stat, BaseStats } from './stats';

export interface Ship {
  id: string;
  name: string;
  rarity: RarityName;
  faction: FactionName;
  type: ShipTypeName;
  baseStats: BaseStats;
  equipment: Partial<Record<GearSlotName, string>>;
  refits: Refit[];
  implants: Implant[];
}

export interface Faction {
  name: FactionName;
  iconUrl: string;
}

export interface ShipType {
  name: ShipTypeName;
  description: string;
  iconUrl: string;
}

export interface Refit {
  stats: Stat[];
}

export interface Implant {
  stats: Stat[];
}
