import React, { useState, useEffect } from 'react';
import { PageLayout, CollapsibleForm } from '../components/ui';
import { GearPieceForm } from '../components/gear/GearPieceForm';
import { GearInventory } from '../components/gear/GearInventory';
import { GearPiece } from '../types/gear';
import { useInventory } from '../hooks/useInventory';
import { useNotification } from '../hooks/useNotification';
import { useShips } from '../hooks/useShips';

export const GearPage: React.FC = () => {
    const { inventory, loading, error, saveInventory } = useInventory();
    const [editingPiece, setEditingPiece] = useState<GearPiece | undefined>();
    const [isFormVisible, setIsFormVisible] = useState(false);
    const { addNotification } = useNotification();
    const { ships } = useShips();

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
        const newInventory = inventory.filter((piece) => piece.id !== id);
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
        return (
            <PageLayout title="Gear Management">
                <div className="flex items-center justify-center">
                    <div className="animate-pulse text-xl text-gray-200">Loading inventory...</div>
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
                },
            }}
        >
            {error && (
                <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 ">
                    {error}
                </div>
            )}

            <CollapsibleForm isVisible={isFormVisible || !!editingPiece}>
                <GearPieceForm onSubmit={handleSavePiece} editingPiece={editingPiece} />
            </CollapsibleForm>

            <GearInventory
                inventory={inventory}
                onRemove={handleRemovePiece}
                onEdit={handleEditPiece}
            />
        </PageLayout>
    );
};
