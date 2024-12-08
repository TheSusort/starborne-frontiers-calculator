import React from 'react';
import { Select, Input, Button } from '../ui';
import { Stat, StatName, StatType } from '../../types/stats';
import { CloseIcon } from '../ui/CloseIcon';
import { STATS } from '../../constants/stats';

interface Props {
    stats: Stat[];
    onChange: (stats: Stat[]) => void;
    maxStats: number;
    allowedStats?: Record<StatName, { allowedTypes: StatType[] | undefined }>;
    excludedStats?: Array<{ name: StatName; type: StatType }>;
}

export const StatModifierInput: React.FC<Props> = ({ stats, onChange, maxStats, allowedStats, excludedStats = [] }) => {

    const handleStatChange = (index: number, field: keyof Stat, value: string) => {
        const newStats = [...stats];
        const currentStat = newStats[index];

        if (field === 'name') {
            // When changing stat name, set the first allowed type for that stat
            const allowedTypes = allowedStats?.[value as StatName]?.allowedTypes || STATS[value as StatName].allowedTypes;
            const defaultType = allowedTypes[0];

            newStats[index] = {
                ...currentStat,
                name: value,
                type: defaultType
            } as Stat;
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
                value: 0
            } as Stat; // Type assertion to Stat
            console.log(newStat);
            onChange([...stats, newStat]);
        }
    };

    const removeStat = (index: number) => {
        const newStats = stats.filter((_, i) => i !== index);
        onChange(newStats);
    };

    // Filter out stats that don't have allowed types and match excluded stats
    const statOptions = Object.entries(allowedStats || STATS)
        .filter(([_, value]) => value.allowedTypes?.length)
        .map(([key, value]) => {
            const allowedTypesForStat = value.allowedTypes?.filter(type =>
                // Filter out types that match excluded stats
                !excludedStats.some(excluded =>
                    excluded.name === key && excluded.type === type
                )
            );

            return {
                value: key,
                label: key.charAt(0).toUpperCase() + key.slice(1),
                allowedTypes: allowedTypesForStat?.map((type) => ({
                    value: type,
                    label: type.charAt(0).toUpperCase() + type.slice(1)
                }))
            };
        })
        // Only include stats that have at least one allowed type after filtering
        .filter(stat => stat.allowedTypes && stat.allowedTypes.length > 0);

    return (
        <div className="space-y-4">
            {stats.map((stat, index) => (
                <div key={index} className="flex gap-4 items-end">
                    <Select
                        label="Stat"
                        value={stat.name}
                        onChange={(e) => handleStatChange(index, 'name', e.target.value)}
                        options={statOptions}
                    />
                    <Input
                        type="number"
                        label="Value"
                        value={stat.value}
                        onChange={(e) => handleStatChange(index, 'value', e.target.value)}
                    />
                    <Select
                        label="Type"
                        value={stat.type}
                        onChange={(e) => handleStatChange(index, 'type', e.target.value)}
                        options={statOptions.find((option) => option.value === stat.name)?.allowedTypes || []}
                    />
                    <Button
                        variant="danger"
                        onClick={() => removeStat(index)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            ))}
            {stats.length < maxStats && (
                <Button
                    variant="secondary"
                    onClick={addStat}
                    type="button"
                >
                    Add Stat
                </Button>
            )}
        </div>
    );
};