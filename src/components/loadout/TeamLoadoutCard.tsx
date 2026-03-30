import React from 'react';
import { TeamLoadout } from '../../types/loadout';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { Button, CloseIcon, EditIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { GearSlotName } from '../../constants';
import { useNotification } from '../../hooks/useNotification';
import { LoadoutCard } from './LoadoutCard';

interface TeamLoadoutCardProps {
    teamLoadout: TeamLoadout;
    ships: Ship[];
    availableGear: GearPiece[];
    getGearPiece: (id: string) => GearPiece | undefined;
    onUpdate: (id: string, shipLoadouts: TeamLoadout['shipLoadouts']) => void;
    onEdit: (teamLoadout: TeamLoadout) => void;
    onDelete: (id: string) => void;
}

export const TeamLoadoutCard: React.FC<TeamLoadoutCardProps> = ({
    teamLoadout,
    ships,
    availableGear,
    getGearPiece,
    onUpdate,
    onEdit,
    onDelete,
}) => {
    const { equipMultipleGear } = useShips();
    const { addNotification } = useNotification();

    const handleEquipTeam = async () => {
        for (const shipLoadout of teamLoadout.shipLoadouts) {
            const gearAssignments = Object.entries(shipLoadout.equipment)
                .filter(([, gearId]) => {
                    const gear = getGearPiece(gearId);
                    if (!gear) {
                        addNotification('error', `Gear piece ${gearId} not found in inventory`);
                        return false;
                    }
                    return true;
                })
                .map(([slot, gearId]) => ({ slot: slot, gearId }));

            await equipMultipleGear(shipLoadout.shipId, gearAssignments);
        }

        addNotification('success', 'Team loadout equipped successfully');
    };

    const handleUpdateShipLoadout = (position: number, equipment: Record<GearSlotName, string>) => {
        const newShipLoadouts = teamLoadout.shipLoadouts.map((loadout) =>
            loadout.position === position ? { ...loadout, equipment } : loadout
        );

        try {
            onUpdate(teamLoadout.id, newShipLoadouts);
        } catch (error) {
            alert(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    return (
        <div className="card">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium ">{teamLoadout.name}</h3>
                <div className="flex gap-2 items-center">
                    <Button
                        aria-label="Edit team loadout"
                        title="Edit team loadout"
                        variant="secondary"
                        size="sm"
                        onClick={() => onEdit(teamLoadout)}
                    >
                        <EditIcon />
                    </Button>
                    <Button
                        aria-label="Equip team loadout"
                        title="Equip team loadout"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleEquipTeam()}
                    >
                        Equip Team
                    </Button>
                    <Button
                        aria-label="Delete team loadout"
                        title="Delete team loadout"
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(teamLoadout.id)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teamLoadout.shipLoadouts.map((shipLoadout) => {
                    const ship = ships.find((s) => s.id === shipLoadout.shipId);
                    if (!ship) return null;

                    return (
                        <LoadoutCard
                            key={shipLoadout.position}
                            ship={ship}
                            equipment={shipLoadout.equipment}
                            availableGear={availableGear}
                            getGearPiece={getGearPiece}
                            onUpdate={(equipment) =>
                                handleUpdateShipLoadout(shipLoadout.position, equipment)
                            }
                            showControls={false}
                        />
                    );
                })}
            </div>
        </div>
    );
};
