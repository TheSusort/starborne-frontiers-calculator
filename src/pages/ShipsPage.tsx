import React, { useState } from 'react';
import { ShipForm } from '../components/ShipForm';
import { ShipInventory } from '../components/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';
import { Button } from '../components/ui/Button';

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
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold text-white">Ship Management</h1>
                <Button
                    variant="primary"
                    onClick={() => {
                        if (editingShip) {
                            setEditingShip(undefined);
                        }
                        setIsFormVisible(!isFormVisible);
                    }}
                >
                    {isFormVisible ? 'Hide Form' : 'Create New Ship'}
                </Button>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            <div className={`transition-all duration-300 ease-in-out ${isFormVisible || editingShip ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <ShipForm 
                    onSubmit={(ship) => {
                        handleSaveShip(ship);
                        if (!editingShip) {
                            setIsFormVisible(false);
                        }
                    }}
                    editingShip={editingShip}
                />
            </div>

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
        </div>
    );
}; 