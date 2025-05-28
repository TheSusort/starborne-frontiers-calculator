import React, { useCallback } from 'react';
import { Button } from '../ui/Button';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../contexts/EngineeringStatsProvider';
import { importPlayerData } from '../../utils/importPlayerData';
import { useNotification } from '../../hooks/useNotification';
import { ExportedPlayData } from '../../types/exportedPlayData';

export const ImportButton: React.FC = () => {
    const { setData: setShips } = useShips();
    const { setData: setInventory } = useInventory();
    const { setData: setEngineeringStats } = useEngineeringStats();
    const { addNotification } = useNotification();

    const handleFileUpload = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text) as ExportedPlayData;

                const result = await importPlayerData(data);

                if (result.success && result.data) {
                    // Update all states with the imported data
                    await setShips(result.data.ships);
                    await setInventory(result.data.inventory);
                    await setEngineeringStats(result.data.engineeringStats);

                    addNotification('success', 'Data imported successfully');
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
            }

            // Reset the file input
            event.target.value = '';
        },
        [setShips, setInventory, setEngineeringStats, addNotification]
    );

    return (
        <div className="d-flex align-items-center">
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
            >
                Import Data
            </Button>
        </div>
    );
};
