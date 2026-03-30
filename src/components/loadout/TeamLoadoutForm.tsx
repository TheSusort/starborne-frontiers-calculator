import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { Button, Input } from '../ui';
import { ShipSelector } from '../ship/ShipSelector';
import { GearSlotName } from '../../constants';
import { TeamLoadout } from '../../types/loadout';

interface TeamLoadoutFormProps {
    onSubmit: (loadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => void;
    existingNames: string[];
    initialValues?: {
        name: string;
        ships: (Ship | null)[];
    };
    onCancel?: () => void;
}

export const TeamLoadoutForm: React.FC<TeamLoadoutFormProps> = ({
    onSubmit,
    existingNames,
    initialValues,
    onCancel,
}) => {
    const [name, setName] = useState(initialValues?.name || '');
    const [selectedShips, setSelectedShips] = useState<(Ship | null)[]>(
        initialValues?.ships || [null, null, null, null, null]
    );
    const [error, setError] = useState<string | null>(null);

    const isEditing = !!initialValues;

    const handleShipSelect = (ship: Ship, position: number) => {
        const newSelectedShips = [...selectedShips];
        newSelectedShips[position] = ship;
        setSelectedShips(newSelectedShips);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (selectedShips.some((ship) => !ship)) return;

        const trimmedName = name.trim();
        const nameChanged = initialValues ? trimmedName !== initialValues.name : true;

        if (nameChanged && existingNames.includes(trimmedName)) {
            setError('A team loadout with this name already exists');
            return;
        }

        const shipLoadouts = selectedShips.map((ship, index) => ({
            position: index + 1,
            shipId: ship!.id,
            equipment: ship!.equipment as Record<GearSlotName, string>,
        }));

        onSubmit({
            name: trimmedName,
            shipLoadouts,
        });

        // Clear form
        setName('');
        setSelectedShips([null, null, null, null, null]);
        setError(null);
    };

    return (
        <form onSubmit={handleSubmit} className="card space-y-4">
            <div>
                <Input
                    label="Team Loadout Name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    error={error || undefined}
                />
            </div>

            {selectedShips.map((ship, index) => (
                <div key={index}>
                    <ShipSelector
                        selected={ship}
                        onSelect={(ship) => handleShipSelect(ship, index)}
                    />
                </div>
            ))}

            <div className="flex justify-end gap-2">
                {onCancel && (
                    <Button
                        aria-label="Cancel"
                        type="button"
                        variant="secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </Button>
                )}
                <Button
                    aria-label={isEditing ? 'Save team loadout' : 'Create team loadout'}
                    type="submit"
                    disabled={selectedShips.some((ship) => !ship) || !name}
                >
                    {isEditing ? 'Save Team Loadout' : 'Create Team Loadout'}
                </Button>
            </div>
        </form>
    );
};
