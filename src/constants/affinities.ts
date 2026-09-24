import type { AffinityName } from '../types/ship';

/** Select options for the four ship/enemy affinities, in canonical calculator order. */
export const AFFINITY_OPTIONS: { value: AffinityName; label: string }[] = [
    { value: 'antimatter', label: 'Antimatter' },
    { value: 'thermal', label: 'Thermal' },
    { value: 'chemical', label: 'Chemical' },
    { value: 'electric', label: 'Electric' },
];

// A total record over `AffinityName`, not a hand-listed array: adding, renaming or removing a
// member of that union without a matching edit here fails `tsc --noEmit` (a missing or excess key
// against `Record<AffinityName, 0>`), rather than `isAffinityName` silently staying stale.
export const AFFINITY_NAMES = Object.keys({
    chemical: 0,
    electric: 0,
    thermal: 0,
    antimatter: 0,
} satisfies Record<AffinityName, 0>) as AffinityName[];

/** Type guard for an affinity string crossing a trust boundary (a Supabase row, an import
 *  payload) — narrow with this rather than a blind cast to `AffinityName`. */
export const isAffinityName = (name: string): name is AffinityName =>
    (AFFINITY_NAMES as readonly string[]).includes(name);

/** Coerces a loose affinity value crossing a trust boundary — a Supabase `affinity` column
 *  (nullable on both `ships` and `ship_templates`) or an import payload — to `AffinityName`,
 *  normalising case first (mirrors `toRarityName`; `ship_templates` rows have carried other
 *  casings). Returns `undefined` for null/absent/unrecognised. Unlike rarity or ship type,
 *  `Ship.affinity` is optional: "unknown" is already a real, honest state, so this never
 *  fabricates a value. */
export const toAffinityName = (raw: string | null | undefined): AffinityName | undefined => {
    if (raw == null) return undefined;
    const lower = raw.toLowerCase();
    return isAffinityName(lower) ? lower : undefined;
};
