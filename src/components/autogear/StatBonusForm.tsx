import React, { useEffect, useState, useRef } from 'react';
import { Button, Select, Input, Tooltip } from '../ui';
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
    const additiveRef = useRef<HTMLSpanElement>(null);
    const multiplierRef = useRef<HTMLSpanElement>(null);
    const [showAdditiveTip, setShowAdditiveTip] = useState(false);
    const [showMultiplierTip, setShowMultiplierTip] = useState(false);

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

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-theme-text-secondary">
                Make scoring scale with another stat. Pick Additive or Multiplier below.
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

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <span className="block text-xs uppercase tracking-wide text-theme-text-secondary mb-1">
                        Mode
                    </span>
                    <div className="flex gap-2">
                        <span
                            ref={additiveRef}
                            onMouseEnter={() => setShowAdditiveTip(true)}
                            onMouseLeave={() => setShowAdditiveTip(false)}
                        >
                            <Button
                                type="button"
                                variant={mode === 'additive' ? 'primary' : 'secondary'}
                                onClick={() => setMode('additive')}
                            >
                                Additive
                            </Button>
                        </span>
                        <Tooltip
                            isVisible={showAdditiveTip}
                            targetElement={additiveRef.current}
                            className="bg-dark border border-dark-lighter p-2 max-w-xs"
                        >
                            <p className="text-xs">
                                Adds stat × % directly to the role score (e.g. defense @ 80% for a
                                skill dealing 80% of defense as damage).
                            </p>
                        </Tooltip>
                        <span
                            ref={multiplierRef}
                            onMouseEnter={() => setShowMultiplierTip(true)}
                            onMouseLeave={() => setShowMultiplierTip(false)}
                        >
                            <Button
                                type="button"
                                variant={mode === 'multiplier' ? 'primary' : 'secondary'}
                                onClick={() => setMode('multiplier')}
                            >
                                Multiplier
                            </Button>
                        </span>
                        <Tooltip
                            isVisible={showMultiplierTip}
                            targetElement={multiplierRef.current}
                            className="bg-dark border border-dark-lighter p-2 max-w-xs"
                        >
                            <p className="text-xs">
                                Multiplies the role score by stat × % (e.g. hacking @ 50% makes DPS
                                scale with hacking).
                            </p>
                        </Tooltip>
                    </div>
                </div>
                {editingValue ? (
                    <div className="flex gap-2">
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!selectedStat} variant="primary">
                            Save
                        </Button>
                    </div>
                ) : (
                    <Button type="submit" disabled={!selectedStat} variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
