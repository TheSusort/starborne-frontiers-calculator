type StatValueRange = {
    min: number;
    max: number;
};

export const SUBSTAT_RANGES: Record<string, Record<string, StatValueRange>> = {
    hp: {
        flat: { min: 250, max: 540 },
        percentage: { min: 4, max: 8 },
    },
    attack: {
        flat: { min: 50, max: 130 },
        percentage: { min: 4, max: 8 },
    },
    defence: {
        flat: { min: 50, max: 130 },
        percentage: { min: 4, max: 8 },
    },
    hacking: {
        flat: { min: 5, max: 8 },
    },
    security: {
        flat: { min: 5, max: 8 },
    },
    speed: {
        flat: { min: 5, max: 8 },
    },
    crit: {
        percentage: { min: 4, max: 8 },
    },
    critDamage: {
        percentage: { min: 4, max: 8 },
    },
};
