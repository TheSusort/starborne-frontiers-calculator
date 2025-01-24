export const STORAGE_KEYS = {
    SHIPS: 'ships',
    GEAR_INVENTORY: 'gear-inventory',
    ENCOUNTER_NOTES: 'encounterNotes',
    ENGINEERING_STATS: 'engineeringStats',
    SHIP_LOADOUTS: 'shipLoadouts',
    TEAM_LOADOUTS: 'teamLoadouts',
    CHANGELOG_STATE: 'changelogState',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
