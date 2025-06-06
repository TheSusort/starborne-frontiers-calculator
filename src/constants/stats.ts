import { StatName, StatType } from '../types/stats';
import { GearSlotName } from './gearTypes';

const MAX_FLAT_VALUE = 5000;
const MAX_PERCENTAGE_VALUE = 50;

export const STATS: Record<
    StatName,
    {
        label: string;
        shortLabel: string;
        allowedTypes: StatType[];
        maxValue: Record<StatType, number>;
        engineeringAllowedTypes?: StatType[];
    }
> = {
    attack: {
        label: 'Attack',
        shortLabel: 'ATK',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: ['percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE },
    },
    hp: {
        label: 'HP',
        shortLabel: 'HP',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: ['percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE },
    },
    defence: {
        label: 'Defense',
        shortLabel: 'DEF',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: ['percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE },
    },
    crit: {
        label: 'Crit Rate',
        shortLabel: 'CR',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: [],
        maxValue: { percentage: MAX_PERCENTAGE_VALUE, flat: 0 },
    },
    critDamage: {
        label: 'Crit Power',
        shortLabel: 'CP',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: ['percentage'],
        maxValue: { percentage: MAX_PERCENTAGE_VALUE, flat: 0 },
    },
    speed: {
        label: 'Speed',
        shortLabel: 'SPD',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: [],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 },
    },
    hacking: {
        label: 'Hacking',
        shortLabel: 'HACK',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: ['flat'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 },
    },
    security: {
        label: 'Security',
        shortLabel: 'SEC',
        allowedTypes: ['flat', 'percentage'],
        engineeringAllowedTypes: ['flat'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 },
    },
    healModifier: {
        label: 'Heal Modifier',
        shortLabel: 'HM',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: [],
        maxValue: { percentage: 0, flat: 0 },
    },
    shield: {
        label: 'Shield Regen',
        shortLabel: 'SH',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: [],
        maxValue: { percentage: 0, flat: 0 },
    },
    hpRegen: {
        label: 'HP Regen',
        shortLabel: 'HPR',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: [],
        maxValue: { percentage: 0, flat: 0 },
    },
    defensePenetration: {
        label: 'Defense Pen.',
        shortLabel: 'DP',
        allowedTypes: ['percentage'],
        engineeringAllowedTypes: [],
        maxValue: { percentage: 0, flat: 0 },
    },
};

export const SLOT_MAIN_STATS: Record<GearSlotName, StatName[]> = {
    weapon: ['attack'],
    hull: ['hp'],
    generator: ['defence'],
    sensor: ['hp', 'attack', 'defence', 'crit', 'critDamage'],
    software: ['hp', 'attack', 'defence', 'hacking', 'security'],
    thrusters: ['hp', 'attack', 'defence', 'speed'],
};

export const ALL_STAT_NAMES = Object.keys(STATS) as StatName[];

export const STAT_NORMALIZERS: Record<string, number> = {
    hp: 10000, // Normalize around 10k
    attack: 5000, // Normalize around 5k
    defense: 5000, // Normalize around 5k
    hacking: 100, // Normalize around 100
    security: 100, // Normalize around 100
    critChance: 25, // Normalize around 25%
    critDamage: 50, // Normalize around 50%
    speed: 100, // Normalize around 100
    // Add other stats as needed
};
