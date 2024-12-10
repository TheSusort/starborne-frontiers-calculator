import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { useInventory } from '../../hooks/useInventory';
import { ShipCard } from './ShipCard';
import { GearSlotName } from '../../constants';
interface Props {
    ships: Ship[];
    onRemove: (id: string) => void;
    onEdit: (ship: Ship) => void;
    onEquipGear: (shipId: string, slot: GearSlotName, gearId: string) => void;
    onRemoveGear: (shipId: string, slot: GearSlotName) => void;
    availableGear: GearPiece[];
}

export const ShipInventory: React.FC<Props> = ({ ships, onRemove, onEdit, onEquipGear, onRemoveGear, availableGear }) => {
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getGearPiece } = useInventory();

    return (
        <div className="space-y-6">
            <h3 className="text-xl font-semibold text-gray-200">Ships</h3>

            {ships.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-dark-lighter  border-2 border-dashed">
                    No ships created yet
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {ships.map(ship => (
                        <ShipCard
                            key={ship.id}
                            ship={ship}
                            hoveredGear={hoveredGear}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onEdit={onEdit}
                            onRemove={onRemove}
                            onEquipGear={onEquipGear}
                            onRemoveGear={onRemoveGear}
                            onHoverGear={setHoveredGear}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};