import React from 'react';
import { SlotContribution } from '../../utils/analysis/statDistribution';
import { GEAR_SLOTS } from '../../constants';

interface Props {
    contributions: SlotContribution[];
}

export const StatDistributionChart: React.FC<Props> = ({ contributions }) => {
    if (!contributions || contributions.length === 0) {
        return null;
    }

    return (
        <div className="p-4 bg-dark">
            <h3 className="font-semibold">Gear Contribution</h3>
            <p className="text-xs text-gray-400 mb-4">
                The chart below shows the relative contribution of each gear piece and its stats to
                the ship&apos;s final score. Score is calculated differently for each ship type.
            </p>

            {contributions.map((contribution) => (
                <div key={contribution.slotName} className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                        <span className="">{GEAR_SLOTS[contribution.slotName].label}</span>
                        <span className="text-gray-400">
                            {contribution.relativeScore > 0.1
                                ? contribution.relativeScore.toFixed(1)
                                : '<0.1'}
                            %
                        </span>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-dark-lighter h-2 overflow-hidden">
                        <div
                            className="h-full bg-blue-500"
                            style={{
                                width: `${Math.max(0, Math.min(100, contribution.relativeScore))}%`,
                            }}
                        />
                    </div>

                    {/* Stat breakdown */}
                    <div className="mt-1 text-xs text-gray-400 flex flex-wrap gap-2">
                        {contribution.primaryStats
                            .filter((stat) => stat.percentage >= 0.1) // Only show significant contributions
                            .sort((a, b) => b.percentage - a.percentage)
                            .map((stat) => (
                                <span key={stat.statName}>
                                    {stat.statName}:{' '}
                                    {stat.percentage > 0.1 ? stat.percentage.toFixed(1) : '<0.1'}%
                                </span>
                            ))}
                    </div>
                </div>
            ))}
        </div>
    );
};
