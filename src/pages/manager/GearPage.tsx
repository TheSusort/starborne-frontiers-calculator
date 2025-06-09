import React, { useState } from 'react';
import { PageLayout, CollapsibleForm, ConfirmModal } from '../../components/ui';
import { GearPieceForm } from '../../components/gear/GearPieceForm';
import { GearInventory } from '../../components/gear/GearInventory';
import { GearUpgradeAnalysis } from '../../components/gear/GearUpgradeAnalysis';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../contexts/InventoryProvider';
import { useNotification } from '../../hooks/useNotification';
import { SHIP_TYPES } from '../../constants';
import { Tabs } from '../../components/ui/layout/Tabs';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

export const GearPage: React.FC = () => {
    const { inventory, loading, addGear, updateGearPiece, deleteGearPiece } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingDeletePieceEquipped, setPendingDeletePieceEquipped] = useState(false);
    const [activeTab, setActiveTab] = useState('inventory');
    const tabs = [
        { id: 'inventory', label: 'Inventory' },
        { id: 'analysis', label: 'Upgrade Analysis' },
    ];

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
            window.scrollTo({ top: 0, behavior: 'smooth' });
            addNotification('success', 'Gear piece saved successfully');
        } catch (error) {
            addNotification('error', 'Failed to save gear piece');
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
            >
                <CollapsibleForm isVisible={isFormVisible || !!editingPiece}>
                    <GearPieceForm onSubmit={handleSavePiece} editingPiece={editingPiece} />
                </CollapsibleForm>

                <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
                {activeTab === 'inventory' ? (
                    <GearInventory
                        inventory={inventory}
                        onRemove={handleRemovePiece}
                        onEdit={handleEditPiece}
                        maxItems={inventory.length}
                    />
                ) : (
                    <GearUpgradeAnalysis
                        inventory={inventory}
                        shipRoles={Object.keys(SHIP_TYPES)}
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
            </PageLayout>
        </>
    );
};

export default GearPage;
