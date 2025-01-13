import React from 'react';
import { EnhancedStatDistribution } from '../../types/analysis';
import { StatDistributionChart } from './StatDistributionChart';

interface Props {
    distribution: EnhancedStatDistribution;
}

export const EnhancedStatDistributionView: React.FC<Props> = ({ distribution }) => {
    const { slotContributions } = distribution;

    return (
        <div className="space-y-6">
            <StatDistributionChart contributions={slotContributions} />
        </div>
    );
};
