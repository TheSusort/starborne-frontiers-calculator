import { StatName, StatType } from '../types/gear';
import { GearSlotName } from './gearTypes';

const MAX_FLAT_VALUE = 5000;
const MAX_PERCENTAGE_VALUE = 50;

export const STATS: Record<StatName, {
    allowedTypes: StatType[];
    maxValue: Record<StatType, number>;
}> = {
    attack: {
        allowedTypes: ['flat', 'percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE }
    },
    hp: {
        allowedTypes: ['flat', 'percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE }
    },
    defence: {
        allowedTypes: ['flat', 'percentage'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: MAX_PERCENTAGE_VALUE }
    },
    crit: {
        allowedTypes: ['percentage'],
        maxValue: { percentage: MAX_PERCENTAGE_VALUE, flat: 0 }
    },
    critDamage: {
        allowedTypes: ['percentage'],
        maxValue: { percentage: MAX_PERCENTAGE_VALUE, flat: 0 }
    },
    healModifier: {
        allowedTypes: ['percentage'],
        maxValue: { percentage: MAX_PERCENTAGE_VALUE, flat: 0 }
    },
    speed: {
        allowedTypes: ['flat'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 }
    },
    hacking: {
        allowedTypes: ['flat'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 }
    },
    security: {
        allowedTypes: ['flat'],
        maxValue: { flat: MAX_FLAT_VALUE, percentage: 0 }
    }
};

export const SLOT_MAIN_STATS: Record<GearSlotName, StatName[]> = {
    weapon: ['attack'],
    hull: ['hp'],
    generator: ['defence'],
    sensor: ['hp', 'attack', 'defence', 'crit', 'critDamage'],
    software: ['hp', 'attack', 'defence', 'hacking', 'security'],
    thrusters: ['hp', 'attack', 'defence', 'speed']
};

export const ALL_STAT_NAMES = Object.keys(STATS) as StatName[];