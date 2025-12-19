import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';

interface Hacking100PercentSuccessProps {
    simulation: SimulationSummary;
    currentSimulation?: SimulationSummary;
    suggestedSimulation?: SimulationSummary;
    showComparison?: boolean;
}

/**
 * Calculates the security threshold for 100% hack success rate
 * Formula: Security for 100% = hacking - 100
 */
const calculateSecurityFor100Percent = (hacking: number): number => {
    return Math.max(0, Math.round(hacking - 100));
};

export const Hacking100PercentSuccess: React.FC<Hacking100PercentSuccessProps> = ({
    simulation,
    currentSimulation,
    suggestedSimulation,
    showComparison = false,
}) => {
    const hacking = simulation.hacking || 0;
    const securityFor100Percent = calculateSecurityFor100Percent(hacking);

    const currentHacking = currentSimulation?.hacking;
    const suggestedHacking = suggestedSimulation?.hacking;

    const currentSecurityFor100Percent = currentHacking
        ? calculateSecurityFor100Percent(currentHacking)
        : undefined;

    const suggestedSecurityFor100Percent = suggestedHacking
        ? calculateSecurityFor100Percent(suggestedHacking)
        : undefined;

    return (
        <div>
            <span className="text-gray-400">Hacking 100% success against security:</span>
            <span className="ml-2">
                {'<='} {securityFor100Percent}
                {showComparison &&
                    currentSecurityFor100Percent !== undefined &&
                    suggestedSecurityFor100Percent !== undefined && (
                        <span
                            className={`ml-2 ${
                                suggestedSecurityFor100Percent > currentSecurityFor100Percent
                                    ? 'text-green-500'
                                    : 'text-red-500'
                            }`}
                        >
                            (
                            {suggestedSecurityFor100Percent > currentSecurityFor100Percent
                                ? '+'
                                : ''}
                            {suggestedSecurityFor100Percent - currentSecurityFor100Percent})
                        </span>
                    )}
            </span>
        </div>
    );
};
