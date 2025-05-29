/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Button, ConfirmModal } from '../ui';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';
import { StorageKey, StorageKeyType } from '../../constants/storage';
import { supabase } from '../../config/supabase';
import { GearSlotName } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { ImportButton } from './ImportButton';

const BACKUP_KEYS = Object.values(StorageKey);

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

// Create types for the data structures
interface LoadoutEquipment {
    [key: string]: string;
}

interface LoadoutData {
    id: string;
    name: string;
    shipId: string;
    equipment: LoadoutEquipment;
    createdAt: number;
}

interface ShipLoadout {
    position: number;
    shipId: string;
    equipment: LoadoutEquipment;
}

interface TeamLoadoutData {
    id: string;
    name: string;
    shipLoadouts: ShipLoadout[];
    createdAt: number;
}

export const BackupRestoreData: React.FC = () => {
    const { addNotification } = useNotification();
    const { user, signOut } = useAuth();
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleBackup = () => {
        try {
            const backup: StorageData = {};
            BACKUP_KEYS.forEach((key) => {
                const data = localStorage.getItem(key);
                if (data) {
                    backup[key] = data;
                }
            });

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

                    if (BACKUP_KEYS.includes(normalizedKey as StorageKeyType)) {
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

                // Update localStorage with normalized data
                Object.entries(normalizedBackup).forEach(([key, value]) => {
                    if (value) {
                        localStorage.setItem(key, value);
                    }
                });

                // If user is logged in, sync to Supabase
                if (user?.id) {
                    try {
                        const tableNameMap: Record<string, string> = {
                            [StorageKey.SHIPS]: 'ships',
                            [StorageKey.INVENTORY]: 'inventory_items',
                            [StorageKey.ENCOUNTERS]: 'encounter_notes',
                            [StorageKey.ENGINEERING_STATS]: 'engineering_stats',
                            [StorageKey.LOADOUTS]: 'loadouts',
                            [StorageKey.TEAM_LOADOUTS]: 'team_loadouts',
                        };

                        // Process each data type for Supabase
                        for (const [key, value] of Object.entries(normalizedBackup)) {
                            if (!value || !tableNameMap[key]) continue;

                            const tableName = tableNameMap[key];
                            const parsedData = JSON.parse(value);

                            // Handle different data types
                            if (key === StorageKey.LOADOUTS) {
                                // Handle loadouts specially
                                await supabase.from('loadouts').delete().eq('user_id', user.id);

                                if (Array.isArray(parsedData) && parsedData.length > 0) {
                                    // Insert loadout records
                                    const loadoutRecords = parsedData.map(
                                        (loadout: LoadoutData) => ({
                                            id: loadout.id,
                                            user_id: user.id,
                                            name: loadout.name,
                                            ship_id: loadout.shipId,
                                            created_at: new Date(loadout.createdAt).toISOString(),
                                        })
                                    );

                                    await supabase.from('loadouts').insert(loadoutRecords);

                                    // Insert equipment records
                                    const equipmentRecords = parsedData.flatMap(
                                        (loadout: LoadoutData) =>
                                            Object.entries(loadout.equipment).map(
                                                ([slot, gearId]) => ({
                                                    loadout_id: loadout.id,
                                                    slot: slot as GearSlotName,
                                                    gear_id: gearId,
                                                })
                                            )
                                    );

                                    if (equipmentRecords.length > 0) {
                                        await supabase
                                            .from('loadout_equipment')
                                            .insert(equipmentRecords);
                                    }
                                }
                            } else if (key === StorageKey.TEAM_LOADOUTS) {
                                // Handle team loadouts specially
                                await supabase
                                    .from('team_loadouts')
                                    .delete()
                                    .eq('user_id', user.id);

                                if (Array.isArray(parsedData) && parsedData.length > 0) {
                                    // Insert team loadout records
                                    const teamLoadoutRecords = parsedData.map((teamLoadout) => ({
                                        id: teamLoadout.id,
                                        user_id: user.id,
                                        name: teamLoadout.name,
                                        created_at: new Date(teamLoadout.createdAt).toISOString(),
                                    }));

                                    await supabase.from('team_loadouts').insert(teamLoadoutRecords);

                                    // Insert ship records
                                    const shipRecords = parsedData.flatMap(
                                        (teamLoadout: TeamLoadoutData) =>
                                            teamLoadout.shipLoadouts.map(
                                                (shipLoadout: ShipLoadout, index: number) => ({
                                                    team_loadout_id: teamLoadout.id,
                                                    position: index,
                                                    ship_id: shipLoadout.shipId,
                                                })
                                            )
                                    );

                                    if (shipRecords.length > 0) {
                                        await supabase
                                            .from('team_loadout_ships')
                                            .insert(shipRecords);
                                    }

                                    // Insert equipment records
                                    const equipmentRecords = parsedData.flatMap(
                                        (teamLoadout: TeamLoadoutData) =>
                                            teamLoadout.shipLoadouts.flatMap(
                                                (shipLoadout: ShipLoadout, position: number) =>
                                                    Object.entries(shipLoadout.equipment).map(
                                                        ([slot, gearId]) => ({
                                                            team_loadout_id: teamLoadout.id,
                                                            position,
                                                            slot: slot as GearSlotName,
                                                            gear_id: gearId,
                                                        })
                                                    )
                                            )
                                    );

                                    if (equipmentRecords.length > 0) {
                                        await supabase
                                            .from('team_loadout_equipment')
                                            .insert(equipmentRecords);
                                    }
                                }
                            } else if (key === StorageKey.ENGINEERING_STATS) {
                                // Handle engineering stats specially
                                await supabase.from(tableName).delete().eq('user_id', user.id);

                                if (parsedData.stats && parsedData.stats.length > 0) {
                                    const records = parsedData.stats.flatMap((stat: any) =>
                                        stat.stats.map((s: any) => ({
                                            user_id: user.id,
                                            ship_type: stat.shipType,
                                            stat_name: s.name,
                                            value: s.value,
                                            type: s.type,
                                        }))
                                    );

                                    if (records.length > 0) {
                                        await supabase.from(tableName).insert(records);
                                    }
                                }
                            } else if (Array.isArray(parsedData)) {
                                // Handle other array data
                                await supabase.from(tableName).delete().eq('user_id', user.id);

                                if (parsedData.length > 0) {
                                    await supabase.from(tableName).insert(
                                        parsedData.map((item: any) => ({
                                            ...item,
                                            user_id: user.id,
                                        }))
                                    );
                                }
                            }
                        }

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

    const handleDeleteAccount = async () => {
        if (!user?.id) return;

        try {
            // Clear local storage
            BACKUP_KEYS.forEach((key) => localStorage.removeItem(key));

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
        <div className="space-y-4">
            <div className="flex items-center gap-4">
                <Button variant="secondary" onClick={handleBackup} aria-label="Backup data">
                    Backup Data
                </Button>

                <div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleRestore}
                        className="hidden"
                    />
                    <Button
                        variant="secondary"
                        onClick={handleRestoreClick}
                        aria-label="Restore data"
                    >
                        Restore Data
                    </Button>
                </div>
            </div>
            {user && (
                <div className="border-t pt-4 mt-4">
                    <h3 className="text-lg font-medium mb-2">Danger Zone</h3>
                    <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                        Delete Account
                    </Button>
                </div>
            )}

            <ConfirmModal
                isOpen={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={handleDeleteAccount}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your data."
                confirmLabel="Delete Account"
                cancelLabel="Cancel"
            />
        </div>
    );
};

/* eslint-enable @typescript-eslint/no-explicit-any */
