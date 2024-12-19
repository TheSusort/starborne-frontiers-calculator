import React, { useState } from 'react';
import { useShips } from '../hooks/useShips';
import { useInventory } from '../hooks/useInventory';
import { GearSuggestion, StatPriority } from '../types/autogear';
import { GearPiece } from '../types/gear';
import { calculateTotalStats } from '../utils/statsCalculator';
import { PageLayout } from '../components/layout/PageLayout';
import { useEngineeringStats } from '../hooks/useEngineeringStats';
import { AutogearAlgorithm } from '../utils/autogear/AutogearStrategy';
import { getAutogearStrategy } from '../utils/autogear/getStrategy';
import { runDamageSimulation, SimulationSummary } from '../utils/simulationCalculator';
import { StatList } from '../components/stats/StatList';
import { GearSlotName, ShipTypeName } from '../constants';
import { AutogearSettings } from '../components/autogear/AutogearSettings';
import { GearSuggestions } from '../components/autogear/GearSuggestions';
import { SimulationResults } from '../components/autogear/SimulationResults';

export const AutogearPage: React.FC = () => {
    const { getShipById, updateShip } = useShips();
    const { getGearPiece, inventory } = useInventory();
    const [selectedShipId, setSelectedShipId] = useState<string>('');
    const [selectedShipRole, setSelectedShipRole] = useState<ShipTypeName | null>(null);
    const [priorities, setPriorities] = useState<StatPriority[]>([]);
    const [suggestions, setSuggestions] = useState<GearSuggestion[]>([]);
    const [hoveredGear, setHoveredGear] = useState<GearPiece | null>(null);
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [selectedAlgorithm, setSelectedAlgorithm] = useState<AutogearAlgorithm>(AutogearAlgorithm.BeamSearch);
    const [currentSimulation, setCurrentSimulation] = useState<SimulationSummary | null>(null);
    const [suggestedSimulation, setSuggestedSimulation] = useState<SimulationSummary | null>(null);

    const selectedShip = getShipById(selectedShipId);

    const handleAddPriority = (priority: StatPriority) => {
        setPriorities([...priorities, priority]);
    };

    const handleRemovePriority = (index: number) => {
        setPriorities(priorities.filter((_, i) => i !== index));
    };

    const handleAutogear = () => {
        if (!selectedShip) return;

        const strategy = getAutogearStrategy(selectedAlgorithm);
        const suggestions = strategy.findOptimalGear(
            selectedShip,
            priorities,
            inventory,
            getGearPiece,
            getEngineeringStatsForShipType,
            selectedShipRole || undefined
        );

        setSuggestions(suggestions);

        // Run simulations for both current and suggested gear
        const currentStats = getCurrentStats();
        const suggestedStats = getSuggestedStats();

        if (currentStats && suggestedStats) {
            setCurrentSimulation(runDamageSimulation(currentStats));
            setSuggestedSimulation(runDamageSimulation(suggestedStats));
        }
    };

    const handleEquipSuggestions = () => {
        if (!selectedShip) return;

        const updatedEquipment = { ...selectedShip.equipment };
        suggestions.forEach(suggestion => {
            updatedEquipment[suggestion.slotName as GearSlotName] = suggestion.gearId;
        });

        updateShip({
            ...selectedShip,
            equipment: updatedEquipment
        });

        // Clear suggestions after equipping
        setSuggestions([]);
    };

    const getCurrentStats = () => {
        if (!selectedShip) return null;
        return calculateTotalStats(
            selectedShip.baseStats,
            selectedShip.equipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );
    };

    const getSuggestedStats = () => {
        if (!selectedShip) return null;

        const suggestedEquipment = { ...selectedShip.equipment };
        suggestions.forEach(suggestion => {
            suggestedEquipment[suggestion.slotName] = suggestion.gearId;
        });

        return calculateTotalStats(
            selectedShip.baseStats,
            suggestedEquipment,
            getGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            getEngineeringStatsForShipType(selectedShip.type)
        );
    };

    const currentStats = getCurrentStats();
    const suggestedStats = getSuggestedStats();

    return (
        <PageLayout
            title="Autogear"
            description="Find the best gear for your ship."
        >
            {currentStats && suggestedStats && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-200">
                    <StatList
                        stats={currentStats}
                        title="Current Stats"
                        className="p-4"
                    />
                    <StatList
                        stats={suggestedStats}
                        comparisonStats={currentStats}
                        title="Stats with Suggested Gear"
                        className="p-4"
                    />
                </div>
            )}

            {currentSimulation && suggestedSimulation && suggestions.length > 0 && (
                <SimulationResults
                    currentSimulation={currentSimulation}
                    suggestedSimulation={suggestedSimulation}
                />
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AutogearSettings
                    selectedShip={selectedShip || null}
                    selectedShipRole={selectedShipRole}
                    selectedAlgorithm={selectedAlgorithm}
                    priorities={priorities}
                    onShipSelect={(ship) => setSelectedShipId(ship.id)}
                    onRoleSelect={setSelectedShipRole}
                    onAlgorithmSelect={setSelectedAlgorithm}
                    onAddPriority={handleAddPriority}
                    onRemovePriority={handleRemovePriority}
                    onFindOptimalGear={handleAutogear}
                />

                {suggestions.length > 0 && (
                    <GearSuggestions
                        suggestions={suggestions}
                        getGearPiece={getGearPiece}
                        hoveredGear={hoveredGear}
                        onHover={setHoveredGear}
                        onEquip={handleEquipSuggestions}
                    />
                )}
            </div>
        </PageLayout>
    );
};