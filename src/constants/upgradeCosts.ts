// upgrade costs scales up 40.19% per upgrade, but starting at different values for each rarity and star rank
export const UPGRADE_COSTS: { [key: number]: { [key: string]: number } } = {
    3: {
        rare: 1501,
        epic: 1556,
        legendary: 1638,
    },
    4: {
        uncommon: 1911,
        rare: 2102,
        epic: 2178,
        legendary: 2293,
    },
    5: {
        rare: 3002,
        epic: 3112,
        legendary: 3275,
    },
    6: {
        rare: 4203,
        epic: 4356,
        legendary: 4585,
    },
};
