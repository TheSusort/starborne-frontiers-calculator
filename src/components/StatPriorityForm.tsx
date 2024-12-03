import React, { useState } from 'react';
import { Button } from './ui';
import { StatName } from '../types/gear';
import { StatPriority } from '../types/autogear';

const AVAILABLE_STATS: StatName[] = [
    'attack',
    'defence',
    'hp',
    'speed',
    'crit',
    'critDamage',
    'healModifier',
    'hacking',
    'security'
];

interface Props {
    onAdd: (priority: StatPriority) => void;
    existingPriorities: StatPriority[];
}

export const StatPriorityForm: React.FC<Props> = ({ onAdd, existingPriorities }) => {
    const [selectedStat, setSelectedStat] = useState<StatName>(AVAILABLE_STATS[0]);
    const [maxLimit, setMaxLimit] = useState<string>('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        onAdd({
            stat: selectedStat,
            maxLimit: maxLimit ? Number(maxLimit) : undefined,
            weight: existingPriorities.length + 1
        });

        setMaxLimit('');
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 bg-dark-lighter p-4 rounded">
            <div className="space-y-2">
                <label className="block text-sm text-gray-300">Stat</label>
                <select
                    value={selectedStat}
                    onChange={(e) => setSelectedStat(e.target.value as StatName)}
                    className="w-full bg-dark border border-dark-border rounded p-2 text-white"
                >
                    {AVAILABLE_STATS.map(stat => (
                        <option key={stat} value={stat}>
                            {stat.charAt(0).toUpperCase() + stat.slice(1)}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-2">
                <label className="block text-sm text-gray-300">
                    Max Limit (Optional)
                </label>
                <input
                    type="number"
                    value={maxLimit}
                    onChange={(e) => setMaxLimit(e.target.value)}
                    className="w-full bg-dark border border-dark-border rounded p-2 text-white"
                    placeholder="Enter maximum value"
                />
            </div>

            <Button
                type="submit"
                variant="secondary"
                fullWidth
            >
                Add Priority
            </Button>
        </form>
    );
};