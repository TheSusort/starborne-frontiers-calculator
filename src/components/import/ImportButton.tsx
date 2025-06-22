import React, { useCallback, useState } from 'react';
import { Button } from '../ui/Button';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../contexts/EngineeringStatsProvider';
import { importPlayerData } from '../../utils/importPlayerData';
import { useNotification } from '../../hooks/useNotification';
import { ExportedPlayData } from '../../types/exportedPlayData';
import { syncMigratedDataToSupabase } from '../../utils/migratePlayerData';
import { useAuth } from '../../contexts/AuthProvider';

export const ImportButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { setData: setShips } = useShips();
    const { setData: setInventory } = useInventory();
    const { setData: setEngineeringStats } = useEngineeringStats();
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);

    const handleFileUpload = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                setLoading(true);
                const text = await file.text();
                const data = JSON.parse(text) as ExportedPlayData;

                const result = await importPlayerData(data);

                if (result.success && result.data) {
                    // Update all states with the imported data
                    await setShips(result.data.ships);
                    await setInventory(result.data.inventory);
                    await setEngineeringStats(result.data.engineeringStats);

                    // sync to supabase if user is logged in
                    if (user) {
                        await syncMigratedDataToSupabase(user.id, {
                            ships: result.data.ships,
                            inventory: result.data.inventory,
                            encounters: [],
                            loadouts: [],
                            teamLoadouts: [],
                            engineeringStats: result.data.engineeringStats,
                        });
                    }

                    addNotification('success', 'Data imported successfully, refreshing...');
                } else {
                    addNotification('error', result.error || 'Failed to import data');
                }
            } catch (error) {
                console.error('Error importing data:', error);
                addNotification(
                    'error',
                    'Failed to import data: ' +
                        (error instanceof Error ? error.message : 'Unknown error')
                );
            } finally {
                setLoading(false);
            }

            // Reset the file input
            event.target.value = '';
        },
        [setShips, setInventory, setEngineeringStats, addNotification, user]
    );

    return (
        <div className={`d-flex align-items-center`}>
            <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                id="import-file-input"
            />
            <Button
                variant="primary"
                onClick={() => document.getElementById('import-file-input')?.click()}
                className={className}
            >
                {loading ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-dark absolute top-2 left-1/2"></div>
                ) : (
                    'Import Game Data'
                )}
            </Button>
        </div>
    );
};
