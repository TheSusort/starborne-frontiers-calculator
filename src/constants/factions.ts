import type { Faction } from '../types/ship';

// No wide annotation on this object literal — an explicit `Record<string, Faction>` here would
// collapse `keyof typeof FACTIONS` to `string`, the same defect class as STAT_NORMALIZERS (#295)
// and RARITIES pre-#564. `satisfies` gives the shape check without widening the keys.
export const FACTIONS = {
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
        // The game renamed this faction Tianchao -> Tianchen in its frontend only, keeping the old
        // spelling in its data. `ship_templates` was migrated to the new spelling, but the alias is
        // NOT dead: scripts/update-ship-skills.ts re-imports skill text from the
        // frontiers.cubedweb.net API, which still says Tianchao, so any run of it puts the old
        // spelling back. Deleting this alias makes that revert silently widen Fuying's ally scope.
        aliases: ['Tianchao'],
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426140946636820.webp',
    },
    XAOC: {
        name: 'XAOC',
        iconUrl: 'https://cdn.discordapp.com/emojis/1133426142423031818.webp',
    },
} satisfies Record<string, Faction>;

/** A real literal union of the faction keys. Use this anywhere a typo must be a compile error —
 *  e.g. `Ability.factionFilter` — and narrow with `asFactionName` at a trust boundary. Loose
 *  stored faction data (`Ship.faction`) is `string`, NOT this type: an unrecognised faction
 *  (a new game faction, a legacy spelling) is kept raw rather than dropped or rewritten. */
export type FactionName = keyof typeof FACTIONS;

/** Runtime companion to `FactionName`, for validation at trust boundaries. */
export const FACTION_NAMES = Object.keys(FACTIONS) as readonly FactionName[];

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
export function factionSpellings(key: FactionName): readonly string[] {
    const def: Faction = FACTIONS[key];
    return def.aliases ? [def.name, ...def.aliases] : [def.name];
}

/**
 * Whether a search query hits any spelling of a faction — so a player who still knows a faction by
 * its old name finds its ships. `faction` is the loose `Ship.faction` string; an unrecognised one
 * matches nothing.
 */
export function factionMatchesSearch(faction: string | undefined, query: string): boolean {
    const key = asFactionName(faction);
    if (key === undefined) return false;
    const q = query.toLowerCase();
    return factionSpellings(key).some((spelling) => spelling.toLowerCase().includes(q));
}

/**
 * Narrows a loose faction string (`Ship.faction`, which is `string`) to a real `FactionName`, or
 * `undefined` when it names no known faction.
 *
 * #363: the boundary where imported/stored ship data becomes engine input. An unrecognised value
 * must NOT be cast through — a `factionFilter` treats an unknown faction as "never matches", so a
 * blind cast would silently produce a scope that reaches nobody instead of an honest "unknown".
 */
export function asFactionName(faction: string | undefined): FactionName | undefined {
    return faction !== undefined && (FACTION_NAMES as readonly string[]).includes(faction)
        ? (faction as FactionName)
        : undefined;
}

/**
 * Looks up a faction's display data from a loose string without widening `FACTIONS`' key type
 * back to `string`. Returns `undefined` for anything outside the known set — a caller shows the
 * raw faction string as the name and omits the icon rather than treating this as an error.
 */
export function getFaction(faction: string | undefined): Faction | undefined {
    const key = asFactionName(faction);
    return key ? FACTIONS[key] : undefined;
}
