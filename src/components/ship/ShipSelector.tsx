import React from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../hooks/useShips';
import { Select } from '../ui/Select';

interface ShipSelectorProps {
    selected: Ship | null;
    onSelect: (ship: Ship) => void;
}

export const ShipSelector: React.FC<ShipSelectorProps> = ({
    selected,
    onSelect,
}) => {
    const { ships } = useShips();

    return (
        <Select
            value={selected?.id || ''}
            onChange={(e) => {
                const ship = ships.find(s => s.id === e.target.value);
                if (ship) onSelect(ship);
            }}
            options={ships.map(ship => ({
                value: ship.id,
                label: `${ship.name}`
            }))}
            className="w-full"
            noDefaultSelection={true}
            defaultOption="Select a ship"
        />
    );
};