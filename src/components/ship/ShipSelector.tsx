import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { Button, Input, Modal } from '../ui';
import { ShipDisplay } from './ShipDisplay';
import { RARITY_ORDER } from '../../constants';

interface ShipSelectorProps {
    selected: Ship | null;
    onSelect: (ship: Ship) => void;
    variant?: 'compact' | 'full' | 'extended';
    sortDirection?: 'asc' | 'desc';
    children?: React.ReactNode;
}

export const ShipSelector: React.FC<ShipSelectorProps> = ({
    selected,
    onSelect,
    variant = 'compact',
    sortDirection = 'asc',
    children,
}) => {
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { ships } = useShips();
    const [search, setSearch] = useState('');
    return (
        <div className="space-y-4">
            {selected ? (
                <ShipDisplay
                    ship={selected}
                    variant={variant}
                    onClick={() => setIsShipModalOpen(true)}
                >
                    {children}
                </ShipDisplay>
            ) : (
                <Button
                    aria-label="Select a Ship"
                    variant="secondary"
                    onClick={() => setIsShipModalOpen(true)}
                    className="min-h-[70px]"
                    fullWidth
                >
                    {selected ? 'Select another Ship' : 'Select a Ship'}
                </Button>
            )}

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
                    autoFocus
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {ships.length === 0 && <p>No ships available</p>}
                    {ships
                        .filter((ship) => ship.name.toLowerCase().includes(search.toLowerCase()))
                        .sort((a, b) => {
                            // First sort by rarity
                            const rarityComparison =
                                RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                            if (rarityComparison !== 0) return rarityComparison;

                            // If rarities are equal, sort by equipment length
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
