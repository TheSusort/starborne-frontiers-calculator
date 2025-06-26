import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { Button, GearIcon } from '../ui';
import { Ship } from '../../types/ship';

interface AutogearQuickSettingsProps {
    selectedShip: Ship | null;
    onShipSelect: (ship: Ship) => void;
    onOpenSettings: () => void;
    onFindOptimalGear: () => void;
}

export const AutogearQuickSettings: React.FC<AutogearQuickSettingsProps> = ({
    selectedShip,
    onShipSelect,
    onOpenSettings,
    onFindOptimalGear,
}) => {
    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Autogear</h3>
            </div>

            <ShipSelector onSelect={onShipSelect} selected={selectedShip}>
                <Button
                    variant="secondary"
                    onClick={onOpenSettings}
                    className="text-sm flex items-center gap-2"
                >
                    <GearIcon />
                    Configure
                </Button>
            </ShipSelector>

            <div className="flex justify-end">
                <Button
                    onClick={onFindOptimalGear}
                    disabled={!selectedShip}
                    variant="primary"
                    className="w-full"
                >
                    Find Optimal Gear
                </Button>
            </div>
        </div>
    );
};
