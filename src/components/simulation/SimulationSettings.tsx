import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { RoleSelector } from '../ui';
import { Ship } from '../../types/ship';
import { ShipTypeName } from '../../constants';

interface SimulationSettingsProps {
    selectedShip: Ship | null;
    selectedRole: ShipTypeName;
    onShipSelect: (ship: Ship) => void;
    onRoleSelect: (role: ShipTypeName) => void;
    onRunSimulation: () => void;
}

export const SimulationSettings: React.FC<SimulationSettingsProps> = ({
    selectedShip,
    selectedRole,
    onShipSelect,
    onRoleSelect,
}) => {
    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold ">Settings</h3>
            <ShipSelector
                onSelect={onShipSelect}
                selected={selectedShip}
                variant="compact"
                sortDirection="desc"
            />

            <div className="card space-y-2">
                <RoleSelector
                    label="Ship Role"
                    value={selectedRole}
                    onChange={onRoleSelect}
                    noDefaultSelection={false}
                />
            </div>
        </div>
    );
};
