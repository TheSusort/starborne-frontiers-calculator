import type { ShipTypeName } from '../../constants/shipTypes';

/**
 * Type-only tripwire for #547: `SHIP_TYPES` carried an explicit wide `Record<string, ShipType>`
 * annotation alongside its `satisfies` clause — the annotation won, so `keyof typeof SHIP_TYPES`
 * silently collapsed to `string` and every `Record<ShipTypeName, …>` in the codebase stopped
 * gating anything (`reference_key_union_silently_widened`). This file has no runtime behaviour;
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
