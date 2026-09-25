import type { GearSlot } from '../types/gear';

// Expected contribution ranges based on slot type
const PERCENTAGE_SLOT_EXPECTED = 18.33; // Sensors, Software, Thrusters
const FLAT_SLOT_EXPECTED = 15; // Weapon, Hull, Generator

export const GEAR_SLOTS = {
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
        // Matches `SLOT_MAIN_STATS` in `constants/stats.ts` (the form's own
        // source of truth) and real imported inventories: software rolls
        // `security`, never `speed` — `speed` is a thrusters-only main stat.
        availableMainStats: ['hp', 'attack', 'defence', 'hacking', 'security'],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
    thrusters: {
        label: 'Thrusters',
        availableMainStats: ['hp', 'attack', 'defence', 'speed'],
        expectedContribution: PERCENTAGE_SLOT_EXPECTED,
    },
} satisfies Record<string, GearSlot>;

export const IMPLANT_SLOTS = {
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
} satisfies Record<string, GearSlot>;

export type GearSlotName = keyof typeof GEAR_SLOTS;
export type ImplantSlotName = keyof typeof IMPLANT_SLOTS;

/** A slot id from either space — the shape a single `GearPiece.slot` (or a `GearSuggestion`)
 *  actually holds, since gear and implants share one array/type and are told apart by which
 *  of these two unions their slot id falls in (`isGearSlotName` / `isImplantSlotName`). */
export type EquipmentSlotName = GearSlotName | ImplantSlotName;

// The definition site for both unions — a cast here names the slot list itself, not
// unvalidated input, so it is not the blind-cast-at-a-trust-boundary pattern the rest of this
// file's callers must avoid.
export const GEAR_SLOT_ORDER = Object.keys({
    ...GEAR_SLOTS,
}) as GearSlotName[];

export const IMPLANT_SLOT_ORDER = Object.keys({
    ...IMPLANT_SLOTS,
}) as ImplantSlotName[];

/** Type guards for a slot id crossing a trust boundary (import data, a mixed
 *  `EquipmentSlotName` being routed back to its own space) — narrow with these rather than a
 *  `startsWith('implant_')` string check or a blind cast. */
export const isGearSlotName = (slot: string): slot is GearSlotName =>
    Object.hasOwn(GEAR_SLOTS, slot);

export const isImplantSlotName = (slot: string): slot is ImplantSlotName =>
    Object.hasOwn(IMPLANT_SLOTS, slot);

/** True for a slot id from either space. A stored `GearPiece.slot` is a raw string (see its doc);
 *  narrow with this before using it as an equipment key. */
export const isEquipmentSlotName = (slot: string): slot is EquipmentSlotName =>
    isGearSlotName(slot) || isImplantSlotName(slot);

/** The display label for a slot from either space — several UI call sites read
 *  `GEAR_SLOTS[slot]` and `IMPLANT_SLOTS[slot]` side by side on a `GearPiece.slot`, which is not
 *  a key of either alone. Falls back to the raw slot id for a value in neither (a stored piece
 *  can carry an unrecognised slot), so `undefined` never leaks into rendered text. */
export const getEquipmentSlotLabel = (slot: string): string =>
    (isGearSlotName(slot) ? GEAR_SLOTS[slot].label : undefined) ??
    (isImplantSlotName(slot) ? IMPLANT_SLOTS[slot].label : undefined) ??
    slot;
