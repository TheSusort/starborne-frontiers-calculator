import React from 'react';
import { Stat, StatName } from '../../types/stats';
import { STATS } from '../../constants';

interface Props {
    stats: Stat[];
    className?: string;
    title?: string;
    compact?: boolean;
}

export const StatDisplay: React.FC<Props> = ({ stats, className = '', title, compact = false }) => {
    if (stats.length === 0) {
        return null;
    }

    return (
        <div className={`space-y-2 ${className}`}>
            {title && <h3 className="text-lg font-semibold mb-2">{title}</h3>}
            <div className="space-y-2">
                {stats.map((stat, index) => (
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
