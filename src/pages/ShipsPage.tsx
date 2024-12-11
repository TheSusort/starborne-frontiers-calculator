import React, { useState } from 'react';
import { ShipForm } from '../components/ship/ShipForm';
import { ShipInventory } from '../components/ship/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';
import { PageLayout } from '../components/layout/PageLayout';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';

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

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <div className="animate-pulse text-xl text-white">
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
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 ">
                    {error}
                </div>
            )}

            <CollapsibleForm isVisible={isFormVisible || !!editingShip}>
                <ShipForm
                    onSubmit={(ship) => {
                        handleSaveShip(ship);
                        if (!editingShip) {
                            setIsFormVisible(false);
                        }
                    }}
                    editingShip={editingShip}
                />
            </CollapsibleForm>

            <ShipInventory
                ships={ships}
                onRemove={handleRemoveShip}
                onEdit={(ship) => {
                    setEditingShip(ship);
                    setIsFormVisible(true);
                }}
                onEquipGear={handleEquipGear}
                onRemoveGear={handleRemoveGear}
                availableGear={inventory}
            />
        </PageLayout>
    );
};