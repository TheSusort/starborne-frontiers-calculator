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
    AUTOGEAR_TEAMS: 'autogear_teams',
    GEAR_WISHLIST: 'gear_wishlist',
    DEMO_DATA_LOADED: 'demo_data_loaded',
    SHOW_IMPORT_SUMMARY: 'show_import_summary',
    SUPABASE_SYNC_ENABLED: 'supabase_sync_enabled',
} as const;

export type StorageKeyType = (typeof StorageKey)[keyof typeof StorageKey];

/**
 * Inventory is cached in IndexedDB, not localStorage, under a profile-scoped
 * key so two profiles on one browser do not serve each other's gear. Signed-out
 * and demo users have no profile and fall back to the unscoped key.
 *
 * Every site that reads or writes the inventory cache resolves the key here;
 * `reuploadLocalDataToSupabase` reads the same key for the signed-in profile.
 */
export const inventoryCacheKey = (activeProfileId: string | null): string =>
    activeProfileId ? `${StorageKey.INVENTORY}:${activeProfileId}` : StorageKey.INVENTORY;
