import React, { useState } from 'react';
import { Button, Input, Select } from '../ui';
import { StatName } from '../../types/stats';
import { StatPriority } from '../../types/autogear';

const AVAILABLE_STATS: StatName[] = [
    'attack',
    'defence',
    'hp',
    'speed',
    'crit',
    'critDamage',
    'healModifier',
    'hacking',
    'security',
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
            weight: existingPriorities.length + 1,
        });

        setMaxLimit('');
        setSelectedStat(AVAILABLE_STATS[0]);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 bg-dark p-4 rounded" role="form">
            <div className="space-y-2">
                <Select
                    label="Stat"
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as StatName)}
                    options={AVAILABLE_STATS.map((stat) => ({
                        value: stat,
                        label: stat.charAt(0).toUpperCase() + stat.slice(1),
                    }))}
                />
            </div>

            <div className="space-y-2">
                <Input
                    label="Max Limit (Optional)"
                    type="number"
                    value={maxLimit}
                    onChange={(e) => setMaxLimit(e.target.value)}
                    placeholder="Enter maximum value"
                />
            </div>

            <Button aria-label="Add priority" type="submit" variant="secondary" fullWidth>
                Add Priority
            </Button>
        </form>
    );
};
