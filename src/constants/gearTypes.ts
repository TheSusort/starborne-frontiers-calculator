import { GearSlot } from "../types/gear";

export const GEAR_SLOTS: Record<string, GearSlot> = {
    weapon: {
        label: 'Weapon',
        availableMainStats: ['attack'],
    },
    hull: {
        label: 'Hull',
        availableMainStats: ['hp'],
    },
    generator: {
        label: 'Generator',
        availableMainStats: ['defence'],
    },
    sensor: {
        label: 'Sensor',
        availableMainStats: ['hp', 'attack', 'defence', 'crit', 'critDamage', 'healModifier'],
    },
    software: {
        label: 'Software',
        availableMainStats: ['hp', 'attack', 'defence', 'hacking', 'speed'],
    },
    thrusters: {
        label: 'Thrusters',
        availableMainStats: ['hp', 'attack', 'defence', 'speed'],
    },
} satisfies Record<string, GearSlot>;

export type GearSlotName = keyof typeof GEAR_SLOTS;