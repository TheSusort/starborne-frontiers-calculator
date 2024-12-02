export const RARITIES: Record<string, { value: string; label: string; bgColor: string; textColor: string; borderColor: string }> = {
    common: {
        value: 'common',
        label: 'Common',
        bgColor: 'bg-rarity-common',
        textColor: 'text-rarity-common',
        borderColor: 'border-rarity-common'
    },
    uncommon: {
        value: 'uncommon',
        label: 'Uncommon',
        bgColor: 'bg-rarity-uncommon',
        textColor: 'text-rarity-uncommon',
        borderColor: 'border-rarity-uncommon'
    },
    rare: {
        value: 'rare',
        label: 'Rare',
        bgColor: 'bg-rarity-rare',
        textColor: 'text-rarity-rare',
        borderColor: 'border-rarity-rare'
    },
    epic: {
        value: 'epic',
        label: 'Epic',
        bgColor: 'bg-rarity-epic',
        textColor: 'text-rarity-epic',
        borderColor: 'border-rarity-epic'
    },
    legendary: {
        value: 'legendary',
        label: 'Legendary',
        bgColor: 'bg-rarity-legendary',
        textColor: 'text-rarity-legendary',
        borderColor: 'border-rarity-legendary'
    }
};

export type RarityName = keyof typeof RARITIES;