import React from 'react';
import { Loadout } from '../../types/loadout';
import { useShips } from '../../contexts/ShipsContext';
import { GearPiece } from '../../types/gear';
import { GearSlotName } from '../../constants';
import { Button } from '../ui/Button';
import { GearIcon } from '../ui/icons';
import { LoadoutCard } from './LoadoutCard';

interface LoadoutListProps {
    loadouts: Loadout[];
    onEdit: (loadout: Loadout) => void;
    onUpdate: (id: string, equipment: Record<GearSlotName, string>) => void;
    onDelete: (id: string) => void;
    getGearPiece: (gearId: string) => GearPiece | undefined;
    availableGear: GearPiece[];
    onCreateClick?: () => void;
}

export const LoadoutList: React.FC<LoadoutListProps> = ({
    loadouts,
    onEdit,
    onUpdate,
    onDelete,
    getGearPiece,
    availableGear,
    onCreateClick,
}) => {
    const { ships } = useShips();

    if (loadouts.length === 0) {
        return (
            <div className="card text-center py-12 flex flex-col items-center gap-4">
                <GearIcon className="w-12 h-12 text-theme-text-secondary" />
                <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Save Your Best Setups</h3>
                    <p className="text-theme-text-secondary max-w-md mx-auto">
                        Snapshot a ship&apos;s current gear as a named loadout — swap between builds
                        instantly without re-equipping by hand.
                    </p>
                </div>
                {onCreateClick && (
                    <Button onClick={onCreateClick} variant="primary">
                        New Loadout
                    </Button>
                )}
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
