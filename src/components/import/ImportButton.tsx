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
import { Checkbox } from '../ui';
import { uploadToCubedweb } from '../../utils/uploadToCubedweb';
import { HangarNameModal } from './HangarNameModal';
import { trackDataImport } from '../../services/usageTracking';

export const ImportButton: React.FC<{
    className?: string;
    shareData?: boolean;
    setShareData?: (value: boolean) => void;
}> = ({ className = '', shareData: externalShareData, setShareData: externalSetShareData }) => {
    const { setData: setShips } = useShips();
    const { setData: setInventory } = useInventory();
    const { setData: setEngineeringStats } = useEngineeringStats();
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [internalShareData, setInternalShareData] = useState(false);
    const [showHangarModal, setShowHangarModal] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadingToCubedweb, setUploadingToCubedweb] = useState(false);

    // Use external state if provided, otherwise use internal state
    const shareData = externalShareData !== undefined ? externalShareData : internalShareData;
    const setShareData = externalSetShareData || setInternalShareData;

    const handleFileUpload = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            // If sharing is enabled, show the hangar name modal
            if (shareData) {
                setSelectedFile(file);
                setShowHangarModal(true);
                return;
            }

            // Otherwise, proceed with normal import
            await processFileImport(file);
        },
        [setShips, setInventory, setEngineeringStats, addNotification, user, shareData]
    );

    const processFileImport = useCallback(
        async (file: File) => {
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
                        const syncResult = await syncMigratedDataToSupabase(user.id, {
                            ships: result.data.ships,
                            inventory: result.data.inventory,
                            encounters: [],
                            loadouts: [],
                            teamLoadouts: [],
                            engineeringStats: result.data.engineeringStats,
                        });

                        if (syncResult.success) {
                            // Track data import
                            await trackDataImport(user.id);
                            refreshPage('Data synced successfully, refreshing in 3 seconds...');
                        } else {
                            addNotification(
                                'error',
                                'Failed to sync data with supabase: ' +
                                    (syncResult.error as Error).message || 'Unknown error'
                            );
                        }
                    } else {
                        refreshPage('Data imported successfully, refreshing in 3 seconds...');
                    }
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
                // Reset the file input
                const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
                if (fileInput) fileInput.value = '';
            }
        },
        [setShips, setInventory, setEngineeringStats, addNotification, user]
    );

    const handleHangarNameSubmit = useCallback(
        async (hangarName: string) => {
            if (!selectedFile) return;

            setUploadingToCubedweb(true);
            try {
                // Upload to cubedweb first
                const uploadResult = await uploadToCubedweb(selectedFile, hangarName);

                if (uploadResult.success && uploadResult.hangarUrl) {
                    addNotification(
                        'success',
                        `Hangar uploaded successfully! View it at: ${uploadResult.hangarUrl}`
                    );
                } else {
                    addNotification(
                        'error',
                        `Failed to upload to cubedweb: ${uploadResult.error || 'Unknown error'}`
                    );
                }

                // Close modal and proceed with normal import
                setShowHangarModal(false);
                setSelectedFile(null);
                await processFileImport(selectedFile);
            } catch (error) {
                console.error('Error uploading to cubedweb:', error);
                addNotification(
                    'error',
                    'Failed to upload to cubedweb: ' +
                        (error instanceof Error ? error.message : 'Unknown error')
                );
            } finally {
                setUploadingToCubedweb(false);
            }
        },
        [selectedFile, addNotification, processFileImport]
    );

    const refreshPage = useCallback((message: string) => {
        addNotification('success', message);
        if (!shareData) {
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        }
    }, []);

    return (
        <div>
            <Checkbox
                className="hidden"
                id="share-data"
                label="Upload to cubedweb"
                helpLabel="Check this if you want to upload your data to frontiers.cubedweb.net aswell, a tool to create shareable hangars."
                checked={shareData}
                onChange={() => setShareData(!shareData)}
            />
            <div className={`flex align-items-center gap-2`}>
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

            <HangarNameModal
                isOpen={showHangarModal}
                onClose={() => {
                    setShowHangarModal(false);
                    setSelectedFile(null);
                    // Reset the file input
                    const fileInput = document.getElementById(
                        'import-file-input'
                    ) as HTMLInputElement;
                    if (fileInput) fileInput.value = '';
                }}
                onSubmit={handleHangarNameSubmit}
                loading={uploadingToCubedweb}
                fileSize={selectedFile?.size}
            />
        </div>
    );
};
