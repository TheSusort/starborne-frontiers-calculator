import { GearSlot } from '../types/gear';

// Expected contribution ranges based on slot type
export const PERCENTAGE_SLOT_EXPECTED = 18.33; // Sensors, Software, Thrusters
export const FLAT_SLOT_EXPECTED = 15; // Weapon, Hull, Generator

export const GEAR_SLOTS: Record<string, GearSlot> = {
    weapon: {
        label: 'Weapon',
        availableMainStats: ['attack'],
        expectedContribution: FLAT_SLOT_EXPECTED,
    },
    hull: {
        label: 'Hull',
        availableMainStats: ['hp'],
        expectedContribution: FLAT_SLOT_EXPECTED,
    },
    generator: {
        label: 'Generator',
        availableMainStats: ['defence'],
        expectedContribution: FLAT_SLOT_EXPECTED,
    },
    sensor: {
        label: 'Sensors',
        availableMainStats: ['hp', 'attack', 'defence', 'crit', 'critDamage', 'healModifier'],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    software: {
        label: 'Software',
        availableMainStats: ['hp', 'attack', 'defence', 'hacking', 'speed'],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    thrusters: {
        label: 'Thrusters',
        availableMainStats: ['hp', 'attack', 'defence', 'speed'],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
} satisfies Record<string, GearSlot>;

export type GearSlotName = keyof typeof GEAR_SLOTS;

export const GEAR_SLOT_ORDER: GearSlotName[] = Object.keys(GEAR_SLOTS) as GearSlotName[];
