import React, { useState } from 'react';
import { PageLayout } from '../components/layout/PageLayout';
import { CollapsibleForm } from '../components/layout/CollapsibleForm';
import { GearPieceForm } from '../components/gear/GearPieceForm';
import { GearInventory } from '../components/gear/GearInventory';
import { GearPiece } from '../types/gear';
import { useInventory } from '../hooks/useInventory';
import { useNotification } from '../contexts/NotificationContext';

export const GearPage: React.FC = () => {
    const { inventory, loading, error, saveInventory } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();

    const handleRemovePiece = async (id: string) => {
        const newInventory = inventory.filter(piece => piece.id !== id);
        await saveInventory(newInventory);
        addNotification('success', 'Gear piece removed successfully');
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
        addNotification('success', 'Gear piece saved successfully');
    };

    if (loading) {
        return (
            <PageLayout title="Gear Management">
                <div className="flex items-center justify-center">
                    <div className="animate-pulse text-xl text-gray-200">
                        Loading inventory...
                    </div>
                </div>
            </PageLayout>
        );
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
                }
            }}
        >
            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 ">
                    {error}
                </div>
            )}

            <CollapsibleForm isVisible={isFormVisible || !!editingPiece}>
                <GearPieceForm
                    onSubmit={handleSavePiece}
                    editingPiece={editingPiece}
                />
            </CollapsibleForm>

            <GearInventory
                inventory={inventory}
                onRemove={handleRemovePiece}
                onEdit={handleEditPiece}
            />
        </PageLayout>
    );
};