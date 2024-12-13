import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { Button } from '../ui/Button';
import { ShipSelector } from '../ship/ShipSelector';
import { GearSlotName } from '../../constants';

interface LoadoutFormProps {
    onSubmit: (loadout: {
        name: string;
        shipId: string;
        equipment: Record<GearSlotName, string>;
    }) => void;
    onCancel: () => void;
}

export const LoadoutForm: React.FC<LoadoutFormProps> = ({ onSubmit, onCancel }) => {
    const [name, setName] = useState('');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedShip) return;

        onSubmit({
            name,
            shipId: selectedShip.id,
            equipment: {},
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-200">
                    Loadout Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full rounded-md bg-dark border-gray-600"
                    required
                />
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
                <Button variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!selectedShip || !name}>
                    Create Loadout
                </Button>
            </div>
        </form>
    );
};