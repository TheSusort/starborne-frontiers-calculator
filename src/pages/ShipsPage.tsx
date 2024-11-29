import React, { useState } from 'react';
import { ShipForm } from '../components/ShipForm';
import { ShipInventory } from '../components/ShipInventory';
import { useInventory } from '../hooks/useInventory';
import { useShips } from '../hooks/useShips';

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
                <div className="animate-pulse text-xl text-gray-600">
                    Loading ships...
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Ship Management</h1>
                <button
                    onClick={() => {
                        if (editingShip) {
                            setEditingShip(undefined);
                        }
                        setIsFormVisible(!isFormVisible);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                    {isFormVisible ? 'Hide Form' : 'Create New Ship'}
                </button>
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