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
    implants: Partial<Record<GearSlotName, string>>;
    equipmentLocked?: boolean;
    refits: Refit[];
    affinity?: AffinityName;
    imageKey?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
    level?: number;
    rank?: number;
    copies?: number;
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
    id: string;
    stats: Stat[];
}

export interface ShipData {
    name: string;
    affinity: AffinityName;
    rarity: RarityName;
    faction: FactionName;
    role: ShipTypeName;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    critRate: number;
    critDamage: number;
    speed: number;
    hpRegen?: number;
    shield?: number;
    imageKey?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
}
