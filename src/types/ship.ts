import { FactionName } from '../constants/factions';
import { GearSlotName } from '../constants/gearTypes';
import { ShipTypeName } from '../constants/shipTypes';
import { RarityName } from '../constants/rarities';
import { Stat, BaseStats } from './stats';

export type AffinityName = 'chemical' | 'electric' | 'thermal' | 'antimatter';

export interface Ship {
    id: string;
    name: string;
    rarity: RarityName;
    faction: FactionName;
    type: ShipTypeName;
    baseStats: BaseStats;
    equipment: Partial<Record<GearSlotName, string>>;
    equipmentLocked?: boolean;
    refits: Refit[];
    implants: Implant[];
    affinity?: AffinityName;
    imageKey?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
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
    description?: string;
}
