import type { ShipType } from '../types/ship';

export const SHIP_TYPES = {
    ATTACKER: {
        name: 'Attacker',
        description: 'Maximize damage output',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314151596142662.webp',
    },
    DEFENDER: {
        name: 'Defender',
        description: 'Maximize HP and defense',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314174920663053.webp',
    },
    DEFENDER_SECURITY: {
        name: 'Defender(Security)',
        description: 'Maximize security, then effective HP',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314174920663053.webp',
    },
    DEBUFFER: {
        name: 'Debuffer',
        description: 'Maximize hacking, then damage',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    DEBUFFER_DEFENSIVE: {
        name: 'Debuffer(Defensive)',
        description: 'Maximize hacking, then effective HP',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    DEBUFFER_DEFENSIVE_SECURITY: {
        name: 'Debuffer(Defensive, Security)',
        description: 'Maximize hacking, then security, then effective HP',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    DEBUFFER_BOMBER: {
        name: 'Debuffer(Bomber)',
        description: 'Maximize hacking, then attack',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    DEBUFFER_CORROSION: {
        name: 'Debuffer(Corrosion)',
        description: 'Maximize hacking, then decimation',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    SUPPORTER: {
        name: 'Supporter',
        description: 'Maximize healing output',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
    SUPPORTER_BUFFER: {
        name: 'Supporter(Buffer)',
        description: 'Max speed, then HP/defense, big bonus if boost set',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
    SUPPORTER_OFFENSIVE: {
        name: 'Supporter(Offensive)',
        description: 'Max speed, then attack, big bonus if boost set',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
    SUPPORTER_SHIELD: {
        name: 'Supporter(Shield)',
        description: 'Maximize HP',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
} satisfies Record<string, ShipType>;

export type ShipTypeName = keyof typeof SHIP_TYPES;

// The definition site for the union — a cast here names the role list itself, not
// unvalidated input, so it is not the blind-cast-at-a-trust-boundary pattern the rest of this
// file's callers must avoid.
export const SHIP_TYPE_NAMES = Object.keys(SHIP_TYPES) as ShipTypeName[];

/** Type guard for a role string crossing a trust boundary (import data, a Supabase row, a URL
 *  param) — narrow with this rather than a blind cast to `ShipTypeName`. */
export const isShipTypeName = (role: string): role is ShipTypeName =>
    Object.hasOwn(SHIP_TYPES, role);

/** Coerces a loose ship-type string crossing a trust boundary (a Supabase `ships` row) to
 *  `ShipTypeName`, uppercasing first. Falls back to `'ATTACKER'` for anything outside the
 *  union — the same fallback `getShipTypeName` (importPlayerData.ts) uses for the game-export
 *  path — because `Ship.type` has no optional/neutral state and dropping a user's own ship on
 *  load would lose it from their fleet.
 *
 *  `type` is a NOT NULL column; this fallback exists for the day a role is renamed or retired
 *  and old rows still carry the previous value. Unlike rarity's fallback (cosmetic),
 *  a wrong type changes which stats autogear scores for that ship — callers must warn loudly
 *  when this falls back, naming the ship and the raw value, rather than swapping it silently. */
export const toShipTypeName = (raw: string): ShipTypeName => {
    const upper = raw.toUpperCase();
    return isShipTypeName(upper) ? upper : 'ATTACKER';
};

/** Role CATEGORY for skill-text role filters ("an ally attacker or debuffer" — Graphite).
 *  A category matches its exact ShipTypeName AND every underscore-suffixed variant
 *  ('DEBUFFER' matches DEBUFFER, DEBUFFER_DEFENSIVE, DEBUFFER_BOMBER, …). */
export type ShipRoleCategory = 'ATTACKER' | 'DEFENDER' | 'DEBUFFER' | 'SUPPORTER';

/** True when `type` falls under ANY of the given categories (prefix match over
 *  ShipTypeName). Unknown role (undefined) never matches — a role-filtered reaction
 *  stays dormant rather than inflating numbers (spec §4 PR 2, conservative). */
export function matchesRoleCategory(
    type: ShipTypeName | undefined,
    categories: ShipRoleCategory[]
): boolean {
    if (!type) return false;
    return categories.some((c) => type === c || type.startsWith(`${c}_`));
}

// A total record over `ShipRoleCategory`, not a hand-listed array: adding, renaming or removing
// a member of that union without a matching edit here fails `tsc --noEmit` (a missing or excess
// key against `Record<ShipRoleCategory, 0>`), rather than `resolveRoleEntry`'s fallback silently
// skipping the new category.
const ROLE_CATEGORIES = Object.keys({
    ATTACKER: 0,
    DEFENDER: 0,
    DEBUFFER: 0,
    SUPPORTER: 0,
} satisfies Record<ShipRoleCategory, 0>) as ShipRoleCategory[];

/** Looks up `type` in a role-keyed table, falling back to its role CATEGORY's entry
 *  (`matchesRoleCategory`) when `type` has no entry of its own — e.g. DEFENDER_SECURITY
 *  falls back to DEFENDER. An exact-role entry always wins over the category fallback:
 *  SUPPORTER_BUFFER keeps its own entry rather than falling back to SUPPORTER's.
 *  Returns `undefined` when neither the exact role nor its category has an entry. */
export function resolveRoleEntry<T>(
    table: Partial<Record<ShipTypeName, T>>,
    type: ShipTypeName
): T | undefined {
    if (table[type] !== undefined) return table[type];
    const category = ROLE_CATEGORIES.find((c) => matchesRoleCategory(type, [c]));
    return category ? table[category] : undefined;
}
