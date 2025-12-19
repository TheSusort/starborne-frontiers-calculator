import React from 'react';
import { SimulationSummary } from '../../../utils/simulation/simulationCalculator';

interface BoostSetStatusProps {
    simulation: SimulationSummary;
}

export const BoostSetStatus: React.FC<BoostSetStatusProps> = ({ simulation }) => {
    const boostSetActive = simulation.activeSets?.includes('BOOST') || false;

    return (
        <div>
            <span className="text-gray-400">Boost Set:</span>
            <span className={`ml-2 ${boostSetActive ? 'text-green-500' : 'text-red-500'}`}>
                {boostSetActive ? 'Active' : 'Inactive'}
            </span>
        </div>
    );
};
