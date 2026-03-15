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
    const [mode, setMode] = useState<'additive' | 'multiplier'>('additive');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedStat) {
            onAdd({ stat: selectedStat, percentage, mode });
            setSelectedStat('');
            setPercentage(0);
        }
    };

    const percentageHelpLabel =
        mode === 'additive'
            ? 'Adds stat × % directly to role score. Use for skills that scale off a stat (e.g., defense@80% for a skill dealing 80% of defense as damage).'
            : 'Multiplies role score by stat × %. Use when a stat should scale proportionally with the role (e.g., hacking@50% makes DPS scale with hacking).';

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
                        helpLabel="Select a stat to contribute to the role score. Formula: bonusScore = statValue × (percentage / 100)"
                    />
                    <div className="w-32">
                        <Input
                            label="Percentage"
                            type="number"
                            min="0"
                            step="1"
                            value={percentage}
                            onChange={(e) => setPercentage(parseFloat(e.target.value))}
                            helpLabel={percentageHelpLabel}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-gray-400">Mode</span>
                        <div className="flex">
                            <button
                                type="button"
                                onClick={() => setMode('additive')}
                                className={`px-2 py-1 text-xs border rounded-l ${
                                    mode === 'additive'
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'bg-dark-lighter border-dark-lighter text-gray-400 hover:text-white'
                                }`}
                            >
                                Additive
                            </button>
                            <button
                                type="button"
                                onClick={() => setMode('multiplier')}
                                className={`px-2 py-1 text-xs border rounded-r ${
                                    mode === 'multiplier'
                                        ? 'bg-blue-600 border-blue-500 text-white'
                                        : 'bg-dark-lighter border-dark-lighter text-gray-400 hover:text-white'
                                }`}
                            >
                                Multiplier
                            </button>
                        </div>
                    </div>
                    <Button type="submit" disabled={!selectedStat} variant="secondary">
                        Add
                    </Button>
                </div>
            </form>
        </div>
    );
};
