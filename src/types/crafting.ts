import { GearSlotName } from '../constants/gearTypes';
import { RarityName } from '../constants/rarities';
import { StatName } from './stats';

export type CraftableSet = 'omnicore' | 'swiftness' | 'recovery' | 'exploit';

export type SetMaterialType = 'synth_alloy' | 'quantum_fiber';

export type BoosterType = 'rank' | 'rarity' | 'substat';

export type SubstatBooster =
    | 'speed'
    | 'crit_power'
    | 'hacking'
    | 'crit_rate'
    | 'security'
    | 'attack'
    | 'hp'
    | 'defense';

export interface CraftingMaterials {
    // Slot items - generic per slot
    slotItems: {
        weapon: number;
        hull: number;
        generator: number;
        sensor: number;
        software: number;
        thrusters: number;
    };
    // Set cores - specific to each set and rarity
    setCores: Record<CraftableSet, Record<RarityName, number>>;
    // Set materials - synth alloy for omnicore/recovery, quantum fiber for swiftness/exploit
    setMaterials: {
        synth_alloy: Record<RarityName, number>;
        quantum_fiber: Record<RarityName, number>;
    };
    // Booster inventory - counts of each booster type
    boosters: BoosterInventory;
}

export interface CraftingBoosters {
    rank?: boolean;
    rarity?: boolean;
    substat?: SubstatBooster;
}

export interface BoosterInventory {
    rank: number;
    rarity: number;
    substat: Record<SubstatBooster, number>;
}

export interface CraftingInput {
    slot: GearSlotName;
    set: CraftableSet;
    setCoreRarity: RarityName;
    setMaterialRarity: RarityName;
    boosters: CraftingBoosters;
}

export interface StarRarityDistribution {
    '4_star_rare': number;
    '4_star_epic': number;
    '4_star_legendary': number;
    '5_star_rare': number;
    '5_star_epic': number;
    '5_star_legendary': number;
    '6_star_rare': number;
    '6_star_epic': number;
    '6_star_legendary': number;
}

export interface CraftingResult {
    starDistribution: {
        '4_star': number;
        '5_star': number;
        '6_star': number;
    };
    rarityDistribution: {
        rare: number;
        epic: number;
        legendary: number;
    };
    fullDistribution: StarRarityDistribution;
    expectedStars: number;
    expectedRarity: string;
}

export interface SlotRoleScore {
    slot: GearSlotName;
    role: string;
    scores: number[];
    top10Average: number;
    median: number;
    needsCrafting: boolean;
}

export interface CraftingSuggestion {
    slot: GearSlotName;
    role: string;
    suggestedSet: CraftableSet;
    reasoning: string;
    priority: number;
    averageScore: number;
    medianScore: number;
}

export interface AutocraftPlan {
    slot: GearSlotName;
    set: CraftableSet;
    setCoreRarity: RarityName;
    setMaterialRarity: RarityName;
    boosters: CraftingBoosters;
    count: number;
    role?: string;
    priority?: number;
}

export interface AutocraftResult {
    plans: AutocraftPlan[];
    expectedResults: {
        totalItems: number;
        bySet: Record<CraftableSet, number>;
        bySlot: Record<GearSlotName, number>;
        byRarity: Record<RarityName, number>;
        byStars: Record<'4_star' | '5_star' | '6_star', number>;
        fullDistribution: StarRarityDistribution;
        bySetFullDistribution: Record<CraftableSet, StarRarityDistribution>;
    };
    remainingMaterials: CraftingMaterials;
    warnings: string[];
}
