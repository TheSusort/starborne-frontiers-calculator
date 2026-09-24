export const RARITIES = {
    common: {
        value: 'common',
        label: 'Common',
        bgColor: 'bg-rarity-common',
        textColor: 'text-rarity-common',
        borderColor: 'border-rarity-common',
    },
    uncommon: {
        value: 'uncommon',
        label: 'Uncommon',
        bgColor: 'bg-rarity-uncommon',
        textColor: 'text-rarity-uncommon',
        borderColor: 'border-rarity-uncommon',
    },
    rare: {
        value: 'rare',
        label: 'Rare',
        bgColor: 'bg-rarity-rare',
        textColor: 'text-rarity-rare',
        borderColor: 'border-rarity-rare',
    },
    epic: {
        value: 'epic',
        label: 'Epic',
        bgColor: 'bg-rarity-epic',
        textColor: 'text-rarity-epic',
        borderColor: 'border-rarity-epic',
    },
    legendary: {
        value: 'legendary',
        label: 'Legendary',
        bgColor: 'bg-rarity-legendary',
        textColor: 'text-rarity-legendary',
        borderColor: 'border-rarity-legendary',
    },
} satisfies Record<
    string,
    { value: string; label: string; bgColor: string; textColor: string; borderColor: string }
>;

export type RarityName = keyof typeof RARITIES;

// Order is reversed because we want legendary first
export const RARITY_ORDER = Object.keys(RARITIES).reverse();

export const sortRarities = <T extends string>(rarities: T[]): T[] => {
    return [...rarities].sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
};

/** Type guard for a rarity string crossing a trust boundary (game import, Supabase JSONB rows,
 *  URL params, community builds, ship templates) — narrow with this rather than a blind cast. */
export const isRarityName = (name: string): name is RarityName => Object.hasOwn(RARITIES, name);

/** Looks up a rarity by a loose string (e.g. from an import payload) without widening `RARITIES`'
 *  key type back to `string` — returns `undefined` for anything outside the real union instead of
 *  indexing blind. */
export const getRarity = (name: string | null | undefined) =>
    name && isRarityName(name) ? RARITIES[name] : undefined;
