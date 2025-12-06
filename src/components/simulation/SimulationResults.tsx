import React from 'react';
import { SimulationSummary } from '../../utils/simulation/simulationCalculator';
import { ShipTypeName, SHIP_TYPES } from '../../constants';
import { AttackerStats } from './AttackerStats';
import { DefenderStats } from './DefenderStats';
import { DebufferStats } from './DebufferStats';
import { SupporterStats } from './SupporterStats';
import { SupporterBufferStats } from './SupporterBufferStats';
import { SupporterOffensiveStats } from './SupporterOffensiveStats';
import { SupporterShieldStats } from './SupporterShieldStats';

interface SimulationResultsProps {
    currentSimulation: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    role: ShipTypeName | null;
    alwaysColumn?: boolean;
}

/**
 * Converts a role value (which might be a display name or key) to the actual key
 */
const normalizeRole = (role: ShipTypeName | null): ShipTypeName | null => {
    if (!role) return null;

    // If it's already a key (uppercase), return it
    if (role in SHIP_TYPES) {
        return role as ShipTypeName;
    }

    // Otherwise, find the key by matching the display name
    const foundKey = Object.keys(SHIP_TYPES).find(
        (key) => SHIP_TYPES[key as ShipTypeName].name === role
    ) as ShipTypeName | undefined;

    return foundKey || null;
};

const renderStats = (
    simulation: SimulationSummary,
    role: ShipTypeName | null,
    currentSimulation: SimulationSummary,
    suggestedSimulation?: SimulationSummary,
    showComparison = false
) => {
    const normalizedRole = normalizeRole(role);
    const commonProps = {
        simulation,
        currentSimulation,
        suggestedSimulation,
        showComparison,
    };

    switch (normalizedRole) {
        case 'DEFENDER':
        case 'DEFENDER_SECURITY':
            return <DefenderStats {...commonProps} />;
        case 'DEBUFFER':
        case 'DEBUFFER_DEFENSIVE':
        case 'DEBUFFER_BOMBER':
            return <DebufferStats {...commonProps} />;
        case 'SUPPORTER':
            return <SupporterStats {...commonProps} />;
        case 'SUPPORTER_BUFFER':
            return <SupporterBufferStats {...commonProps} />;
        case 'SUPPORTER_OFFENSIVE':
            return <SupporterOffensiveStats {...commonProps} />;
        case 'SUPPORTER_SHIELD':
            return <SupporterShieldStats {...commonProps} />;
        default:
            return <AttackerStats {...commonProps} />;
    }
};

export const SimulationResults: React.FC<SimulationResultsProps> = ({
    currentSimulation,
    suggestedSimulation,
    role,
    alwaysColumn = false,
}) => {
    return (
        <div
            className={`grid grid-cols-1 ${
                suggestedSimulation && !alwaysColumn ? 'md:grid-cols-2' : ''
            } gap-4 mt-4 `}
        >
            <div>
                <div className="card space-y-2">
                    <h3 className="text-lg font-semibold">Current Configuration</h3>
                    <div className="flex flex-col gap-2">
                        {renderStats(
                            currentSimulation,
                            role,
                            currentSimulation,
                            suggestedSimulation,
                            false
                        )}
                    </div>
                </div>
            </div>
            {suggestedSimulation && (
                <div>
                    <div className="card space-y-2">
                        <h3 className="text-lg font-semibold">Suggested Configuration</h3>
                        <div className="flex flex-col gap-2">
                            {renderStats(
                                suggestedSimulation,
                                role,
                                currentSimulation,
                                suggestedSimulation,
                                true
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
