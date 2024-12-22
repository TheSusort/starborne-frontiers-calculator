import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { Button, Input } from '../ui';
import { ShipSelector } from '../ship/ShipSelector';
import { GearSlotName } from '../../constants';
import { TeamLoadout } from '../../types/loadout';

interface TeamLoadoutFormProps {
    onSubmit: (loadout: Omit<TeamLoadout, 'id' | 'createdAt'>) => void;
}

export const TeamLoadoutForm: React.FC<TeamLoadoutFormProps> = ({ onSubmit }) => {
    const [name, setName] = useState('');
    const [selectedShips, setSelectedShips] = useState<(Ship | null)[]>([null, null, null, null, null]);

    const handleShipSelect = (ship: Ship, position: number) => {
        const newSelectedShips = [...selectedShips];
        newSelectedShips[position] = ship;
        setSelectedShips(newSelectedShips);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedShips.some(ship => !ship)) return;

        const shipLoadouts = selectedShips.map((ship, index) => ({
            position: index + 1,
            shipId: ship!.id,
            equipment: ship!.equipment as Record<GearSlotName, string>,
        }));

        onSubmit({
            name,
            shipLoadouts,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 bg-dark p-4">
            <div>
                <label className="block text-sm font-medium text-gray-200">
                    Team Loadout Name
                </label>
                <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>

            {selectedShips.map((ship, index) => (
                <div key={index}>
                    <label className="block text-sm font-medium text-gray-200">
                        Position {index + 1}
                    </label>
                    <ShipSelector
                        selected={ship}
                        onSelect={(ship) => handleShipSelect(ship, index)}
                    />
                </div>
            ))}

            <div className="flex justify-end gap-2">
                <Button 
                    type="submit" 
                    disabled={selectedShips.some(ship => !ship) || !name}
                >
                    Create Team Loadout
                </Button>
            </div>
        </form>
    );
}; 