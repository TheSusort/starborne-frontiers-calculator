import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { Button, Select } from '../ui';
import { Ship } from '../../types/ship';
import { SHIP_TYPES, ShipTypeName } from '../../constants';

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
    onRunSimulation,
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

            <div className="p-4 bg-dark space-y-2">
                <Select
                    label="Ship Role"
                    options={Object.values(SHIP_TYPES).map((type) => ({
                        value: type.name,
                        label: `${type.name} (${type.description})`,
                    }))}
                    value={selectedRole}
                    onChange={(value) => onRoleSelect(value as ShipTypeName)}
                />
            </div>

            <Button
                aria-label="Run Simulation"
                variant="primary"
                onClick={onRunSimulation}
                disabled={!selectedShip}
                fullWidth
            >
                Run Simulation
            </Button>

            <SimulationInfo />
        </div>
    );
};

const SimulationInfo: React.FC = () => (
    <p className="text-gray-400 text-sm">
        This simulates scenarios with the selected ship and gear.
        <br />
        It will only use 100% damage hits, no ship specific attacks are used.
        <br />
        For defenders, it will take hits from an enemy with 15000 attack and 170 security.
        <br />
        For debuffers, it will also try to hack an enemy with 170 security.
        <br />
        For supporters, it will heal an ally with using 15% of their max HP.
    </p>
);
