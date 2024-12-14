import React, { useState } from 'react';
import { ShipForm } from '../components/ship/ShipForm';
import { ShipInventory } from '../components/ship/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';
import { PageLayout } from '../components/layout/PageLayout';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';
import { useNotification } from '../contexts/NotificationContext';
export const ShipsPage: React.FC = () => {
    const { inventory } = useInventory();
    const {
        ships,
        loading,
        error,
        editingShip,
        handleRemoveShip,
        handleEquipGear,
        handleRemoveGear,
        handleSaveShip,
        setEditingShip
    } = useShips();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <div className="animate-pulse text-xl text-gray-200">
                    Loading ships...
                </div>
            </div>
        );
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
                }
            }}
        >
            {error && (
                <>{addNotification('error', error)}</>
            )}

            <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                <ShipForm
                    onSubmit={(ship) => {
                        handleSaveShip(ship);
                        if (!editingShip) {
                            setIsFormVisible(false);
                        }
                        addNotification('success', 'Ship saved successfully');
                    }}
                    editingShip={editingShip}
                />
            </CollapsibleForm>

            <ShipInventory
                ships={ships}
                onRemove={(ship) => {
                    handleRemoveShip(ship);
                    addNotification('success', 'Ship removed successfully');
                }}
                onEdit={(ship) => {
                    setEditingShip(ship);
                    setIsFormVisible(true);
                }}
                onEquipGear={(ship, slot, gear) => {
                    handleEquipGear(ship, slot, gear);
                    addNotification('success', 'Gear equipped successfully');
                }}
                onRemoveGear={(ship, slot) => {
                    handleRemoveGear(ship, slot);
                    addNotification('success', 'Gear removed successfully');
                }}
                availableGear={inventory}
            />
        </PageLayout>
    );
};