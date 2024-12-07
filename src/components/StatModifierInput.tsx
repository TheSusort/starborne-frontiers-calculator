import React from 'react';
import { Select, Input, Button } from './ui';
import { Stat, StatName, StatType } from '../types/stats';
import { CloseIcon } from './ui/CloseIcon';
import { STATS } from '../constants/stats';

interface Props {
    stats: Stat[];
    onChange: (stats: Stat[]) => void;
    maxStats: number;
    allowedStats?: Record<StatName, { allowedTypes: StatType[] | undefined }>;
    defaultStatType?: StatType;
    excludedStats?: Array<{ name: StatName; type: StatType }>;
}

export const StatModifierInput: React.FC<Props> = ({ stats, onChange, maxStats, allowedStats, defaultStatType, excludedStats = [] }) => {

    const handleStatChange = (index: number, field: keyof Stat, value: string) => {
        const newStats = [...stats];
        newStats[index] = {
            ...newStats[index],
            [field]: field === 'value' ? Number(value) : value,
        };
        onChange(newStats);
    };

    const addStat = () => {
        if (stats.length < maxStats) {
            onChange([...stats, { name: 'attack', type: defaultStatType || 'flat', value: 0 }]);
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