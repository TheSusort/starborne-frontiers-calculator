import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { Button, Input } from '../ui';
import { ShipSelector } from '../ship/ShipSelector';
import { GearSlotName } from '../../constants';

interface LoadoutFormProps {
    onSubmit: (loadout: {
        name: string;
        shipId: string;
        equipment: Record<GearSlotName, string>;
    }) => void;
    existingNames: string[];
    initialValues?: {
        name: string;
        ship: Ship;
    };
    onCancel?: () => void;
}

export const LoadoutForm: React.FC<LoadoutFormProps> = ({
    onSubmit,
    existingNames,
    initialValues,
    onCancel,
}) => {
    const [name, setName] = useState(initialValues?.name || '');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(initialValues?.ship || null);
    const [error, setError] = useState<string | null>(null);

    const isEditing = !!initialValues;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!selectedShip) return;

        const trimmedName = name.trim();
        const nameChanged = initialValues ? trimmedName !== initialValues.name : true;

        if (nameChanged && existingNames.includes(trimmedName)) {
            setError('A loadout with this name already exists');
            return;
        }

        onSubmit({
            name: trimmedName,
            shipId: selectedShip.id,
            equipment: selectedShip.equipment as Record<GearSlotName, string>,
        });

        setName('');
        setSelectedShip(null);
        setError(null);
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setName(e.target.value);
        setError(null);
    };

    return (
        <form onSubmit={handleSubmit} className="card space-y-4">
            <div>
                <Input
                    label="Loadout Name"
                    type="text"
                    value={name}
                    onChange={handleNameChange}
                    required
                    error={error || undefined}
                />
            </div>

            <div>
                <label className="block text-sm font-medium ">Select Ship</label>
                <ShipSelector onSelect={setSelectedShip} selected={selectedShip} />
            </div>

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
                    aria-label={isEditing ? 'Save loadout' : 'Create loadout'}
                    type="submit"
                    disabled={!selectedShip || !name.trim()}
                >
                    {isEditing ? 'Save Loadout' : 'Create Loadout'}
                </Button>
            </div>
        </form>
    );
};
