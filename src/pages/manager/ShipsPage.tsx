import React, { useState } from 'react';
import { ShipForm } from '../../components/ship/ShipForm';
import { ShipInventory } from '../../components/ship/ShipInventory';
import { useInventory } from '../../contexts/InventoryProvider';
import { useShips } from '../../contexts/ShipsContext';
import { PageLayout, CollapsibleForm, ConfirmModal } from '../../components/ui';
import { useNotification } from '../../hooks/useNotification';
import { Ship } from '../../types/ship';
import { Loader } from '../../components/ui/Loader';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

export const ShipsPage: React.FC = () => {
    const { inventory } = useInventory();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [pendingDeleteShip, setPendingDeleteShip] = useState<Ship | null>(null);
    const { addNotification } = useNotification();

    const {
        ships,
        loading,
        editingShip,
        setEditingShip,
        addShip,
        updateShip,
        deleteShip,
        equipGear,
        removeGear,
        toggleEquipmentLock,
        unequipAllEquipment,
    } = useShips();

    const handleShipDelete = async (id: string) => {
        setPendingDeleteShip(ships.find((s) => s.id === id) || null);
        setShowDeleteConfirm(true);
    };

    const confirmShipDelete = async () => {
        if (!pendingDeleteShip) return;

        try {
            // Unequip all gear before deleting
            await unequipAllEquipment(pendingDeleteShip.id);
            await deleteShip(pendingDeleteShip.id);
            addNotification('success', 'Ship removed successfully');
            setPendingDeleteShip(null);
            setShowDeleteConfirm(false);
        } catch (error) {
            console.error('Error deleting ship:', error);
            addNotification('error', 'Failed to remove ship');
        }
    };

    const handleSaveShip = async (ship: Ship) => {
        try {
            if (ship.id) {
                await updateShip(ship.id, ship);
            } else {
                await addShip(ship);
            }
            setIsFormVisible(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setEditingShip(undefined);
            addNotification('success', 'Ship saved successfully');
        } catch (error) {
            console.error('Error saving ship:', error);
            addNotification('error', 'Failed to save ship');
        }
    };

    const handleLockEquipment = async (ship: Ship) => {
        try {
            await toggleEquipmentLock(ship.id);
            addNotification('success', `Equipment lock state updated`);
        } catch (error) {
            console.error('Error toggling equipment lock:', error);
            addNotification('error', 'Failed to toggle equipment lock');
        }
    };

    const handleUnequipAll = async (shipId: string) => {
        try {
            await unequipAllEquipment(shipId);
            addNotification('success', 'All gear unequipped successfully');
        } catch (error) {
            console.error('Error unequipping all gear:', error);
            addNotification('error', 'Failed to unequip all gear');
        }
    };

    if (loading) {
        return <Loader />;
    }

    return (
        <>
            <Seo {...SEO_CONFIG.ships} />
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
                helpLink="/documentation#ships"
            >
                <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                    <ShipForm onSubmit={handleSaveShip} editingShip={editingShip} />
                </CollapsibleForm>

                <ShipInventory
                    ships={ships}
                    onRemove={handleShipDelete}
                    onEdit={(ship) => {
                        setEditingShip(ship);
                        setIsFormVisible(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onLockEquipment={handleLockEquipment}
                    onEquipGear={equipGear}
                    onRemoveGear={removeGear}
                    onUnequipAll={handleUnequipAll}
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
        </>
    );
};

export default ShipsPage;
