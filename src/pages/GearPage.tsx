import React, { useState } from 'react';
import { GearPieceForm } from '../components/GearPieceForm';
import { GearInventory } from '../components/GearInventory';
import { GearPiece } from '../types/gear';
import { useInventory } from '../hooks/useInventory';

export const GearPage: React.FC = () => {
    const { inventory, loading, error, saveInventory } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);

    const handleRemovePiece = async (id: string) => {
        const newInventory = inventory.filter(piece => piece.id !== id);
        await saveInventory(newInventory);
    };

    const handleEditPiece = (piece: GearPiece) => {
        setEditingPiece(piece);
        setIsFormVisible(true);
    };

    const handleSavePiece = async (piece: GearPiece) => {
        let newInventory;
        if (editingPiece) {
            // Update existing piece
            newInventory = inventory.map(p => 
                p.id === piece.id ? piece : p
            );
        } else {
            // Add new piece
            newInventory = [...inventory, piece];
        }
        
        await saveInventory(newInventory);
        setEditingPiece(undefined); // Clear editing state
        if (!editingPiece) {
            setIsFormVisible(false); // Hide form after creating new piece
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <div className="animate-pulse text-xl text-gray-600">
                    Loading inventory...
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Gear Management</h1>
                <button
                    onClick={() => {
                        if (editingPiece) {
                            setEditingPiece(undefined);
                        }
                        setIsFormVisible(!isFormVisible);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                    {isFormVisible ? 'Hide Form' : 'Create New Gear'}
                </button>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            <div className={`transition-all duration-300 ease-in-out ${isFormVisible || editingPiece ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                <GearPieceForm 
                    onSubmit={handleSavePiece}
                    editingPiece={editingPiece}
                />
            </div>

            <GearInventory 
                inventory={inventory} 
                onRemove={handleRemovePiece}
                onEdit={handleEditPiece}
            />
        </div>
    );
}; 