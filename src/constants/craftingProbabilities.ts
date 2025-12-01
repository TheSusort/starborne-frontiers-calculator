import { CraftableSet } from '../types/crafting';
import { RarityName } from './rarities';

// Base probability tables: [4*, 5*, 6*] for stars, [rare, epic, legendary] for rarity
export interface ProbabilityTable {
    stars: [number, number, number]; // [4*, 5*, 6*]
    rarity: [number, number, number]; // [rare, epic, legendary]
}

// Probability tables based on set core rarity and set material rarity
export const CRAFTING_PROBABILITIES: Record<RarityName, Record<RarityName, ProbabilityTable>> = {
    rare: {
        rare: {
            stars: [0.65, 0.35, 0.0],
            rarity: [0.675, 0.25, 0.075],
        },
        epic: {
            stars: [0.65, 0.35, 0.0], // Same as rare/rare (not used in game, but for completeness)
            rarity: [0.675, 0.25, 0.075],
        },
        legendary: {
            stars: [0.65, 0.35, 0.0], // Same as rare/rare (not used in game, but for completeness)
            rarity: [0.675, 0.25, 0.075],
        },
    },
    epic: {
        rare: {
            stars: [0.602, 0.367, 0.032],
            rarity: [0.614, 0.249, 0.137],
        },
        epic: {
            stars: [0.5, 0.413, 0.088],
            rarity: [0.506, 0.306, 0.188],
        },
        legendary: {
            stars: [0.5, 0.413, 0.088], // Same as epic/epic (not used in game, but for completeness)
            rarity: [0.506, 0.306, 0.188],
        },
    },
    legendary: {
        rare: {
            stars: [0.5, 0.413, 0.088], // Same as epic/epic (not used in game, but for completeness)
            rarity: [0.506, 0.306, 0.188],
        },
        epic: {
            stars: [0.242, 0.534, 0.224],
            rarity: [0.243, 0.478, 0.279],
        },
        legendary: {
            stars: [0.0, 0.65, 0.35],
            rarity: [0.0, 0.65, 0.35],
        },
    },
};

// Set material requirements
export const SET_MATERIAL_REQUIREMENTS: Record<CraftableSet, 'synth_alloy' | 'quantum_fiber'> = {
    omnicore: 'synth_alloy',
    recovery: 'synth_alloy',
    swiftness: 'quantum_fiber',
    exploit: 'quantum_fiber',
};

// Material source information
export const MATERIAL_SOURCES = {
    faction_ops: 'Faction Operations',
    dispatch: 'Dispatch Missions',
};
