import type { GearSlotName, ImplantSlotName, EquipmentSlotName } from '../../constants/gearTypes';

/**
 * Type-only tripwire (#542): `GearSlotName` / `ImplantSlotName` are literal unions only while
 * `GEAR_SLOTS` / `IMPLANT_SLOTS` have no explicit wide annotation — an annotation beats
 * `satisfies` and collapses the union to `string`, so every `Record<GearSlotName, …>` would
 * gate nothing. This file has no runtime behaviour; it exists only
 * for `tsc --noEmit` to check.
 *
 * Non-vacuity: re-adding `: Record<string, GearSlot>` to either `GEAR_SLOTS` or `IMPLANT_SLOTS`
 * in `constants/gearTypes.ts` widens that union back to `string` and makes the matching
 * `@ts-expect-error` below go unused, which `tsc --noEmit` reports as its own error.
 */

// @ts-expect-error — not a real gear slot
export const badGearSlot: GearSlotName = 'NOT_A_REAL_SLOT';
// @ts-expect-error — a partial record must fail against the full gear-slot union
export const partialGearRecord: Record<GearSlotName, number> = { weapon: 1 };

// @ts-expect-error — not a real implant slot
export const badImplantSlot: ImplantSlotName = 'NOT_A_REAL_IMPLANT_SLOT';
// @ts-expect-error — a partial record must fail against the full implant-slot union
export const partialImplantRecord: Record<ImplantSlotName, number> = { implant_major: 1 };

// @ts-expect-error — not a real slot in either space
export const badEquipmentSlot: EquipmentSlotName = 'NOT_A_REAL_SLOT';
// @ts-expect-error — a partial record must fail against the full combined union
export const partialEquipmentRecord: Record<EquipmentSlotName, number> = { weapon: 1 };
