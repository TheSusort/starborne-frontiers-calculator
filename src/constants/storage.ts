export const FIREBASE_STORAGE_KEYS = {
    SHIPS: 'ships',
    GEAR_INVENTORY: 'gear-inventory',
    ENCOUNTER_NOTES: 'encounterNotes',
    ENGINEERING_STATS: 'engineeringStats',
    SHIP_LOADOUTS: 'shipLoadouts',
    TEAM_LOADOUTS: 'teamLoadouts',
    CHANGELOG_STATE: 'changelogState',
} as const;

export type StorageKey = (typeof FIREBASE_STORAGE_KEYS)[keyof typeof FIREBASE_STORAGE_KEYS];

export const SUPABASE_STORAGE_KEYS = {
    SHIPS: 'ships',
    GEAR_INVENTORY: 'inventory_items',
    ENCOUNTER_NOTES: 'encounter_notes',
    ENGINEERING_STATS: 'engineering_stats',
    SHIP_LOADOUTS: 'loadouts',
    TEAM_LOADOUTS: 'team_loadouts',
    CHANGELOG_STATE: 'changelog_state',
} as const;

export type SupabaseStorageKey = (typeof SUPABASE_STORAGE_KEYS)[keyof typeof SUPABASE_STORAGE_KEYS];
