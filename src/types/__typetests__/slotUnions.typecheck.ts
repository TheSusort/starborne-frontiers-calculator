import type { GearSlotName, ImplantSlotName, EquipmentSlotName } from '../../constants/gearTypes';

/**
 * Type-only tripwire for #542: `GEAR_SLOTS` and `IMPLANT_SLOTS` each carry an explicit wide
 * `Record<string, GearSlot>` annotation alongside their `satisfies` clause — the annotation
 * wins, so `keyof typeof GEAR_SLOTS` (and its implant counterpart) silently collapses to
 * `string` and every `Record<GearSlotName, …>` in the codebase stops gating anything
 * (`reference_key_union_silently_widened`). This file has no runtime behaviour; it exists only
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
