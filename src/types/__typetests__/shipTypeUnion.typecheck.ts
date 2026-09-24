import type { ShipTypeName } from '../../constants/shipTypes';

/**
 * Type-only tripwire (#547): `ShipTypeName = keyof typeof SHIP_TYPES` is a literal union only
 * while `SHIP_TYPES` has no explicit wide annotation — an annotation beats `satisfies` and
 * collapses the union to `string`, so every `Record<ShipTypeName, …>` would gate nothing. This file has no runtime behaviour;
 * it exists only for `tsc --noEmit` to check.
 *
 * Non-vacuity: re-adding `: Record<string, ShipType>` to `SHIP_TYPES` in `constants/shipTypes.ts`
 * widens `ShipTypeName` back to `string` and makes the `@ts-expect-error` lines below go unused,
 * which `tsc --noEmit` reports as its own error.
 */

// @ts-expect-error — not a real ship type
export const badShipTypeName: ShipTypeName = 'NOT_A_REAL_ROLE';

// @ts-expect-error — a partial record must fail against the full ShipTypeName union
export const partialShipTypeRecord: Record<ShipTypeName, number> = { ATTACKER: 1 };
