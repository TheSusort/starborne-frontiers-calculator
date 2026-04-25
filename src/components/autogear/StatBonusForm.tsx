import React, { useEffect, useState } from 'react';
import { Button, Select, Input } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusFormProps {
    onAdd: (bonus: StatBonus) => void;
    editingValue?: StatBonus;
    onSave?: (bonus: StatBonus) => void;
    onCancel?: () => void;
}

export const StatBonusForm: React.FC<StatBonusFormProps> = ({
    onAdd,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);
    const [mode, setMode] = useState<'additive' | 'multiplier'>('additive');

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat as StatName);
            setPercentage(editingValue.percentage);
            setMode(editingValue.mode ?? 'additive');
        } else {
            setSelectedStat('');
            setPercentage(0);
            setMode('additive');
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedStat) return;
        const value = { stat: selectedStat, percentage, mode };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedStat('');
        setPercentage(0);
    };

    const helpText =
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
                        helpLabel={helpText}
                    />
                    <div className="w-32">
                        <Input
                            label="Percentage"
                            type="number"
                            min="0"
                            step="1"
                            value={percentage}
                            onChange={(e) => setPercentage(parseFloat(e.target.value))}
                            helpLabel={helpText}
                        />
                    </div>
                    <Select
                        label="Mode"
                        options={[
                            { value: 'additive', label: 'Additive' },
                            { value: 'multiplier', label: 'Multiplier' },
                        ]}
                        value={mode}
                        onChange={(value) => setMode(value as 'additive' | 'multiplier')}
                        helpLabel={helpText}
                    />
                    {editingValue ? (
                        <>
                            <Button type="submit" disabled={!selectedStat} variant="primary">
                                Save
                            </Button>
                            <Button type="button" variant="secondary" onClick={onCancel}>
                                Cancel
                            </Button>
                        </>
                    ) : (
                        <Button type="submit" disabled={!selectedStat} variant="secondary">
                            Add
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
};
