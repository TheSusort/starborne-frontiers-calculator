import React from 'react';
import { Loadout } from '../../types/loadout';
import { useShips } from '../../contexts/ShipsContext';
import { GearPiece } from '../../types/gear';
import { GearSlotName } from '../../constants';
import { LoadoutCard } from './LoadoutCard';

interface LoadoutListProps {
    loadouts: Loadout[];
    onEdit: (loadout: Loadout) => void;
    onUpdate: (id: string, equipment: Record<GearSlotName, string>) => void;
    onDelete: (id: string) => void;
    getGearPiece: (gearId: string) => GearPiece | undefined;
    availableGear: GearPiece[];
}

export const LoadoutList: React.FC<LoadoutListProps> = ({
    loadouts,
    onEdit,
    onUpdate,
    onDelete,
    getGearPiece,
    availableGear,
}) => {
    const { ships } = useShips();

    if (loadouts.length === 0) {
        return (
            <div className="text-center py-8 text-theme-text-secondary bg-dark-lighter border-2 border-dashed">
                No loadouts created yet. Create one by clicking the &quot;New Loadout&quot; button
                above.
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loadouts.map((loadout) => {
                const ship = ships.find((s) => s.id === loadout.shipId);
                if (!ship) return null;

                return (
                    <div className="flex flex-col" key={loadout.id}>
                        <LoadoutCard
                            name={loadout.name}
                            ship={ship}
                            equipment={loadout.equipment}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onEquip={() => {}}
                            onUpdate={(equipment) => onUpdate(loadout.id, equipment)}
                            onEdit={() => onEdit(loadout)}
                            onDelete={() => onDelete(loadout.id)}
                        />
                    </div>
                );
            })}
        </div>
    );
};
