import type { GearSetName } from '../../constants/gearSets';

/**
 * Type-only tripwire (#557): `GearSetName = keyof typeof GEAR_SETS | ImplantName` is a literal
 * union only while BOTH `GEAR_SETS` and `IMPLANTS` have no explicit wide annotation — an
 * annotation beats `satisfies` and collapses the union to `string`, so every
 * `Record<GearSetName, …>` would gate nothing. This file has no runtime behaviour; it exists only
 * for `tsc --noEmit` to check.
 *
 * Non-vacuity: re-adding `: Record<string, GearSetBonus>` to `GEAR_SETS` in
 * `constants/gearSets.ts`, OR `: Record<string, ImplantData>` to `IMPLANTS` in
 * `constants/implants.ts`, widens `GearSetName` back to `string` and makes the `@ts-expect-error`
 * lines below go unused, which `tsc --noEmit` reports as its own error.
 */

// A real gear-set name and a real implant name both satisfy the union.
export const realSetName: GearSetName = 'FORTITUDE';
export const realImplantName: GearSetName = 'MARTYRDOM';

// @ts-expect-error — not a real gear set or implant name
export const badSetName: GearSetName = 'NOT_A_REAL_SET';
// @ts-expect-error — a partial record must fail against the full GearSetName union
export const partialSetRecord: Record<GearSetName, number> = { FORTITUDE: 1 };
