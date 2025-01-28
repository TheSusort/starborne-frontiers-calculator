import React, { useState } from 'react';
import { Select, Input, Button, CloseIcon } from '../ui';
import { Stat, StatName, StatType } from '../../types/stats';
import { STATS } from '../../constants';
import { ChevronDownIcon, ChevronUpIcon, EditIcon } from '../ui/icons';

interface Props {
    stats: Stat[];
    onChange: (stats: Stat[]) => void;
    maxStats: number;
    allowedStats?: Record<StatName, { allowedTypes: StatType[] | undefined }>;
    excludedStats?: Array<{ name: StatName; type: StatType }>;
    alwaysColumn?: boolean;
    defaultExpanded?: boolean;
}

const StatSummary: React.FC<{ stat: Stat }> = ({ stat }) => {
    const statLabel = STATS[stat.name].label;
    const typeLabel = stat.type.charAt(0).toUpperCase() + stat.type.slice(1);

    return (
        <span className="text-sm">
            {statLabel}: {stat.value}
            {typeLabel === 'Percentage' ? '%' : ''}
        </span>
    );
};

export const StatModifierInput: React.FC<Props> = ({
    stats,
    onChange,
    maxStats,
    allowedStats,
    excludedStats = [],
    alwaysColumn = false,
    defaultExpanded = true,
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const handleStatChange = (index: number, field: keyof Stat, value: string) => {
        const newStats = [...stats];
        const currentStat = newStats[index];

        if (field === 'name') {
            // Get allowed types for the new stat name
            const allowedTypes =
                allowedStats?.[value as StatName]?.allowedTypes ||
                STATS[value as StatName].allowedTypes;

            // Filter out excluded types for this stat name
            const validTypes = allowedTypes.filter(
                (type) =>
                    !excludedStats?.some(
                        (excluded) => excluded.name === value && excluded.type === type
                    )
            );

            // Use the first valid type
            const defaultType = validTypes[0];

            newStats[index] = {
                ...currentStat,
                name: value,
                type: defaultType,
            } as Stat;
        } else if (field === 'type') {
            // Check if the new type would create an excluded combination
            const isExcluded = excludedStats?.some(
                (excluded) => excluded.name === currentStat.name && excluded.type === value
            );

            if (!isExcluded) {
                newStats[index] = {
                    ...currentStat,
                    type: value,
                } as Stat;
            }
            // If excluded, don't update the type
        } else {
            newStats[index] = {
                ...currentStat,
                [field]: field === 'value' ? Number(value) : value,
            } as Stat;
        }

        onChange(newStats);
    };

    const addStat = () => {
        if (stats.length < maxStats) {
            const firstStat = Object.keys(allowedStats || STATS)[0] as StatName;
            const firstType = (allowedStats?.[firstStat]?.allowedTypes || ['flat'])[0];

            const newStat = {
                name: firstStat,
                type: firstType,
                value: 0,
            } as Stat; // Type assertion to Stat

            onChange([...stats, newStat]);
        }
    };

    const removeStat = (index: number) => {
        const newStats = stats.filter((_, i) => i !== index);
        onChange(newStats);
    };

    // Filter out stats that don't have allowed types, match excluded stats, or are healModifier
    const statOptions = Object.entries(allowedStats || STATS)
        .filter(
            ([key, value]) => value.allowedTypes?.length && key !== 'healModifier' // Exclude healModifier
        )
        .map(([key, value]) => {
            const allowedTypesForStat = value.allowedTypes?.filter(
                (type) =>
                    // Filter out types that match excluded stats
                    !excludedStats.some(
                        (excluded) => excluded.name === key && excluded.type === type
                    )
            );

            return {
                value: key,
                label: STATS[key as StatName].label,
                allowedTypes: allowedTypesForStat?.map((type) => ({
                    value: type,
                    label: type.charAt(0).toUpperCase() + type.slice(1),
                })),
            };
        })
        // Only include stats that have at least one allowed type after filtering
        .filter((stat) => stat.allowedTypes && stat.allowedTypes.length > 0);

    if (!isExpanded) {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setIsExpanded(true)}
                        className="flex items-center gap-1"
                    >
                        <EditIcon />
                    </Button>
                    {stats.length > 0 && (
                        <div className="flex gap-2 text-gray-400 items-center">
                            {stats.map((stat, index) => (
                                <React.Fragment key={index}>
                                    <StatSummary stat={stat} />
                                    {index < stats.length - 1 && <span>|</span>}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 me-12">
            {stats.map((stat, index) => (
                <div key={index} className="flex gap-4 items-end w-full">
                    <div
                        className={`grid grid-cols-1 ${
                            alwaysColumn ? '' : 'md:grid-cols-3'
                        } gap-4 items-end w-full`}
                    >
                        <Select
                            label="Stat"
                            value={stat.name}
                            onChange={(value) => handleStatChange(index, 'name', value as StatName)}
                            options={statOptions}
                            className="w-full"
                        />
                        <Input
                            type="number"
                            label="Value"
                            value={stat.value}
                            onChange={(e) => handleStatChange(index, 'value', e.target.value)}
                            className="w-full"
                        />
                        <Select
                            label="Type"
                            value={stat.type}
                            onChange={(value) => handleStatChange(index, 'type', value as StatType)}
                            options={
                                statOptions.find((option) => option.value === stat.name)
                                    ?.allowedTypes || []
                            }
                            className="w-full"
                        />
                    </div>
                    <Button
                        aria-label="Remove stat"
                        variant="secondary"
                        size="sm"
                        className="!h-10"
                        onClick={() => removeStat(index)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            ))}
            {stats.length < maxStats && (
                <Button variant="secondary" onClick={addStat} type="button" aria-label="Add stat">
                    Add Stat
                </Button>
            )}
        </div>
    );
};
