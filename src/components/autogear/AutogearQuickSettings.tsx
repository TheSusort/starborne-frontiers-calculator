import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { Button, Select } from '../ui';
import { Ship } from '../../types/ship';
import { ShipTypeName, SHIP_TYPES } from '../../constants';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { CloseIcon, GearIcon } from '../ui/icons';

interface AutogearQuickSettingsProps {
    selectedShips: (Ship | null)[];
    onShipSelect: (ship: Ship, index: number) => void;
    onAddShip: () => void;
    onRemoveShip: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
    onOpenSettings: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
    onFindOptimalGear: () => void;
}

export const AutogearQuickSettings: React.FC<AutogearQuickSettingsProps> = ({
    selectedShips,
    onShipSelect,
    onAddShip,
    onRemoveShip,
    onOpenSettings,
    onFindOptimalGear,
}) => {
    return (
        <div>
            <div className="space-y-4 sticky top-2">
                <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">Autogear</h3>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onAddShip} className="text-sm">
                            Add Ship
                        </Button>
                    </div>
                </div>

                <div className="space-y-3">
                    {selectedShips.map((ship, index) => (
                        <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1">
                                <ShipSelector
                                    selected={ship || null}
                                    onSelect={(selectedShip) => onShipSelect(selectedShip, index)}
                                >
                                    <div className="flex gap-2 items-center">
                                        <Button
                                            variant="secondary"
                                            onClick={(event) => onOpenSettings(event, index)}
                                            size="sm"
                                            className="flex gap-2 items-center"
                                        >
                                            <GearIcon />
                                            Configure Settings
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={(event) => onRemoveShip(event, index)}
                                        >
                                            <CloseIcon className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </ShipSelector>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end">
                    <Button
                        onClick={onFindOptimalGear}
                        disabled={selectedShips.length === 0}
                        variant="primary"
                        className="w-full"
                    >
                        Find Optimal Gear
                    </Button>
                </div>
            </div>
        </div>
    );
};
