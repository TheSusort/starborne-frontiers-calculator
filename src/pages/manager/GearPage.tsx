import React, { useState, useEffect } from 'react';
import { PageLayout, CollapsibleForm, ConfirmModal } from '../../components/ui';
import { GearPieceForm } from '../../components/gear/GearPieceForm';
import { GearInventory } from '../../components/gear/GearInventory';
import { GearUpgradeAnalysis } from '../../components/gear/GearUpgradeAnalysis';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../hooks/useInventory';
import { useNotification } from '../../hooks/useNotification';
import { useShips } from '../../hooks/useShips';
import { SHIP_TYPES } from '../../constants';
import { Tabs } from '../../components/ui/layout/Tabs';
import { Loader } from '../../components/ui/Loader';

export const GearPage: React.FC = () => {
    const { inventory, loading, error, saveInventory } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();
    const { ships } = useShips();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingDeletePieceEquipped, setPendingDeletePieceEquipped] = useState(false);
    const [activeTab, setActiveTab] = useState('inventory');

    const tabs = [
        { id: 'inventory', label: 'Inventory' },
        { id: 'analysis', label: 'Upgrade Analysis' },
    ];

    useEffect(() => {
        // Validate that all equipped gear matches ship assignments
        const validateGearAssignments = async () => {
            const newInventory = inventory.map((gear) => {
                if (gear.shipId) {
                    // Check if the gear is actually equipped on the ship it claims to be equipped on
                    const ship = ships.find((s) => s.id === gear.shipId);
                    if (!ship || !Object.values(ship.equipment).includes(gear.id)) {
                        // If not, clear the shipId
                        return { ...gear, shipId: '' };
                    }
                }
                return gear;
            });

            // Only save if there were changes
            if (JSON.stringify(newInventory) !== JSON.stringify(inventory)) {
                await saveInventory(newInventory);
            }
        };

        validateGearAssignments();
    }, [inventory, ships, saveInventory]);

    const handleRemovePiece = async (id: string) => {
        const piece = inventory.find((p) => p.id === id);
        setPendingDeletePieceEquipped(!!piece?.shipId);
        setPendingDeleteId(id);
        setShowDeleteConfirm(true);
    };

    const deleteGearPiece = async (id: string) => {
        const newInventory = inventory.filter((piece) => piece.id !== id);
        await saveInventory(newInventory);
        addNotification('success', 'Gear piece removed successfully');
        setPendingDeleteId(null);
        setShowDeleteConfirm(false);
    };

    const handleEditPiece = (piece: GearPiece) => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setEditingPiece(piece);
        setIsFormVisible(true);
    };

    const handleSavePiece = async (piece: GearPiece) => {
        let newInventory;
        if (editingPiece) {
            // Update existing piece
            newInventory = inventory.map((p) => (p.id === piece.id ? piece : p));
        } else {
            // Add new piece
            newInventory = [...inventory, piece];
        }

        await saveInventory(newInventory);
        setEditingPiece(undefined);
        setIsFormVisible(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        addNotification('success', 'Gear piece saved successfully');
    };

    if (loading) {
        return <Loader />;
    }

    return (
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
            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700">
                    {error}
                </div>
            )}

            <CollapsibleForm isVisible={isFormVisible || !!editingPiece}>
                <GearPieceForm onSubmit={handleSavePiece} editingPiece={editingPiece} />
            </CollapsibleForm>

            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            {activeTab === 'inventory' ? (
                <>
                    <GearInventory
                        inventory={inventory}
                        onRemove={handleRemovePiece}
                        onEdit={handleEditPiece}
                    />
                </>
            ) : (
                <GearUpgradeAnalysis inventory={inventory} shipRoles={Object.keys(SHIP_TYPES)} />
            )}

            <ConfirmModal
                isOpen={showDeleteConfirm}
                onClose={() => {
                    setShowDeleteConfirm(false);
                    setPendingDeleteId(null);
                }}
                onConfirm={() => pendingDeleteId && deleteGearPiece(pendingDeleteId)}
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
    );
};

export default GearPage;
