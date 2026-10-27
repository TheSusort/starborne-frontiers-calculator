/** Below this HP% the bar/stat turns red; at/above it stays green. Shared by all simulator UI. */
export const LOW_HP_PCT = 30;

/** Shared display formatter: round to a whole number with locale thousands separators. */
export const fmt = (n: number): string => Math.round(n).toLocaleString();
