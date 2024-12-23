import React from 'react';
import { Loadout } from '../../types/loadout';
import { LoadoutCard } from './LoadoutCard';
import { useShips } from '../../hooks/useShips';
import { GearPiece } from '../../types/gear';
import { GearSlotName } from '../../constants';

interface LoadoutListProps {
    loadouts: Loadout[];
    onUpdate: (id: string, equipment: Record<GearSlotName, string>) => void;
    onDelete: (id: string) => void;
    getGearPiece: (gearId: string) => GearPiece | undefined;
    availableGear: GearPiece[];
}

export const LoadoutList: React.FC<LoadoutListProps> = ({
    loadouts,
    onUpdate,
    onDelete,
    getGearPiece,
    availableGear
}) => {
    const { handleEquipGear, ships } = useShips();

    if (loadouts.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                No loadouts created yet. Create one by clicking the "New Loadout" button above.
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loadouts.map((loadout) => {
                const ship = ships.find(s => s.id === loadout.shipId);
                if (!ship) return null;

                return (
                    <div className="flex flex-col">
                        <LoadoutCard
                            key={loadout.id}
                            name={loadout.name}
                            ship={ship}
                            equipment={loadout.equipment}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onEquip={() => {
                                Object.entries(loadout.equipment).forEach(([slot, gearId]) => {
                                    handleEquipGear(loadout.shipId, slot as GearSlotName, gearId);
                                });
                            }}
                            onUpdate={(equipment) => onUpdate(loadout.id, equipment)}
                            onDelete={() => onDelete(loadout.id)}
                        />
                    </div>
                );
            })}
        </div>
    );
};