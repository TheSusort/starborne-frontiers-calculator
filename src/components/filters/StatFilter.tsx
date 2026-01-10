import React from 'react';
import { Button } from '../ui';
import { StatFilter as StatFilterType } from '../../hooks/usePersistedFilters';
import { STATS } from '../../constants/stats';
import { StatName, StatType } from '../../types/stats';

interface StatFilterProps {
    statFilters: StatFilterType[];
    onStatFiltersChange: (filters: StatFilterType[]) => void;
    label?: string;
    className?: string;
}

export const StatFilter: React.FC<StatFilterProps> = ({
    statFilters,
    onStatFiltersChange,
    label = 'Stat Filters',
    className = '',
}) => {
    // Create stat options that separate flat and percentage types for applicable stats
    const getStatOptions = () => {
        const options: { value: string; label: string }[] = [];

        // Only show stats that are actually available in gear
        const gearAvailableStats: StatName[] = [
            'attack',
            'hp',
            'defence',
            'crit',
            'critDamage',
            'speed',
            'hacking',
            'security',
        ];

        gearAvailableStats.forEach((stat) => {
            const statConfig = STATS[stat];

            if (stat === 'attack' || stat === 'hp' || stat === 'defence') {
                // For ATK, HP, DEF - separate flat and percentage options
                options.push({
                    value: `${stat}-flat`,
                    label: `${statConfig.shortLabel} (Flat)`,
                });
                options.push({
                    value: `${stat}-percentage`,
                    label: `${statConfig.shortLabel} (%)`,
                });
            } else {
                // For other stats - single option based on their allowed type
                const type = statConfig.allowedTypes[0];
                options.push({
                    value: `${stat}-${type}`,
                    label: `${statConfig.shortLabel}`,
                });
            }
        });

        return options;
    };

    const toggleStatFilter = (statValue: string) => {
        const [statName, statType] = statValue.split('-') as [StatName, StatType];
        const existingFilterIndex = statFilters.findIndex(
            (filter) => filter.statName === statName && filter.statType === statType
        );

        if (existingFilterIndex >= 0) {
            // Remove the filter if it already exists
            const newFilters = statFilters.filter((_, i) => i !== existingFilterIndex);
            onStatFiltersChange(newFilters);
        } else {
            // Add the filter if it doesn't exist
            const newFilter: StatFilterType = {
                statName,
                statType,
            };
            onStatFiltersChange([...statFilters, newFilter]);
        }
    };

    const isStatSelected = (statValue: string) => {
        const [statName, statType] = statValue.split('-') as [StatName, StatType];
        return statFilters.some(
            (filter) => filter.statName === statName && filter.statType === statType
        );
    };

    return (
        <div className={`space-y-4 ${className}`}>
            <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-200">{label}</label>

                {/* Available stat buttons */}
                <div className="flex flex-wrap gap-2">
                    {getStatOptions().map((option) => (
                        <Button
                            key={option.value}
                            onClick={() => toggleStatFilter(option.value)}
                            variant={isStatSelected(option.value) ? 'primary' : 'secondary'}
                            size="sm"
                            className={
                                isStatSelected(option.value) ? 'bg-primary border-primary' : ''
                            }
                        >
                            {option.label}
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    );
};
