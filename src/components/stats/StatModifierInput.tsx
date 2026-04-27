import React, { useState } from 'react';
import { Select, Input, Button, CloseIcon } from '../ui';
import { Stat, StatName, StatType } from '../../types/stats';
import { STATS } from '../../constants';
import { EditIcon } from '../ui/icons';

interface Props {
    stats: Stat[];
    onChange: (stats: Stat[]) => void;
    maxStats?: number;
    allowedStats?: Record<StatName, { allowedTypes: StatType[] | undefined }>;
    excludedStats?: Array<{ name: StatName; type: StatType }>;
    alwaysColumn?: boolean;
    defaultExpanded?: boolean;
    // Stats at indices 0..existingCount-1 are treated as existing (locked type, no remove button).
    // Stats at indices existingCount.. are newly added (editable type, removable).
    existingCount?: number;
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
    existingCount,
}) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    const handleStatChange = (index: number, field: keyof Stat, value: string) => {
        const newStats = [...stats];
        const currentStat = newStats[index];

        if (field === 'name') {
            const allowedTypes =
                allowedStats?.[value as StatName]?.allowedTypes ||
                STATS[value as StatName].allowedTypes;

            const validTypes = allowedTypes.filter(
                (type) =>
                    !excludedStats?.some(
                        (excluded) => excluded.name === value && excluded.type === type
                    )
            );

            newStats[index] = {
                ...currentStat,
                name: value,
                type: validTypes[0],
            } as Stat;
        } else if (field === 'type') {
            const isExcluded = excludedStats?.some(
                (excluded) => excluded.name === currentStat.name && excluded.type === value
            );

            if (!isExcluded) {
                newStats[index] = {
                    ...currentStat,
                    type: value,
                } as Stat;
            }
        } else {
            newStats[index] = {
                ...currentStat,
                [field]: field === 'value' ? Number(value) : value,
            } as Stat;
        }

        onChange(newStats);
    };

    const addStat = () => {
        if (!maxStats || stats.length < maxStats) {
            const firstStat = Object.keys(allowedStats || STATS)[0] as StatName;
            const firstType = (allowedStats?.[firstStat]?.allowedTypes || ['flat'])[0];

            onChange([...stats, { name: firstStat, type: firstType, value: 0 } as Stat]);
        }
    };

    const removeStat = (index: number) => {
        onChange(stats.filter((_, i) => i !== index));
    };

    const statOptions = Object.entries(allowedStats || STATS)
        .filter(([key, value]) => value.allowedTypes?.length && key !== 'healModifier')
        .map(([key, value]) => {
            const allowedTypesForStat = value.allowedTypes?.filter(
                (type) =>
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
                        <div className="flex gap-2 text-theme-text-secondary items-center">
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
        <div className="space-y-4">
            {stats.map((stat, index) => {
                const isExisting = existingCount !== undefined && index < existingCount;
                return (
                    <div key={index} className="flex gap-4 items-end w-full">
                        <div
                            className={`grid grid-cols-1 ${
                                alwaysColumn ? '' : 'md:grid-cols-3'
                            } gap-4 items-end w-full`}
                        >
                            <Select
                                label="Stat"
                                value={stat.name}
                                onChange={(value) =>
                                    handleStatChange(index, 'name', value as StatName)
                                }
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
                            {isExisting ? (
                                <div>
                                    <span className="flex text-sm font-medium items-center gap-2 justify-between mb-1.5">
                                        Type
                                    </span>
                                    <span className="text-sm text-theme-text-secondary">
                                        {stat.type.charAt(0).toUpperCase() + stat.type.slice(1)}
                                    </span>
                                </div>
                            ) : (
                                <Select
                                    label="Type"
                                    value={stat.type}
                                    onChange={(value) =>
                                        handleStatChange(index, 'type', value as StatType)
                                    }
                                    options={
                                        statOptions.find((option) => option.value === stat.name)
                                            ?.allowedTypes || []
                                    }
                                    className="w-full"
                                />
                            )}
                        </div>
                        {!isExisting && (
                            <Button
                                aria-label="Remove stat"
                                variant="secondary"
                                size="sm"
                                className="!h-10"
                                onClick={() => removeStat(index)}
                            >
                                <CloseIcon />
                            </Button>
                        )}
                    </div>
                );
            })}
            {(!maxStats || stats.length < maxStats) && (
                <Button variant="secondary" onClick={addStat} type="button" aria-label="Add stat">
                    Add Stat
                </Button>
            )}
        </div>
    );
};
