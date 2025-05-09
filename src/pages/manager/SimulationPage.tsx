import React, { useState, useEffect } from 'react';
import { useShips } from '../../contexts/ShipsContext';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { useInventory } from '../../contexts/InventoryProvider';
import { Button, PageLayout } from '../../components/ui';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { runSimulation, SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { SHIP_TYPES, ShipTypeName } from '../../constants';
import { SimulationResults } from '../../components/simulation/SimulationResults';
import { SimulationSettings } from '../../components/simulation/SimulationSettings';
import { useSearchParams } from 'react-router-dom';
import { GearTesting } from '../../components/simulation/GearTesting';
import { Modal } from '../../components/ui/layout/Modal';
import { GearInventory } from '../../components/gear/GearInventory';
import { useNotification } from '../../hooks/useNotification';
import { GearSlotName } from '../../constants';
import { GearPiece } from '../../types/gear';
import { ImplantTesting } from '../../components/simulation/ImplantTesting';
import { Implant } from '../../types/ship';
import { useGearLookup, useGearSets } from '../../hooks/useGear';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

interface SimulationState {
    current: SimulationSummary;
    temporary: SimulationSummary | null;
}

export const SimulationPage: React.FC = () => {
    const { getShipById } = useShips();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedRole, setSelectedRole] = useState<ShipTypeName>('Attacker');
    const { getGearPiece, inventory } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [simulation, setSimulation] = useState<SimulationState | null>(null);
    const [searchParams] = useSearchParams();
    const [temporaryGear, setTemporaryGear] = useState<Partial<Record<GearSlotName, string>>>({});
    const [selectedSlot, setSelectedSlot] = useState<GearSlotName | null>(null);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { addNotification } = useNotification();
    const { equipMultipleGear, updateShip } = useShips();
    const [temporaryImplants, setTemporaryImplants] = useState<Implant[]>([]);

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
            temporaryImplants,
            getEngineeringStatsForShipType(selectedShip.type)
        );

        setSimulation({
            current: runSimulation(currentStats.final, selectedRole, activeCurrentSets),
            temporary: hasChanges()
                ? runSimulation(temporaryStats.final, selectedRole, activeTemporarySets)
                : null,
        });
    };

    const hasGearChanges = () => {
        if (!selectedShip) return false;
        return JSON.stringify(temporaryGear) !== JSON.stringify(selectedShip.equipment);
    };

    const hasImplantChanges = () => {
        if (!selectedShip) return false;
        return JSON.stringify(temporaryImplants) !== JSON.stringify(selectedShip.implants);
    };

    const hasChanges = () => hasGearChanges() || hasImplantChanges();

    const handleSaveGearChanges = () => {
        if (!selectedShip) return;

        const gearAssignments = Object.entries(temporaryGear).map(([slot, gearId]) => ({
            slot: slot as GearSlotName,
            gearId: gearId || '',
        }));

        equipMultipleGear(selectedShip.id, gearAssignments);
        addNotification('success', 'Gear changes saved successfully');
    };

    const handleResetGearChanges = () => {
        if (selectedShip) {
            setTemporaryGear(selectedShip.equipment);
            setSimulation(null);
        }
    };

    const handleSaveImplantChanges = () => {
        if (!selectedShip) return;

        const updatedShip = {
            ...selectedShip,
            implants: temporaryImplants,
        };

        updateShip(selectedShip.id, updatedShip);
        addNotification('success', 'Implant changes saved successfully');
    };

    const handleResetImplantChanges = () => {
        if (selectedShip) {
            setTemporaryImplants(selectedShip.implants);
            setSimulation(null);
        }
    };

    const handleRoleChange = (role: ShipTypeName) => {
        setSelectedRole(role);
        setSimulation(null);
    };

    const selectedShip = getShipById(selectedShipId);
    const currentGearLookup = useGearLookup(selectedShip?.equipment || {}, getGearPiece);
    const temporaryGearLookup = useGearLookup(temporaryGear, getGearPiece);
    const activeCurrentSets = useGearSets(selectedShip?.equipment || {}, currentGearLookup);
    const activeTemporarySets = useGearSets(temporaryGear, temporaryGearLookup);

    useEffect(() => {
        if (selectedShip) {
            setTemporaryGear(selectedShip.equipment);
            setTemporaryImplants(selectedShip.implants);
            setSelectedRole(SHIP_TYPES[selectedShip.type].name);
        }
    }, [selectedShip]);

    return (
        <>
            <Seo {...SEO_CONFIG.simulation} />
            <PageLayout
                title="Simulation"
                description="Simulate simplified attacks, hacks, heals, and defence with your ships and gear. Use the settings to change the simulation parameters. Change the gear and implants to see how they affect the simulation. Choose the ship role to choose scenario. "
            >
                <SimulationInfo />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-4">
                        <SimulationSettings
                            selectedShip={selectedShip || null}
                            selectedRole={selectedRole}
                            onShipSelect={(ship) => setSelectedShipId(ship.id)}
                            onRoleSelect={handleRoleChange}
                            onRunSimulation={handleRunSimulation}
                        />

                        <Button
                            aria-label="Run Simulation"
                            variant="primary"
                            onClick={handleRunSimulation}
                            disabled={!selectedShip}
                            fullWidth
                        >
                            Run Simulation
                        </Button>

                        {simulation && (
                            <SimulationResults
                                currentSimulation={simulation.current}
                                suggestedSimulation={simulation.temporary || undefined}
                                role={selectedRole}
                                alwaysColumn
                            />
                        )}
                    </div>
                    {selectedShip && (
                        <div className="space-y-4">
                            <h3 className="text-xl font-bold">Quick Swap</h3>
                            <div className="bg-dark p-4 space-y-4">
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

                                <hr className="border-gray-700" />

                                <ImplantTesting
                                    ship={selectedShip}
                                    temporaryImplants={temporaryImplants}
                                    onImplantsChange={setTemporaryImplants}
                                    onSaveChanges={handleSaveImplantChanges}
                                    onResetChanges={handleResetImplantChanges}
                                    hasChanges={hasImplantChanges()}
                                />
                            </div>
                        </div>
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
        </>
    );
};

export default SimulationPage;

const SimulationInfo: React.FC = () => (
    <ul className="list-disc list-inside text-sm text-gray-400">
        <li>It will only use 100% damage hits, no ship specific attacks are used.</li>
        <li>For defenders, it will take hits from an enemy with 15000 attack and 170 security.</li>
        <li>For debuffers, it will also try to hack an enemy with 170 security.</li>
        <li>For supporters, it will heal an ally with using 15% of their max HP.</li>
    </ul>
);
