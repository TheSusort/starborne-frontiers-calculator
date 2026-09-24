import type { RarityName } from '../../constants/rarities';

/**
 * Type-only tripwire (#564): `RarityName = keyof typeof RARITIES` is a literal union only while
 * `RARITIES` has no explicit wide annotation — an annotation beats `satisfies` and collapses the
 * union to `string`, so every `Record<RarityName, …>` would gate nothing. This file has no
 * runtime behaviour; it exists only for `tsc --noEmit` to check.
 *
 * Non-vacuity: re-adding
 * `: Record<string, { value: string; label: string; bgColor: string; textColor: string; borderColor: string }>`
 * to `RARITIES` in `constants/rarities.ts` widens `RarityName` back to `string` and makes the
 * `@ts-expect-error` lines below go unused, which `tsc --noEmit` reports as its own error.
 */

// A real rarity name satisfies the union.
export const realRarityName: RarityName = 'legendary';

// @ts-expect-error — not a real rarity name
export const badRarityName: RarityName = 'NOT_A_REAL_RARITY';
// @ts-expect-error — a partial record must fail against the full RarityName union
export const partialRarityRecord: Record<RarityName, number> = { legendary: 1 };
