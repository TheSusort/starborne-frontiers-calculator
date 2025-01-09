import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../hooks/useShips';
import { Button, Input, Modal } from '../ui';
import { ShipDisplay } from './ShipDisplay';

interface ShipSelectorProps {
    selected: Ship | null;
    onSelect: (ship: Ship) => void;
    variant?: 'compact' | 'full' | 'extended';
    sortDirection?: 'asc' | 'desc';
}

export const ShipSelector: React.FC<ShipSelectorProps> = ({
    selected,
    onSelect,
    variant = 'compact',
    sortDirection = 'asc',
}) => {
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { ships } = useShips();
    const [search, setSearch] = useState('');
    return (
        <div className="space-y-4">
            <Button
                aria-label={selected ? 'Select another Ship' : 'Select a Ship'}
                variant="secondary"
                onClick={() => setIsShipModalOpen(true)}
                fullWidth
            >
                {selected ? 'Select another Ship' : 'Select a Ship'}
            </Button>

            {selected && <ShipDisplay ship={selected} variant={variant} />}

            <Modal
                isOpen={isShipModalOpen}
                onClose={() => setIsShipModalOpen(false)}
                title="Select a Ship"
                fullHeight
            >
                <Input
                    className="mb-4"
                    placeholder="Search ships"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid grid-cols-1 gap-2">
                    {ships.length === 0 && <p>No ships available</p>}
                    {ships
                        .filter((ship) => ship.name.toLowerCase().includes(search.toLowerCase()))
                        .sort((a, b) => {
                            const aLength = Object.keys(a.equipment ?? {}).length;
                            const bLength = Object.keys(b.equipment ?? {}).length;
                            return sortDirection === 'asc' ? aLength - bLength : bLength - aLength;
                        })
                        .map((ship) => (
                            <ShipDisplay
                                key={ship.id}
                                ship={ship}
                                variant="compact"
                                selected={selected?.id === ship.id}
                                onClick={() => {
                                    onSelect(ship);
                                    setIsShipModalOpen(false);
                                }}
                            />
                        ))}
                </div>
            </Modal>
        </div>
    );
};
