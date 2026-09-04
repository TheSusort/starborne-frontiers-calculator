import type { Faction } from '../types/ship';

// The object literal is bound WITHOUT a `Record<string, Faction>` annotation so `keyof typeof`
// yields a real literal union. `FACTIONS` below re-exports it under the loose type that the 15
// existing `FACTIONS[someString]` call sites (SquadLeaderPicker, ArenaModifiersTab, ShipInventory,
// ShipSelector, ShipIndexPage, …) rely on, so none of them move.
//
// Do NOT annotate FACTION_DEFS — an explicit `Record<string, Faction>` is exactly what made
// `FactionName` widen to `string` (same defect class as STAT_NORMALIZERS, #295). `satisfies`
// gives the shape check without collapsing the keys.
const FACTION_DEFS = {
    ATLAS_SYNDICATE: {
        name: 'Atlas Syndicate',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426145023492116.webp',
    },
    BINDERBURG: {
        name: 'Binderburg',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426146579583056.webp',
    },
    EVERLIVING: {
        name: 'Everliving',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426149050032168.webp',
    },
    FRONTIER_LEGION: {
        name: 'Frontier Legion',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426150522228737.webp',
    },
    GELECEK: {
        name: 'Gelecek',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426152371925132.webp',
    },
    MPL: {
        name: 'MPL',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426156201316462.webp',
    },
    MARAUDERS: {
        name: 'Marauders',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426154888495114.webp',
    },
    TERRAN_COMBINE: {
        name: 'Terran Combine',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426138149044374.webp',
    },
    TIANCHAO: {
        name: 'Tianchen',
        // The game renamed this faction Tianchao -> Tianchen in its frontend only; its data keeps
        // the old spelling, so the skill corpus still writes "Tianchao allies".
        aliases: ['Tianchao'],
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426140946636820.webp',
    },
    XAOC: {
        name: 'XAOC',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426142423031818.webp',
    },
} satisfies Record<string, Faction>;

export const FACTIONS: Record<string, Faction> = FACTION_DEFS;

/** A real literal union of the faction keys. Prefer this over `FactionName` (which is `string`)
 *  anywhere a typo must be a compile error — e.g. `Ability.factionFilter`. */
export type FactionKey = keyof typeof FACTION_DEFS;

/** Runtime companion to `FactionKey`, for validation at trust boundaries. */
export const FACTION_KEYS = Object.keys(FACTION_DEFS) as readonly FactionKey[];

/**
 * Every spelling a faction is known by — the display `name` first, then its `aliases`.
 *
 * Two consumers, and the first is why a bare `name` is not enough:
 *  • Skill-text parsing. Skill text is game data and can name a faction by a spelling the UI has
 *    already moved off (Tianchao/Tianchen). A parser that reads `name` alone stops recognising the
 *    old spelling the moment the UI is renamed, and a recipient phrase that no longer matches does
 *    not fail loudly — it drops the faction scope, so an ally-scoped grant reaches EVERY ally.
 *  • Ship search, via `factionMatchesSearch`.
 *
 * Display — labels, sort keys, icon alt text — reads `name` directly and must NOT come through
 * here; a faction shows one name in the UI.
 */
export function factionSpellings(key: FactionKey): readonly string[] {
    const def: Faction = FACTION_DEFS[key];
    return def.aliases ? [def.name, ...def.aliases] : [def.name];
}

/**
 * Whether a search query hits any spelling of a faction — so a player who still knows a faction by
 * its old name finds its ships. `faction` is the loose `Ship.faction` string; an unrecognised one
 * matches nothing.
 */
export function factionMatchesSearch(faction: string | undefined, query: string): boolean {
    const key = asFactionKey(faction);
    if (key === undefined) return false;
    const q = query.toLowerCase();
    return factionSpellings(key).some((spelling) => spelling.toLowerCase().includes(q));
}

/**
 * Narrows a loose faction string (`Ship.faction`, which is `FactionName` = `string`) to a real
 * `FactionKey`, or `undefined` when it names no known faction.
 *
 * #363: the boundary where imported/stored ship data becomes engine input. An unrecognised value
 * must NOT be cast through — a `factionFilter` treats an unknown faction as "never matches", so a
 * blind cast would silently produce a scope that reaches nobody instead of an honest "unknown".
 */
export function asFactionKey(faction: string | undefined): FactionKey | undefined {
    return faction !== undefined && (FACTION_KEYS as readonly string[]).includes(faction)
        ? (faction as FactionKey)
        : undefined;
}

// Unchanged, and deliberately not migrated by this task: `FactionName` is `string` because
// FACTIONS is annotated. Its existing consumers keep working exactly as before.
export type FactionName = keyof typeof FACTIONS;
