import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { calculateTotalStats } from '../utils/statsCalculator';
import { useInventory } from '../hooks/useInventory';
import { PageLayout } from '../components/ui';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { runSimulation, SimulationSummary } from '../utils/simulationCalculator';
import { ShipTypeName } from '../constants';
import { SimulationResults } from '../components/simulation/SimulationResults';
import { SimulationSettings } from '../components/simulation/SimulationSettings';

export const SimulationPage: React.FC = () => {
    const { getShipById } = useShips();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedRole, setSelectedRole] = useState<ShipTypeName>('Attacker');
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [simulation, setSimulation] = useState<SimulationSummary | null>(null);

    const selectedShip = getShipById(selectedShipId);

    const handleRunSimulation = () => {
        const ship = getShipById(selectedShipId);
        if (!ship) return;

        const stats = calculateTotalStats(
            ship.baseStats,
            ship.equipment,
            getGearPiece,
            ship.refits,
            ship.implants,
            getEngineeringStatsForShipType(ship.type)
        );

        const simulationResults = runSimulation(stats, selectedRole);
        setSimulation(simulationResults);
    };

    const handleRoleChange = (role: ShipTypeName) => {
        setSelectedRole(role);
        setSimulation(null);
    };

    return (
        <PageLayout
            title="Simulation"
            description="Simulate simplified attacks, hacks, heals, and defence with your ships and gear."
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SimulationSettings
                    selectedShip={selectedShip || null}
                    selectedRole={selectedRole}
                    onShipSelect={(ship) => setSelectedShipId(ship.id)}
                    onRoleSelect={handleRoleChange}
                    onRunSimulation={handleRunSimulation}
                />

                {simulation && (
                    <SimulationResults currentSimulation={simulation} role={selectedRole} />
                )}
            </div>
        </PageLayout>
    );
};
