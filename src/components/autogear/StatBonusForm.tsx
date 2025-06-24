import React, { useState } from 'react';
import { Button, Select, Input } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusFormProps {
    onAdd: (bonus: StatBonus) => void;
    existingBonuses: StatBonus[];
    onRemove: (index: number) => void;
}

export const StatBonusForm: React.FC<StatBonusFormProps> = ({ onAdd }) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedStat) {
            onAdd({ stat: selectedStat, percentage });
            setSelectedStat('');
            setPercentage(0);
        }
    };

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-2">
                <div className="flex gap-4 items-end">
                    <Select
                        label="Stat"
                        className="flex-1"
                        options={ALL_STAT_NAMES.map((key) => ({
                            value: key,
                            label: STATS[key].label,
                        }))}
                        value={selectedStat}
                        onChange={(value) => setSelectedStat(value as StatName)}
                        noDefaultSelection
                        helpLabel="Select a stat to contribute to the role score."
                    />
                    <div className="w-32">
                        <Input
                            label="Percentage"
                            type="number"
                            min="0"
                            step="1"
                            value={percentage}
                            onChange={(e) => setPercentage(parseFloat(e.target.value))}
                            helpLabel="Set the percentage of the stat value to add to the role score."
                        />
                    </div>
                    <Button type="submit" disabled={!selectedStat} variant="secondary">
                        Add
                    </Button>
                </div>
            </form>
        </div>
    );
};
