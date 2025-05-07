export const STORAGE_KEYS = {
    SHIPS: 'ships',
    GEAR_INVENTORY: 'inventory_items',
    ENCOUNTER_NOTES: 'encounter_notes',
    ENGINEERING_STATS: 'engineering_stats',
    SHIP_LOADOUTS: 'loadouts',
    TEAM_LOADOUTS: 'team_loadouts',
    CHANGELOG_STATE: 'changelog_state',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
