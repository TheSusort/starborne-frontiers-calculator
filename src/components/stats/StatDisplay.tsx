import React from 'react';
import { Stat, StatName } from '../../types/stats';
import { STATS } from '../../constants';

interface Props {
    stats: Stat[];
    className?: string;
    title?: string;
    compact?: boolean;
    upgradedStats?: Stat[];
}

export const StatDisplay: React.FC<Props> = ({
    stats,
    className = '',
    title,
    compact = false,
    upgradedStats,
}) => {
    if (stats.length === 0) {
        return null;
    }

    const statsToDisplay = upgradedStats ? upgradedStats : stats;

    return (
        <div className={`space-y-2 ${className}`}>
            {title && <h3 className="text-lg font-semibold mb-2">{title}</h3>}
            <div className="space-y-2">
                {statsToDisplay.map((stat, index) => (
                    <div
                        key={`${stat.name}-${index}`}
                        className="flex justify-between items-center bg-dark-lighter px-3 py-1.5"
                    >
                        {stat.value !== 0 && (
                            <>
                                <span>
                                    {compact
                                        ? STATS[stat.name as StatName].shortLabel
                                        : STATS[stat.name as StatName].label}
                                </span>
                                <span>
                                    {stat.min && stat.max ? `${stat.min}-${stat.max}` : stat.value}
                                    {stat.type === 'percentage' ? '%' : ''}
                                    {upgradedStats &&
                                        stats.find(
                                            (s) => s.name === stat.name && s.type === stat.type
                                        ) && (
                                            <span className="text-gray-500">
                                                {' ('}
                                                {
                                                    stats.find(
                                                        (s) =>
                                                            s.name === stat.name &&
                                                            s.type === stat.type
                                                    )?.value
                                                }
                                                {stat.type === 'percentage' ? '%' : ''}
                                                {')'}
                                            </span>
                                        )}
                                </span>
                            </>
                        )}
                        {stat.value === 0 && <span className="text-gray-400">No stats added</span>}
                    </div>
                ))}
            </div>
        </div>
    );
};
