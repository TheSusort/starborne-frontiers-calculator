import type { FactionName } from '../constants/factions';
import type { GearSlotName, ImplantSlotName } from '../constants/gearTypes';
import type { ShipTypeName } from '../constants/shipTypes';
import type { RarityName } from '../constants/rarities';
import { Stat, BaseStats } from './stats';

export type AffinityName = 'chemical' | 'electric' | 'thermal' | 'antimatter';

export interface Ship {
    id: string;
    name: string;
    rarity: RarityName;
    /** The honest type of stored data: a ship may carry a faction string the app doesn't
     *  recognise (a new game faction, a legacy spelling) and it must not be dropped or rewritten.
     *  Narrow with `asFactionName`/`getFaction` (constants/factions.ts) at read time. */
    faction: string;
    type: ShipTypeName;
    baseStats: BaseStats;
    equipment: Partial<Record<GearSlotName, string>>;
    implants: Partial<Record<ImplantSlotName, string>>;
    equipmentLocked?: boolean;
    starred?: boolean;
    refits: Refit[];
    affinity?: AffinityName;
    imageKey?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    chargeSkillCharge?: number;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
    thirdPassiveSkillText?: string;
    activeTarget?: string;
    activePattern?: string;
    chargedTarget?: string;
    chargedPattern?: string;
    bio?: string;
    quote?: string;
    quoteAuthor?: string;
    level?: number;
    rank?: number;
    copies?: number;
}

export interface Faction {
    /** The frontend spelling, shown everywhere in the UI. */
    name: string;
    iconUrl: string;
    /** Other spellings this faction is known by — a previous name the game data or a player may
     *  still use. Consumed by `factionSpellings`, whose doc holds the rule. */
    aliases?: readonly string[];
}

export interface ShipType {
    /** Display label ('Attacker', 'Debuffer(Bomber)', …) — NOT a `ShipTypeName` role key. */
    name: string;
    description: string;
    iconUrl: string;
}

export interface Refit {
    id: string;
    stats: Stat[];
}

export interface ShipData {
    name: string;
    affinity?: AffinityName;
    rarity?: RarityName;
    faction?: FactionName;
    role?: ShipTypeName;
    hp?: number;
    attack?: number;
    defense?: number;
    hacking?: number;
    security?: number;
    critRate?: number;
    critDamage?: number;
    speed?: number;
    hpRegen?: number;
    shield?: number;
    shieldPenetration?: number;
    defensePenetration?: number;
    damageReduction?: number;
    imageKey?: string;
    activeSkillText?: string;
    chargeSkillText?: string;
    chargeSkillCharge?: number;
    firstPassiveSkillText?: string;
    secondPassiveSkillText?: string;
    thirdPassiveSkillText?: string;
    activeTarget?: string;
    activePattern?: string;
    chargedTarget?: string;
    chargedPattern?: string;
    bio?: string;
    quote?: string;
    quoteAuthor?: string;
}
