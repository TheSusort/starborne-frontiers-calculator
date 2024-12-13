import React from 'react';
import { Loadout } from '../../types/loadout';
import { LoadoutCard } from './LoadoutCard';
import { useShips } from '../../hooks/useShips';
import { GearPiece } from '../../types/gear';

interface LoadoutListProps {
    loadouts: Loadout[];
    onUpdate: (id: string, equipment: Record<string, string>) => void;
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
    const { ships } = useShips();

    if (loadouts.length === 0) {
        return (
            <div className="text-center text-gray-400 py-8">
                No loadouts created yet. Create one by clicking the "New Loadout" button above.
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loadouts.map((loadout) => {
                const ship = ships.find(s => s.id === loadout.shipId);
                if (!ship) return null;

                return (
                    <LoadoutCard
                        key={loadout.id}
                        loadout={loadout}
                        ship={ship}
                        availableGear={availableGear}
                        getGearPiece={getGearPiece}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                    />
                );
            })}
        </div>
    );
};