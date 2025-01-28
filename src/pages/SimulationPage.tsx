import React, { useState, useEffect } from 'react';
import { useShips } from '../hooks/useShips';
import { calculateTotalStats } from '../utils/ship/statsCalculator';
import { useInventory } from '../hooks/useInventory';
import { PageLayout } from '../components/ui';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { runSimulation, SimulationSummary } from '../utils/simulation/simulationCalculator';
import { SHIP_TYPES, ShipTypeName } from '../constants';
import { SimulationResults } from '../components/simulation/SimulationResults';
import { SimulationSettings } from '../components/simulation/SimulationSettings';
import { useSearchParams } from 'react-router-dom';
import { GearTesting } from '../components/simulation/GearTesting';
import { Modal } from '../components/ui/layout/Modal';
import { GearInventory } from '../components/gear/GearInventory';
import { useNotification } from '../hooks/useNotification';
import { GEAR_SLOTS, GearSlotName } from '../constants';
import { GearPiece } from '../types/gear';

interface SimulationState {
    current: SimulationSummary;
    temporary: SimulationSummary | null;
}

export const SimulationPage: React.FC = () => {
    const { getShipById } = useShips();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedRole, setSelectedRole] = useState<ShipTypeName>('Attacker');
    const { getGearPiece, inventory, saveInventory } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [simulation, setSimulation] = useState<SimulationState | null>(null);
    const [searchParams] = useSearchParams();
    const [temporaryGear, setTemporaryGear] = useState<Partial<Record<GearSlotName, string>>>({});
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { addNotification } = useNotification();
    const { ships, handleEquipMultipleGear } = useShips({ getGearPiece });

    useEffect(() => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                setSelectedShipId(shipId);
                setSelectedRole(SHIP_TYPES[ship.type].name);
            }
        }
    }, [searchParams, getShipById]);

    const handleRunSimulation = () => {
        if (!selectedShip) return;

        const currentStats = calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );

        const temporaryStats = calculateTotalStats(
            selectedShip.baseStats,
            temporaryGear,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );

        setSimulation({
            current: runSimulation(currentStats.final, selectedRole),
            temporary: hasGearChanges() ? runSimulation(temporaryStats.final, selectedRole) : null,
        });
    };

    const hasGearChanges = () => {
        if (!selectedShip) return false;
        return JSON.stringify(temporaryGear) !== JSON.stringify(selectedShip.equipment);
    };

    const handleSaveGearChanges = () => {
        if (!selectedShip) return;

        const gearAssignments = Object.entries(temporaryGear).map(([slot, gearId]) => ({
            slot: slot as GearSlotName,
            gearId: gearId || '',
        }));

        handleEquipMultipleGear(selectedShip.id, gearAssignments);
        addNotification('success', 'Gear changes saved successfully');
    };

    const handleResetGearChanges = () => {
        if (selectedShip) {
            setTemporaryGear(selectedShip.equipment);
            setSimulation(null);
        }
    };

    const handleRoleChange = (role: ShipTypeName) => {
        setSelectedRole(role);
        setSimulation(null);
    };

    const selectedShip = getShipById(selectedShipId);

    useEffect(() => {
        if (selectedShip) {
            setTemporaryGear(selectedShip.equipment);
        }
    }, [selectedShip]);

    return (
        <PageLayout
            title="Simulation"
            description="Simulate simplified attacks, hacks, heals, and defence with your ships and gear."
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                    <SimulationSettings
                        selectedShip={selectedShip || null}
                        selectedRole={selectedRole}
                        onShipSelect={(ship) => setSelectedShipId(ship.id)}
                        onRoleSelect={handleRoleChange}
                        onRunSimulation={handleRunSimulation}
                    />
                </div>
                <div className="space-y-4">
                    {selectedShip && (
                        <GearTesting
                            ship={selectedShip}
                            temporaryGear={temporaryGear}
                            getGearPiece={getGearPiece}
                            hoveredGear={hoveredGear}
                            onGearHover={setHoveredGear}
                            onSelectSlot={setSelectedSlot}
                            onRemoveGear={(slot) => {
                                setTemporaryGear((prev) => {
                                    const next = { ...prev };
                                    delete next[slot];
                                    return next;
                                });
                            }}
                            onSaveChanges={handleSaveGearChanges}
                            onResetChanges={handleResetGearChanges}
                            hasChanges={hasGearChanges()}
                        />
                    )}
                </div>
            </div>
            <div className="space-y-4">
                {simulation && (
                    <SimulationResults
                        currentSimulation={simulation.current}
                        suggestedSimulation={simulation.temporary || undefined}
                        role={selectedRole}
                    />
                )}
            </div>

            <Modal
                isOpen={selectedSlot !== null}
                onClose={() => setSelectedSlot(null)}
                title={`Select ${selectedSlot} for ${selectedShip?.name}`}
            >
                <GearInventory
                    inventory={inventory.filter(
                        (gear) => selectedSlot && gear.slot === selectedSlot
                    )}
                    mode="select"
                    onEquip={(gear) => {
                        if (selectedSlot) {
                            setTemporaryGear((prev) => ({
                                ...prev,
                                [selectedSlot]: gear.id,
                            }));
                            setSelectedSlot(null);
                        }
                    }}
                    onRemove={() => {}}
                    onEdit={() => {}}
                />
            </Modal>
        </PageLayout>
    );
};

export default SimulationPage;
