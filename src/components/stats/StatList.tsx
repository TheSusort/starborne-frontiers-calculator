import React from 'react';
import { BaseStats, PercentageOnlyStats, PERCENTAGE_ONLY_STATS } from '../../types/stats';
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
    // Order based on BaseStats interface
    const orderedStatNames = [
        'hp',
        'attack',
        'defence',
        'hacking',
        'security',
        'crit',
        'critDamage',
        'speed',
        'healModifier',
        'shield',
        'defensePenetration',
        'hpRegen',
    ] satisfies (keyof BaseStats)[];

    return (
        <div className={`bg-dark space-y-2 ${className}`} data-testid="stat-list">
            {title && <h3 className="text-lg font-semibold">{title}</h3>}
            {orderedStatNames.map((statName) => {
                const value = stats[statName];

                if ((value ?? 0) <= 0) {
                    return null;
                }

                const comparisonValue = comparisonStats?.[statName];
                const difference =
                    comparisonValue !== undefined ? (value ?? 0) - comparisonValue : undefined;

                return (
                    <div key={statName} className="flex justify-between items-center">
                        <span className="capitalize">{STATS[statName].label}</span>
                        <div className="flex items-center gap-2">
                            <span>
                                {Math.round(value ?? 0)}
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
