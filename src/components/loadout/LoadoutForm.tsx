import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { Button } from '../ui/Button';
import { ShipSelector } from '../ship/ShipSelector';
import { GearSlotName } from '../../constants';
import { Input } from '../ui/Input';

interface LoadoutFormProps {
    onSubmit: (loadout: {
        name: string;
        shipId: string;
        equipment: Record<GearSlotName, string>;
    }) => void;
}

export const LoadoutForm: React.FC<LoadoutFormProps> = ({ onSubmit }) => {
    const [name, setName] = useState('');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedShip) return;

        onSubmit({
            name,
            shipId: selectedShip.id,
            equipment: selectedShip.equipment as Record<GearSlotName, string>,
        });
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
                    onChange={(e) => setName(e.target.value)}
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
                <Button type="submit" disabled={!selectedShip || !name}>
                    Create Loadout
                </Button>
            </div>
        </form>
    );
};