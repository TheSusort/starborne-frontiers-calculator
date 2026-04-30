export const StorageKey = {
    ACTIVE_PROFILE_ID: 'active_profile_id',
    SHIPS: 'ships',
    INVENTORY: 'inventory_items',
    ENCOUNTERS: 'encounter_notes',
    ENGINEERING_STATS: 'engineering_stats',
    LOADOUTS: 'loadouts',
    TEAM_LOADOUTS: 'team_loadouts',
    CHANGELOG_STATE: 'changelog_state',
    GEAR_UPGRADES: 'gear_upgrades',
    AUTOGEAR_CONFIGS: 'autogear_configs',
    DEMO_DATA_LOADED: 'demo_data_loaded',
    SHOW_IMPORT_SUMMARY: 'show_import_summary',
} as const;

export type StorageKeyType = (typeof StorageKey)[keyof typeof StorageKey];
