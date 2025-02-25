import React, { useState, useCallback } from 'react';
import { ShipForm } from '../components/ship/ShipForm';
import { ShipInventory } from '../components/ship/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';
import { PageLayout, CollapsibleForm, ConfirmModal } from '../components/ui';
import { useNotification } from '../hooks/useNotification';
import { Ship } from '../types/ship';
import { Loader } from '../components/ui/Loader';
export const ShipsPage: React.FC = () => {
    const { inventory } = useInventory();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [pendingDeleteShip, setPendingDeleteShip] = useState<Ship | null>(null);

    const getGearPiece = useCallback(
        (id: string) => {
            return inventory.find((gear) => gear.id === id);
        },
        [inventory]
    );

    const {
        ships,
        loading,
        editingShip,
        handleRemoveShip,
        handleEquipGear,
        handleRemoveGear,
        handleSaveShip,
        setEditingShip,
        handleLockEquipment,
        handleUnequipAllGear,
    } = useShips({ getGearPiece });

    const { addNotification } = useNotification();

    const handleShipDelete = async (id: string) => {
        setPendingDeleteShip(ships.find((s) => s.id === id) || null);
        setShowDeleteConfirm(true);
    };

    const confirmShipDelete = async () => {
        if (!pendingDeleteShip) return;

        // Unequip all gear before deleting
        const gearPromises = Object.entries(pendingDeleteShip.equipment).map(([slot, gearId]) => {
            if (gearId) {
                return handleRemoveGear(pendingDeleteShip.id, slot);
            }
            return Promise.resolve();
        });

        await Promise.all(gearPromises);
        await handleRemoveShip(pendingDeleteShip.id);
        addNotification('success', 'Ship removed successfully');
        setPendingDeleteShip(null);
    };

    if (loading) {
        return <Loader />;
    }

    return (
        <PageLayout
            title="Ship Management"
            description="Manage your ships and their equipment."
            action={{
                label: isFormVisible ? 'Hide Form' : 'Create',
                onClick: () => {
                    if (editingShip) {
                        setEditingShip(undefined);
                    }
                    setIsFormVisible(!isFormVisible);
                },
                variant: isFormVisible ? 'secondary' : 'primary',
            }}
        >
            <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                <ShipForm
                    onSubmit={async (ship) => {
                        await handleSaveShip(ship);
                        setIsFormVisible(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        setEditingShip(undefined);
                        addNotification('success', 'Ship saved successfully');
                    }}
                    editingShip={editingShip}
                />
            </CollapsibleForm>

            <ShipInventory
                ships={ships}
                onRemove={handleShipDelete}
                onEdit={(ship) => {
                    setEditingShip(ship);
                    setIsFormVisible(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onLockEquipment={async (ship) => {
                    const updatedLockState = await handleLockEquipment(ship);
                    addNotification(
                        'success',
                        `Equipment lock state on ${ship.name} set to ${updatedLockState}`
                    );
                }}
                onEquipGear={handleEquipGear}
                onRemoveGear={handleRemoveGear}
                onUnequipAll={handleUnequipAllGear}
                availableGear={inventory}
            />

            <ConfirmModal
                isOpen={showDeleteConfirm}
                onClose={() => {
                    setShowDeleteConfirm(false);
                    setPendingDeleteShip(null);
                }}
                onConfirm={confirmShipDelete}
                title="Delete Ship"
                message={
                    pendingDeleteShip?.equipment &&
                    Object.values(pendingDeleteShip.equipment).some((id) => id)
                        ? `This ship has equipped gear that will be unequipped. Are you sure you want to delete ${pendingDeleteShip.name}?`
                        : `Are you sure you want to delete ${pendingDeleteShip?.name}?`
                }
                confirmLabel="Delete"
                cancelLabel="Cancel"
            />
        </PageLayout>
    );
};

export default ShipsPage;
