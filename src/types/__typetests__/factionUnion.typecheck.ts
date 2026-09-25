import type { FactionName } from '../../constants/factions';

/**
 * Type-only tripwire (#567): `FactionName = keyof typeof FACTIONS` is a literal union only while
 * `FACTIONS` has no explicit wide annotation — an annotation beats `satisfies` and collapses the
 * union to `string`, so every `Record<FactionName, …>` would gate nothing. This file has no
 * runtime behaviour; it exists only for `tsc --noEmit` to check.
 *
 * Non-vacuity: adding `: Record<string, Faction>` to `FACTIONS` in `constants/factions.ts` widens
 * `FactionName` back to `string` and makes the `@ts-expect-error` lines below go unused, which
 * `tsc --noEmit` reports as its own error.
 */

// A real faction name satisfies the union.
export const realFactionName: FactionName = 'ATLAS_SYNDICATE';

// @ts-expect-error — not a real faction name
export const badFactionName: FactionName = 'NOT_A_FACTION';
// @ts-expect-error — a partial record must fail against the full FactionName union
export const partialFactionRecord: Record<FactionName, number> = { ATLAS_SYNDICATE: 1 };
