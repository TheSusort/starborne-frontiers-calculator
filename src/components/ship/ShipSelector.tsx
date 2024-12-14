import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { useShips } from '../../hooks/useShips';
import { Button } from '../ui/Button';
import { ShipDisplay } from './ShipDisplay';
import { Modal } from '../layout/Modal';

interface ShipSelectorProps {
    selected: Ship | null;
    onSelect: (ship: Ship) => void;
}

export const ShipSelector: React.FC<ShipSelectorProps> = ({
    selected,
    onSelect,
}) => {
    const [isShipModalOpen, setIsShipModalOpen] = useState(false);
    const { ships } = useShips();

    return (
        <div className="space-y-4">
            <Button
                variant="secondary"
                onClick={() => setIsShipModalOpen(true)}
                fullWidth
            >
                {selected ? 'Select another Ship' : 'Select a Ship'}
            </Button>

            {selected && (
                <ShipDisplay ship={selected} variant="compact" />
            )}

            <Modal
                isOpen={isShipModalOpen}
                onClose={() => setIsShipModalOpen(false)}
                title="Select a Ship"
            >
                <div className="grid grid-cols-1 gap-2">
                    {ships.map(ship => (
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