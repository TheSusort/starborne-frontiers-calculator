import React, { useEffect, useState } from 'react';
import { Button, Select, Input } from '../ui';
import type { FleetBuff } from '../../types/autogear';
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { PERCENTAGE_ONLY_STATS, type StatName } from '../../types/stats';

const PERCENTAGE_ONLY_SET = new Set<StatName>(PERCENTAGE_ONLY_STATS);

interface FleetBuffFormProps {
    onAdd: (buff: FleetBuff) => void;
    editingValue?: FleetBuff;
    onSave?: (buff: FleetBuff) => void;
    onCancel?: () => void;
}

export const FleetBuffForm: React.FC<FleetBuffFormProps> = ({
    onAdd,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat);
            setPercentage(editingValue.percentage);
        } else {
            setSelectedStat('');
            setPercentage(0);
        }
    }, [editingValue]);

    const hint = selectedStat
        ? PERCENTAGE_ONLY_SET.has(selectedStat)
            ? 'Added directly to stat value (e.g. +30% crit on a 70% crit ship = 100% crit)'
            : 'Applied as a multiplier to the final stat (e.g. +45% attack on 10 000 = 14 500)'
        : '';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedStat) return;
        const value: FleetBuff = { stat: selectedStat, percentage };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedStat('');
        setPercentage(0);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-theme-text-secondary">
                Add a buff that boosts this ship&apos;s stats during combat (e.g. a commander or
                fleet ability). The scorer will account for it when choosing gear.
            </p>
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    options={ALL_STAT_NAMES.map((key) => ({
                        value: key,
                        label: STATS[key].label,
                    }))}
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as StatName)}
                    noDefaultSelection
                />
                <div className="w-24">
                    <Input
                        label="Percentage"
                        type="number"
                        min="0"
                        step="1"
                        value={percentage}
                        onChange={(e) => setPercentage(parseFloat(e.target.value))}
                    />
                </div>
            </div>
            {hint && <p className="text-xs text-theme-text-secondary">{hint}</p>}
            <div className="flex justify-end gap-2 mt-auto">
                {editingValue ? (
                    <>
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!selectedStat} variant="primary">
                            Save
                        </Button>
                    </>
                ) : (
                    <Button type="submit" disabled={!selectedStat} variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
