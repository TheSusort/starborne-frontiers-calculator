import React, { useState } from 'react';
import { Button, Input, Select } from '../ui';
import { StatName } from '../../types/stats';
import { StatPriority } from '../../types/autogear';
import { STATS } from '../../constants/stats';

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
    const [weight, setWeight] = useState<number>(1);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        onAdd({
            stat: selectedStat,
            maxLimit: maxLimit ? Number(maxLimit) : undefined,
            weight: weight,
        });

        setMaxLimit('');
        console.log(existingPriorities);
        setWeight(existingPriorities.length > 0 ? existingPriorities.length + 1 : 1);
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
                        label: STATS[stat].label,
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

            <div className="space-y-2">
                <Input
                    label="Weight"
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                    placeholder="Enter weight"
                />
            </div>

            <Button aria-label="Add priority" type="submit" variant="secondary" fullWidth>
                Add Priority
            </Button>
        </form>
    );
};
