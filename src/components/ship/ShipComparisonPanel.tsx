import React from 'react';
import { Ship } from '../../types/ship';
import { Button, CloseIcon } from '../ui';

interface Props<T extends Ship> {
    ships: T[];
    onRemove: (shipId: string) => void;
    onClearAll: () => void;
    renderShip: (ship: T) => React.ReactNode;
}

export function ShipComparisonPanel<T extends Ship>({
    ships,
    onRemove,
    onClearAll,
    renderShip,
}: Props<T>) {
    if (ships.length === 0) return null;

    return (
        <div className="space-y-3 p-4 bg-dark-lighter border border-dark-border mx-[-16px]">
            <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">
                    Comparing {ships.length} ship{ships.length !== 1 ? 's' : ''}
                </span>
                <Button variant="secondary" size="xs" onClick={onClearAll}>
                    Clear all
                </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {ships.map((ship) => (
                    <div key={ship.id} className="relative">
                        <Button
                            onClick={() => onRemove(ship.id)}
                            className="!absolute -top-3 -right-2 z-10"
                            title="Remove from comparison"
                            variant="danger"
                            size="xs"
                        >
                            <CloseIcon />
                        </Button>
                        {renderShip(ship)}
                    </div>
                ))}
            </div>
        </div>
    );
}
