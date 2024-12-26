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
}

export const LoadoutForm: React.FC<LoadoutFormProps> = ({ onSubmit, existingNames }) => {
    const [name, setName] = useState('');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!selectedShip) return;

        if (existingNames.includes(name.trim())) {
            setError('A loadout with this name already exists');
            return;
        }

        onSubmit({
            name: name.trim(),
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
        <form onSubmit={handleSubmit} className="space-y-4 bg-dark p-4">
            <div>
                <label className="block text-sm font-medium text-gray-200">
                    Loadout Name
                </label>
                <Input
                    type="text"
                    value={name}
                    onChange={handleNameChange}
                    required
                    error={error || undefined}
                />
                {error && (
                    <p className="mt-1 text-sm text-red-500">
                        {error}
                    </p>
                )}
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-200">
                    Select Ship
                </label>
                <ShipSelector
                    onSelect={setSelectedShip}
                    selected={selectedShip}
                />
            </div>

            <div className="flex justify-end gap-2">
                <Button
                    aria-label="Create loadout"
                    type="submit"
                    disabled={!selectedShip || !name.trim()}
                >
                    Create Loadout
                </Button>
            </div>
        </form>
    );
};