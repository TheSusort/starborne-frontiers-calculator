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

    // Guard against null/undefined entries. If a caller ever passes an array
    // containing nulls (e.g. an implant whose mainStat is null being spread
    // into a stats list), skip them rather than crash the React tree on
    // `stat.value` access.
    const statsToDisplay = (upgradedStats ?? stats).filter((stat): stat is Stat => stat != null);

    if (statsToDisplay.length === 0) {
        return null;
    }

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
                                            <span className="text-theme-text-secondary">
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
                        {stat.value === 0 && (
                            <span className="text-theme-text-secondary">No stats added</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};
