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
        availableMainStats: ['hp', 'attack', 'defence', 'crit', 'critDamage'],
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

export const IMPLANT_SLOTS: Record<string, GearSlot> = {
    implant_minor_alpha: {
        label: 'Minor (Alpha)',
        availableMainStats: [],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    implant_minor_gamma: {
        label: 'Minor (Gamma)',
        availableMainStats: [],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    implant_minor_sigma: {
        label: 'Minor (Sigma)',
        availableMainStats: [],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    implant_major: {
        label: 'Major',
        availableMainStats: [],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    implant_ultimate: {
        label: 'Ultimate',
        availableMainStats: [],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
};

export type GearSlotName = keyof typeof GEAR_SLOTS | keyof typeof IMPLANT_SLOTS;
export type ImplantSlotName = keyof typeof IMPLANT_SLOTS;

export const GEAR_SLOT_ORDER: GearSlotName[] = Object.keys({
    ...GEAR_SLOTS,
}) as GearSlotName[];

export const IMPLANT_SLOT_ORDER: ImplantSlotName[] = Object.keys({
    ...IMPLANT_SLOTS,
}) as ImplantSlotName[];
