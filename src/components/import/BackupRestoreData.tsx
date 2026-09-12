/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Button, ConfirmModal } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { StorageKey, StorageKeyType, inventoryCacheKey } from '../../constants/storage';
import { supabase } from '../../config/supabase';
import { clearIndexedDBStorage, getFromIndexedDB, setInIndexedDB } from '../../hooks/useStorage';
import {
    reuploadLocalDataToSupabase,
    pruneSupabaseDataNotInLocal,
} from '../../services/userDataService';
import { parseBackupInventory } from '../../schemas/backupData';

const BACKUP_KEYS = Object.values(StorageKey);

/**
 * Inventory is cached in IndexedDB; every other backup key is a localStorage
 * entry. Returns the IndexedDB cache key for a backup key, or null when the key
 * belongs to localStorage.
 *
 * The backup file always names the UNSCOPED key, so a file taken on one profile
 * restores onto another; only the cache key it lands in is profile-scoped.
 *
 * `gear_upgrades` is the other IndexedDB entry and is deliberately NOT here:
 * `useGearUpgrades` derives it from the inventory by simulation, so backing it
 * up would roughly double the file for something that regenerates itself.
 */
const indexedDbCacheKey = (key: string, activeProfileId: string | null): string | null =>
    key === StorageKey.INVENTORY ? inventoryCacheKey(activeProfileId) : null;

// Legacy key mappings for backward compatibility
const LEGACY_KEY_MAP: Record<string, StorageKeyType> = {
    changelogState: StorageKey.CHANGELOG_STATE,
    encounterNotes: StorageKey.ENCOUNTERS,
    engineeringStats: StorageKey.ENGINEERING_STATS,
    'gear-inventory': StorageKey.INVENTORY,
    ships: StorageKey.SHIPS,
    shipLoadouts: StorageKey.LOADOUTS,
    teamLoadouts: StorageKey.TEAM_LOADOUTS,
};

type StorageData = {
    [K in StorageKeyType | string]?: string;
};

// Function to migrate camelCase keys to snake_case in engineering stats
const migrateEngineeringStats = (data: any): any => {
    if (!data || !data.stats) return data;

    return {
        stats: data.stats.map((stat: any) => ({
            shipType: stat.shipType,
            stats: stat.stats.map((s: any) => ({
                name: s.name,
                value: s.value,
                type: s.type,
            })),
        })),
    };
};

// Function to migrate loadouts to the correct format
const migrateLoadouts = (data: any): any => {
    if (!Array.isArray(data)) return data;

    // Ensure each loadout has the required fields
    return data.map((loadout) => ({
        id: loadout.id || uuidv4(),
        name: loadout.name || 'Unnamed Loadout',
        shipId: loadout.shipId,
        equipment: loadout.equipment || {},
        createdAt: loadout.createdAt || Date.now(),
    }));
};

// Function to migrate team loadouts to the correct format
const migrateTeamLoadouts = (data: any): any => {
    if (!Array.isArray(data)) return data;

    // Ensure each team loadout has the required fields
    return data.map((teamLoadout) => ({
        id: teamLoadout.id || uuidv4(),
        name: teamLoadout.name || 'Unnamed Team',
        shipLoadouts: Array.isArray(teamLoadout.shipLoadouts)
            ? teamLoadout.shipLoadouts.map((shipLoadout: any) => ({
                  position: shipLoadout.position,
                  shipId: shipLoadout.shipId,
                  equipment: shipLoadout.equipment || {},
              }))
            : [],
        createdAt: teamLoadout.createdAt || Date.now(),
    }));
};

// Function to migrate object structure to match current format
const migrateDataFormat = (key: string, data: any): any => {
    try {
        if (key === StorageKey.ENGINEERING_STATS) {
            return migrateEngineeringStats(data);
        } else if (key === StorageKey.LOADOUTS) {
            return migrateLoadouts(data);
        } else if (key === StorageKey.TEAM_LOADOUTS) {
            return migrateTeamLoadouts(data);
        }
        return data;
    } catch (error) {
        console.error(`Error migrating data format for ${key}:`, error);
        return data; // Return original data if migration fails
    }
};

export const BackupRestoreData: React.FC = () => {
    const { addNotification } = useNotification();
    const { user, signOut } = useAuth();
    const { activeProfileId } = useActiveProfile();
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showDeleteLocalStorageConfirm, setShowDeleteLocalStorageConfirm] = useState(false);

    const handleBackup = async () => {
        try {
            const backup: StorageData = {};
            for (const key of BACKUP_KEYS) {
                const cacheKey = indexedDbCacheKey(key, activeProfileId);
                if (cacheKey) {
                    const cached: unknown = await getFromIndexedDB(cacheKey);
                    if (cached !== undefined && cached !== null) {
                        backup[key] = JSON.stringify(cached);
                    }
                    continue;
                }
                const data = localStorage.getItem(key);
                if (data) {
                    backup[key] = data;
                }
            }

            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `starborne-planner-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            addNotification('success', 'Backup created successfully');
        } catch (error) {
            console.error('Backup failed:', error);
            addNotification('error', 'Failed to create backup');
        }
    };

    const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backup = JSON.parse(e.target?.result as string) as StorageData;
                const normalizedBackup: StorageData = {};

                // First, normalize the backup by mapping legacy keys to new keys
                Object.entries(backup).forEach(([key, value]) => {
                    if (!value) return;

                    // Check if this is a legacy key
                    const normalizedKey = LEGACY_KEY_MAP[key] || key;

                    if (BACKUP_KEYS.includes(normalizedKey)) {
                        try {
                            // Parse the data
                            const parsedData = JSON.parse(value);

                            // Migrate the data format if needed
                            const migratedData = migrateDataFormat(normalizedKey, parsedData);

                            // Stringify the migrated data
                            normalizedBackup[normalizedKey] = JSON.stringify(migratedData);
                        } catch (parseError) {
                            console.error(`Error parsing backup data for key ${key}:`, parseError);
                            normalizedBackup[normalizedKey] = value; // Keep original value if parsing fails
                        }
                    }
                });

                // Write each key back to the store the app actually reads it from.
                // Gear restored into localStorage is invisible to InventoryProvider,
                // which reads the IndexedDB cache.
                //
                // Only the keys that actually landed are collected: the cloud prune
                // below compares the cloud against LOCAL state, so naming a section
                // that failed to write would delete the very rows the backup carried.
                const restoredSections: string[] = [];

                for (const [key, value] of Object.entries(normalizedBackup)) {
                    if (!value) continue;

                    const cacheKey = indexedDbCacheKey(key, activeProfileId);
                    if (!cacheKey) {
                        localStorage.setItem(key, value);
                        restoredSections.push(key);
                        continue;
                    }

                    const gear = parseBackupInventory(JSON.parse(value));
                    if (!gear) {
                        console.error(`Backup section ${key} is not a valid gear inventory`);
                        addNotification(
                            'error',
                            'The backup file’s gear inventory is unreadable and was skipped'
                        );
                        continue;
                    }

                    try {
                        await setInIndexedDB(cacheKey, gear);
                        restoredSections.push(key);
                    } catch (cacheError) {
                        console.error(`Error restoring ${key} to IndexedDB:`, cacheError);
                        addNotification(
                            'error',
                            'Your gear inventory could not be saved and was skipped'
                        );
                    }
                }

                // If user is logged in, sync to Supabase
                if (activeProfileId) {
                    try {
                        // The restore writes local state, then hands the whole
                        // upload to the one routine that knows the column shape of
                        // every table. Building the payload here instead meant a
                        // rejected insert after an already-committed delete, which
                        // emptied cloud gear and ships outright (#504).
                        await reuploadLocalDataToSupabase(activeProfileId);

                        // Only now that every row in the backup exists remotely is
                        // it safe to remove what the backup does not have. The old
                        // order — delete, then upload — is what lost the data.
                        // Scoped to the keys this file actually carried: a section
                        // the file omits is left alone, never emptied.
                        await pruneSupabaseDataNotInLocal(activeProfileId, restoredSections);

                        addNotification('success', 'Data restored and synced to cloud storage');
                    } catch (error) {
                        console.error('Failed to sync with Supabase:', error);
                        addNotification(
                            'warning',
                            'Data restored locally but failed to sync to cloud'
                        );
                    }
                } else {
                    addNotification('success', 'Data restored locally');
                }

                addNotification('info', 'Please refresh the page to see the changes');
            } catch (error) {
                console.error('Restore failed:', error);
                addNotification('error', 'Failed to restore backup');
            }
        };

        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    };

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleDeleteLocalStorage = async () => {
        try {
            // Clear all backup keys from local storage
            BACKUP_KEYS.forEach((key) => localStorage.removeItem(key));
            // Inventory and gear_upgrades live in IndexedDB, not localStorage.
            await clearIndexedDBStorage();

            addNotification('success', 'Local storage cleared successfully');
            addNotification('info', 'Please refresh the page to see the changes');
            setShowDeleteLocalStorageConfirm(false);
        } catch (error) {
            console.error('Error clearing local storage:', error);
            addNotification('error', 'Failed to clear local storage');
        }
    };

    const handleDeleteAccount = async () => {
        if (!user?.id) return;

        try {
            // Clear local storage
            BACKUP_KEYS.forEach((key) => localStorage.removeItem(key));
            // Inventory and gear_upgrades live in IndexedDB, not localStorage.
            await clearIndexedDBStorage();

            // Delete user account
            await supabase.rpc('delete_user');
            await signOut();

            addNotification('success', 'Account deleted successfully');
        } catch (error) {
            console.error('Error deleting account:', error);
            addNotification('error', 'Failed to delete account. You may need to re-authenticate.');
        }
    };

    return (
        <div className="">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-theme-text">Backup Data</p>
                    <p className="text-sm text-theme-text-secondary mt-0.5">
                        Download a local JSON backup of all your planner data.
                    </p>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleBackup()}
                    aria-label="Backup data"
                >
                    Backup
                </Button>
            </div>

            <div className="flex items-start justify-between gap-4 border-t border-dark-border pt-4 mt-4">
                <div>
                    <p className="text-sm font-medium text-theme-text">Restore Data</p>
                    <p className="text-sm text-theme-text-secondary mt-0.5">
                        Restore from a previously downloaded backup file.
                    </p>
                </div>
                <div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={(e) => void handleRestore(e)}
                        className="hidden"
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRestoreClick}
                        aria-label="Restore data"
                    >
                        Restore
                    </Button>
                </div>
            </div>

            <div className="flex items-start justify-between gap-4 border-t border-dark-border pt-4 mt-4">
                <div>
                    <p className="text-sm font-medium text-theme-text">Delete Local Storage</p>
                    <p className="text-sm text-theme-text-secondary mt-0.5">
                        Wipes all locally stored data. Cloud data is unaffected if you&apos;re
                        signed in.
                    </p>
                </div>
                <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setShowDeleteLocalStorageConfirm(true)}
                >
                    Delete
                </Button>
            </div>

            {user && (
                <div className="flex items-start justify-between gap-4 border-t border-dark-border pt-4 mt-4">
                    <div>
                        <p className="text-sm font-medium text-theme-text">Delete Account</p>
                        <p className="text-sm text-theme-text-secondary mt-0.5">
                            Permanently deletes your account and all associated data. Cannot be
                            undone.
                        </p>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                        Delete
                    </Button>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteLocalStorageConfirm}
                onClose={() => setShowDeleteLocalStorageConfirm(false)}
                onConfirm={() => void handleDeleteLocalStorage()}
                title="Delete Local Storage"
                message="Are you sure you want to delete all local storage data? This will clear all your ships, gear, loadouts, and other local data. This action cannot be undone. If you're logged in, your cloud data will remain safe."
                confirmLabel="Delete Local Storage"
                cancelLabel="Cancel"
            />

            <ConfirmModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={() => void handleDeleteAccount()}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your data."
                confirmLabel="Delete Account"
                cancelLabel="Cancel"
            />
        </div>
    );
};

/* eslint-enable @typescript-eslint/no-explicit-any */
