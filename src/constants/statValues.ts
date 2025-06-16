type StatValueRange = {
    rare: { min: number; max: number };
    epic: { min: number; max: number };
    legendary: { min: number; max: number };
};

export const SUBSTAT_RANGES: Record<string, Record<string, StatValueRange>> = {
    hp: {
        flat: {
            rare: { min: 180, max: 370 },
            epic: { min: 220, max: 450 },
            legendary: { min: 320, max: 600 },
        },
        percentage: {
            rare: { min: 3, max: 5 },
            epic: { min: 4, max: 6 },
            legendary: { min: 6, max: 8 },
        },
    },
    attack: {
        flat: {
            rare: { min: 30, max: 80 },
            epic: { min: 60, max: 100 },
            legendary: { min: 70, max: 140 },
        },
        percentage: {
            rare: { min: 3, max: 5 },
            epic: { min: 4, max: 6 },
            legendary: { min: 6, max: 8 },
        },
    },
    defence: {
        flat: {
            rare: { min: 30, max: 80 },
            epic: { min: 60, max: 100 },
            legendary: { min: 70, max: 140 },
        },
        percentage: {
            rare: { min: 3, max: 5 },
            epic: { min: 4, max: 6 },
            legendary: { min: 6, max: 8 },
        },
    },
    hacking: {
        flat: {
            rare: { min: 3, max: 6 },
            epic: { min: 5, max: 7 },
            legendary: { min: 6, max: 8 },
        },
    },
    security: {
        flat: {
            rare: { min: 3, max: 6 },
            epic: { min: 5, max: 7 },
            legendary: { min: 6, max: 8 },
        },
    },
    speed: {
        flat: {
            rare: { min: 3, max: 4 },
            epic: { min: 3, max: 4 },
            legendary: { min: 4, max: 5 },
        },
    },
    crit: {
        percentage: {
            rare: { min: 3, max: 5 },
            epic: { min: 4, max: 6 },
            legendary: { min: 6, max: 8 },
        },
    },
    critDamage: {
        percentage: {
            rare: { min: 3, max: 5 },
            epic: { min: 4, max: 6 },
            legendary: { min: 6, max: 8 },
        },
    },
};
