import React from 'react';
import { BaseStats, PercentageOnlyStats, StatName, PERCENTAGE_ONLY_STATS } from '../../types/stats';
import { STATS } from '../../constants';

interface StatListProps {
    stats: BaseStats;
    comparisonStats?: BaseStats;
    title?: string;
    className?: string;
}

export const StatList: React.FC<StatListProps> = ({
    stats,
    comparisonStats,
    title,
    className = '',
}) => {
    return (
        <div className={`bg-dark rounded space-y-2 ${className}`} data-testid="stat-list">
            {title && <h3 className="text-lg font-semibold text-gray-200">{title}</h3>}
            {Object.entries(stats).map(([statName, value]) => {
                if (statName === 'healModifier' && value <= 0) {
                    return null;
                }

                const comparisonValue = comparisonStats?.[statName as StatName];
                const difference =
                    comparisonValue !== undefined ? value - comparisonValue : undefined;

                return (
                    <div key={statName} className="flex justify-between items-center">
                        <span className="text-gray-300 capitalize">
                            {STATS[statName as StatName].label}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-gray-300">
                                {Math.round(value)}
                                {PERCENTAGE_ONLY_STATS.includes(statName as PercentageOnlyStats)
                                    ? '%'
                                    : ''}
                            </span>
                            {difference !== undefined && difference !== 0 && (
                                <span
                                    className={difference > 0 ? 'text-green-500' : 'text-red-500'}
                                >
                                    ({difference > 0 ? '+' : ''}
                                    {Math.round(difference)})
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
