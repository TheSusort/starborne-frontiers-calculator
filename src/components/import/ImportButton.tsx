import React, { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '../ui/Button';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../contexts/EngineeringStatsProvider';
import { importPlayerData } from '../../utils/importPlayerData';
import { useNotification } from '../../hooks/useNotification';
import { validateExportedPlayData } from '../../schemas/exportedPlayData';
import { ExportedPlayData } from '../../types/exportedPlayData';
import { syncMigratedDataToSupabase } from '../../utils/migratePlayerData';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { Checkbox } from '../ui/Checkbox';
import { uploadToCubedweb } from '../../utils/uploadToCubedweb';
import { trackDataImport } from '../../services/usageTracking';
import {
    extractLevel60Ships,
    compareShipsAgainstTemplates,
} from '../../utils/shipTemplateComparison';
import { submitTemplateProposal } from '../../services/shipTemplateProposalService';
import { supabase } from '../../config/supabase';
import { Ship, AffinityName } from '../../types/ship';
import { RarityName } from '../../constants/rarities';
import { FactionName } from '../../constants/factions';
import { ShipTypeName } from '../../constants/shipTypes';
import { StorageKey } from '../../constants/storage';
import { ImportDiff } from '../../types/importDiff';
import { computeImportDiff } from '../../utils/import/computeImportDiff';
import { HangarNameModal } from './HangarNameModal';
import { ImportDiffModal } from './ImportDiffModal';

export const ImportButton: React.FC<{
    className?: string;
    shareData?: boolean;
    setShareData?: (value: boolean) => void;
    testId?: string;
}> = ({
    className = '',
    shareData: externalShareData,
    setShareData: externalSetShareData,
    testId,
}) => {
    const { ships, setData: setShips, loadShips } = useShips();
    const { inventory, setData: setInventory, loadInventory } = useInventory();
    const { engineeringStats, setData: setEngineeringStats } = useEngineeringStats();
    const { addNotification } = useNotification();
    const { user } = useAuth();
    const { activeProfileId } = useActiveProfile();
    const [loading, setLoading] = useState(false);
    const [internalShareData, setInternalShareData] = useState(false);
    const [showHangarModal, setShowHangarModal] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadingToCubedweb, setUploadingToCubedweb] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [diffResult, setDiffResult] = useState<ImportDiff | null>(null);
    const [importFileTimestamp, setImportFileTimestamp] = useState<number | null>(null);
    // Unique id per ImportButton instance so multiple mounts (e.g. HomePage CTA
    // + Sidebar) don't collide on a single DOM id. The id is used for the
    // hidden-input click delegation below.
    const reactId = useId();
    const inputDomId = `import-file-input-${reactId}`;

    // Use external state if provided, otherwise use internal state
    const shareData = externalShareData !== undefined ? externalShareData : internalShareData;
    const setShareData = externalSetShareData || setInternalShareData;

    // Helper to fetch templates fresh from Supabase
    const fetchTemplateShips = async (): Promise<Ship[]> => {
        try {
            const { data, error } = await supabase.from('ship_templates').select('*');

            if (error) throw error;

            return (
                data?.map((template) => ({
                    id: template.id,
                    name: template.name,
                    rarity: template.rarity.toLowerCase() as RarityName,
                    faction: template.faction as FactionName,
                    type: template.type as ShipTypeName,
                    baseStats: {
                        hp: template.base_stats.hp,
                        attack: template.base_stats.attack,
                        defence: template.base_stats.defence,
                        hacking: template.base_stats.hacking,
                        security: template.base_stats.security,
                        crit: template.base_stats.crit_rate,
                        critDamage: template.base_stats.crit_damage,
                        speed: template.base_stats.speed,
                        healModifier: 0,
                        hpRegen: 0,
                        shield: template.base_stats.shield || 0,
                        shieldPenetration: template.base_stats.shield_penetration || 0,
                        defensePenetration: template.base_stats.defense_penetration || 0,
                    },
                    equipment: {},
                    refits: [],
                    implants: {},
                    affinity: template.affinity.toLowerCase() as AffinityName,
                    imageKey: template.image_key,
                    activeSkillText: template.active_skill_text,
                    chargeSkillText: template.charge_skill_text,
                    firstPassiveSkillText: template.first_passive_skill_text,
                    secondPassiveSkillText: template.second_passive_skill_text,
                    thirdPassiveSkillText: template.third_passive_skill_text,
                })) || []
            );
        } catch (error) {
            console.error('[Import] Error fetching template ships:', error);
            return [];
        }
    };

    const extractFileTimestamp = (file: File): number => {
        const match = file.name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
        if (match) {
            const [, year, month, day, hour, minute, second] = match;
            const ts = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
            if (!isNaN(ts)) return ts;
        }
        return file.lastModified;
    };

    const processFileImport = useCallback(
        async (file: File) => {
            const oldShips = ships;
            const oldInventory = inventory;
            const fileTimestamp = extractFileTimestamp(file);
            try {
                setLoading(true);
                const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
                if (file.size > MAX_FILE_SIZE) {
                    addNotification(
                        'error',
                        `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 30 MB.`
                    );
                    setLoading(false);
                    return;
                }
                const text = await file.text();
                const validation = validateExportedPlayData(JSON.parse(text));
                if (!validation.success) {
                    addNotification('error', validation.error);
                    setLoading(false);
                    return;
                }
                // Cast is safe — schema validated all required fields above
                const data = validation.data as unknown as ExportedPlayData;

                addNotification('info', 'Processing game data...', 10000);
                const result = await importPlayerData(data);

                if (result.success && result.data) {
                    // Preserve user-set fields that the game export doesn't include
                    const oldShipById = new Map(oldShips.map((s) => [s.id, s]));
                    const shipsToStore = result.data.ships.map((s) => {
                        const prev = oldShipById.get(s.id);
                        return prev
                            ? { ...s, equipmentLocked: prev.equipmentLocked, starred: prev.starred }
                            : s;
                    });

                    // Update all states with the imported data
                    addNotification('info', 'Saving data locally...', 10000);
                    await setShips(shipsToStore);
                    await setInventory(result.data.inventory);
                    await setEngineeringStats(result.data.engineeringStats);

                    // Clear demo data flag if it was set — the user has imported real data
                    localStorage.removeItem(StorageKey.DEMO_DATA_LOADED);

                    // Check for template updates BEFORE syncing (so it completes before refresh)
                    if (user) {
                        try {
                            // Fetch templates fresh from Supabase
                            const templateShips = await fetchTemplateShips();

                            if (templateShips.length > 0) {
                                const level60Ships = extractLevel60Ships(data);
                                const proposals = compareShipsAgainstTemplates(
                                    level60Ships,
                                    templateShips
                                );
                                // Submit proposals if any differences found
                                if (proposals.length > 0) {
                                    // Run submissions in parallel for speed
                                    await Promise.all(
                                        proposals.map((proposal) =>
                                            submitTemplateProposal(
                                                proposal,
                                                activeProfileId ?? user.id
                                            )
                                        )
                                    );
                                }
                            }
                        } catch (error) {
                            // Silently fail - don't interrupt user experience
                            console.error('Error checking template updates:', error);
                        }
                    }

                    // Track data import (for both logged-in and anonymous users)
                    await trackDataImport(activeProfileId);

                    const diff = computeImportDiff(
                        oldShips,
                        oldInventory,
                        result.data.ships,
                        result.data.inventory,
                        result.data.engineeringStats
                    );

                    // sync to supabase if user is logged in
                    if (user) {
                        addNotification('info', 'Syncing to cloud...', 30000);
                        const syncResult = await syncMigratedDataToSupabase(
                            activeProfileId ?? user.id,
                            {
                                ships: shipsToStore,
                                inventory: result.data.inventory,
                                encounters: [],
                                loadouts: [],
                                teamLoadouts: [],
                                engineeringStats: result.data.engineeringStats,
                            }
                        );

                        if (syncResult.success) {
                            setImportFileTimestamp(fileTimestamp);
                            setDiffResult(diff);
                            void Promise.all([loadShips(), loadInventory()]);
                        } else {
                            addNotification(
                                'error',
                                'Failed to sync data with supabase: ' +
                                    (syncResult.error as Error).message || 'Unknown error'
                            );
                        }
                    } else {
                        setImportFileTimestamp(fileTimestamp);
                        setDiffResult(diff);
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
                const fileInput = document.getElementById(inputDomId) as HTMLInputElement;
                if (fileInput) fileInput.value = '';
            }
        },
        [
            ships,
            inventory,
            setShips,
            setInventory,
            setEngineeringStats,
            loadShips,
            loadInventory,
            addNotification,
            user,
            activeProfileId,
            inputDomId,
        ]
    );

    const handleFile = useCallback(
        async (file: File) => {
            if (loading) return;

            // If sharing is enabled, show the hangar name modal
            if (shareData) {
                setSelectedFile(file);
                setShowHangarModal(true);
                return;
            }

            // Otherwise, proceed with normal import
            await processFileImport(file);
        },
        [loading, shareData, processFileImport]
    );

    const handleFileUpload = useCallback(
        async (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) await handleFile(file);
        },
        [handleFile]
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

    // Prevent the browser from navigating to a file if the user drops it outside
    // the drop zone. Without this, a stray drop anywhere else on the page opens
    // the file and loses the user's session.
    useEffect(() => {
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);
        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
        };
    }, []);

    const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!loading && e.dataTransfer.types.includes('Files')) {
            setIsDragging(true);
        }
    };
    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };
    const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        // Only clear highlight when the drag leaves the wrapper, not a child.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
    };
    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.json')) {
            addNotification('error', 'Please drop a .json export file');
            return;
        }
        void handleFile(file);
    };

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
            <div
                className={`flex align-items-center gap-2 rounded transition-shadow ${
                    isDragging ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-dark' : ''
                }`}
                onDragEnter={onDragEnter}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <input
                    type="file"
                    accept=".json"
                    onChange={(e) => void handleFileUpload(e)}
                    style={{ display: 'none' }}
                    id={inputDomId}
                    data-testid={testId}
                />
                <Button
                    variant="primary"
                    onClick={() => document.getElementById(inputDomId)?.click()}
                    className={className}
                    data-import-button
                    title="Click to select a file or drop a .json export here"
                >
                    {loading ? (
                        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-dark absolute top-2 left-1/2"></div>
                    ) : isDragging ? (
                        'Drop to import'
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
                    const fileInput = document.getElementById(inputDomId) as HTMLInputElement;
                    if (fileInput) fileInput.value = '';
                }}
                onSubmit={(name: string) => void handleHangarNameSubmit(name)}
                loading={uploadingToCubedweb}
                fileSize={selectedFile?.size}
            />
            <ImportDiffModal
                diff={diffResult}
                fileTimestamp={importFileTimestamp}
                onClose={() => {
                    setDiffResult(null);
                    setImportFileTimestamp(null);
                }}
            />
        </div>
    );
};
