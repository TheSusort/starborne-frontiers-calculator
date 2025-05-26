export const StorageKey = {
    SHIPS: 'ships',
    INVENTORY: 'inventory_items',
    ENCOUNTERS: 'encounter_notes',
    ENGINEERING_STATS: 'engineering_stats',
    LOADOUTS: 'loadouts',
    TEAM_LOADOUTS: 'team_loadouts',
    CHANGELOG_STATE: 'changelog_state',
} as const;

export type StorageKeyType = (typeof StorageKey)[keyof typeof StorageKey];
