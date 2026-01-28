import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout, CollapsibleForm, ConfirmModal } from '../../components/ui';
import { GearPieceForm } from '../../components/gear/GearPieceForm';
import { GearInventory } from '../../components/gear/GearInventory';
import { GearUpgradeAnalysis } from '../../components/gear/GearUpgradeAnalysis';
import { GearCalibrationAnalysis } from '../../components/gear/GearCalibrationAnalysis';
import { CalibrationModal } from '../../components/gear/CalibrationModal';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../contexts/InventoryProvider';
import { useNotification } from '../../hooks/useNotification';
import { SHIP_TYPES } from '../../constants';
import { Tabs } from '../../components/ui/layout/Tabs';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

export const GearPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const { inventory, loading, addGear, updateGearPiece, deleteGearPiece } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingDeletePieceEquipped, setPendingDeletePieceEquipped] = useState(false);
    const [activeTab, setActiveTab] = useState('inventory');
    const [calibrationModalOpen, setCalibrationModalOpen] = useState(false);
    const [calibratingGear, setCalibratingGear] = useState<GearPiece | null>(null);
    const [calibrationInitialShipId, setCalibrationInitialShipId] = useState<string | null>(null);
    const [initialShipId, setInitialShipId] = useState<string | null>(null);
    const [initialSubTab, setInitialSubTab] = useState<'candidates' | 'ship' | null>(null);
    const tabs = [
        { id: 'inventory', label: 'Inventory' },
        { id: 'calibration', label: 'Calibration' },
        { id: 'analysis', label: 'Upgrade Analysis' },
        { id: 'simulation', label: 'Simulate Upgrades' },
    ];

    // Handle URL params for deep linking (e.g., from ShipCard "Calibrate gear" shortcut)
    useEffect(() => {
        const tab = searchParams.get('tab');
        const subTab = searchParams.get('subTab');
        const shipId = searchParams.get('shipId');

        if (tab && tabs.some((t) => t.id === tab)) {
            setActiveTab(tab);
        }

        if (subTab === 'candidates' || subTab === 'ship') {
            setInitialSubTab(subTab);
        }

        if (shipId) {
            setInitialShipId(shipId);
        }

        // Clear URL params after reading
        if (tab || subTab || shipId) {
            window.history.replaceState({}, '', window.location.pathname);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRemovePiece = async (id: string) => {
        const piece = inventory.find((p) => p.id === id);
        setPendingDeletePieceEquipped(!!piece?.shipId);
        setPendingDeleteId(id);
        setShowDeleteConfirm(true);
    };

    const handleDeleteGearPiece = async (id: string) => {
        try {
            await deleteGearPiece(id);
            addNotification('success', 'Gear piece removed successfully');
            setPendingDeleteId(null);
            setShowDeleteConfirm(false);
        } catch (error) {
            addNotification('error', 'Failed to remove gear piece');
        }
    };

    const handleEditPiece = (piece: GearPiece) => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setEditingPiece(piece);
        setIsFormVisible(true);
    };

    const handleSavePiece = async (piece: GearPiece) => {
        try {
            if (editingPiece) {
                // Update existing piece
                await updateGearPiece(piece.id, piece);
            } else {
                // Add new piece
                await addGear(piece);
            }
            setEditingPiece(undefined);
            setIsFormVisible(false);
            addNotification('success', 'Gear piece saved successfully');
        } catch (error) {
            addNotification('error', 'Failed to save gear piece');
        }
    };

    const handleOpenCalibration = (piece: GearPiece, shipId?: string) => {
        setCalibratingGear(piece);
        setCalibrationInitialShipId(shipId || null);
        setCalibrationModalOpen(true);
    };

    const handleCloseCalibration = () => {
        setCalibrationModalOpen(false);
        setCalibratingGear(null);
        setCalibrationInitialShipId(null);
    };

    const handleConfirmCalibration = async (gearId: string, shipId: string) => {
        try {
            await updateGearPiece(gearId, {
                calibration: { shipId },
            });
            addNotification('success', 'Gear calibrated successfully');
        } catch (error) {
            addNotification('error', 'Failed to calibrate gear');
        }
    };

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.gear} />
            <PageLayout
                title="Gear Management"
                description="Manage your gear and its stats."
                action={{
                    label: isFormVisible ? 'Hide Form' : 'Create',
                    onClick: () => {
                        if (editingPiece) {
                            setEditingPiece(undefined);
                        }
                        setIsFormVisible(!isFormVisible);
                    },
                    variant: isFormVisible ? 'secondary' : 'primary',
                }}
                helpLink="/documentation#gear"
            >
                <CollapsibleForm isVisible={isFormVisible || !!editingPiece}>
                    <GearPieceForm onSubmit={handleSavePiece} editingPiece={editingPiece} />
                </CollapsibleForm>

                <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
                {activeTab === 'inventory' && (
                    <GearInventory
                        inventory={inventory}
                        onRemove={handleRemovePiece}
                        onEdit={handleEditPiece}
                        onCalibrate={handleOpenCalibration}
                        maxItems={inventory.length}
                    />
                )}
                {activeTab === 'calibration' && (
                    <GearCalibrationAnalysis
                        inventory={inventory}
                        shipRoles={Object.keys(SHIP_TYPES)}
                        onEdit={handleEditPiece}
                        onCalibrate={handleOpenCalibration}
                        initialShipId={initialShipId}
                        initialSubTab={initialSubTab}
                    />
                )}
                {activeTab === 'analysis' && (
                    <GearUpgradeAnalysis
                        inventory={inventory}
                        shipRoles={Object.keys(SHIP_TYPES)}
                        mode="analysis"
                        onEdit={handleEditPiece}
                    />
                )}
                {activeTab === 'simulation' && (
                    <GearUpgradeAnalysis
                        inventory={inventory}
                        shipRoles={Object.keys(SHIP_TYPES)}
                        mode="simulation"
                        onEdit={handleEditPiece}
                    />
                )}

                <ConfirmModal
                    isOpen={showDeleteConfirm}
                    onClose={() => {
                        setShowDeleteConfirm(false);
                        setPendingDeleteId(null);
                    }}
                    onConfirm={() => pendingDeleteId && handleDeleteGearPiece(pendingDeleteId)}
                    title="Delete Gear Piece"
                    message={
                        pendingDeletePieceEquipped
                            ? 'This gear piece is currently equipped. Are you sure you want to delete it?'
                            : 'Are you sure you want to delete this gear piece?'
                    }
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                />

                <CalibrationModal
                    isOpen={calibrationModalOpen}
                    onClose={handleCloseCalibration}
                    gear={calibratingGear}
                    onConfirm={handleConfirmCalibration}
                    initialShipId={calibrationInitialShipId}
                />
            </PageLayout>
        </>
    );
};

export default GearPage;
