import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { LimitableStat } from '../../types/stats';
import type {
    CoreImportance,
    CustomFormulaRow,
    FormulaDirection,
    FormulaRowKind,
} from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';
import { FORMULA_STATS, coreImportanceOf } from '../../utils/autogear/customFormula';

const IMPORTANCE_OPTIONS: { value: string; label: string }[] = [
    { value: '0.5', label: 'Slight' },
    { value: '1', label: 'Normal' },
    { value: '2', label: 'Heavy' },
];

interface Props {
    onAdd: (row: CustomFormulaRow) => void;
    editingValue?: CustomFormulaRow;
    onSave?: (row: CustomFormulaRow) => void;
    onCancel?: () => void;
}

export const CustomFormulaForm: React.FC<Props> = ({ onAdd, editingValue, onSave, onCancel }) => {
    const [stat, setStat] = useState<LimitableStat>(FORMULA_STATS[0]);
    const [kind, setKind] = useState<FormulaRowKind>('core');
    const [direction, setDirection] = useState<FormulaDirection>('max');
    const [importance, setImportance] = useState<CoreImportance>(1);
    const [percentage, setPercentage] = useState<string>('100');

    useEffect(() => {
        if (editingValue) {
            setStat(editingValue.stat);
            setKind(editingValue.kind);
            setDirection(editingValue.direction);
            setImportance(coreImportanceOf(editingValue));
            setPercentage(String(editingValue.percentage ?? 100));
        } else {
            setStat(FORMULA_STATS[0]);
            setKind('core');
            setDirection('max');
            setImportance(1);
            setPercentage('100');
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        let row: CustomFormulaRow;
        if (kind === 'core') {
            row = { stat, kind, direction, importance };
        } else {
            const trimmed = percentage.trim();
            const parsedPercentage = trimmed === '' ? 100 : Number(trimmed);
            if (!Number.isFinite(parsedPercentage) || parsedPercentage < 0) {
                return;
            }
            row = { stat, kind, direction, percentage: parsedPercentage };
        }
        if (editingValue && onSave) {
            onSave(row);
            return;
        }
        onAdd(row);
        setStat(FORMULA_STATS[0]);
        setKind('core');
        setDirection('max');
        setImportance(1);
        setPercentage('100');
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3" role="form">
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    value={stat}
                    onChange={(value) => setStat(value as LimitableStat)}
                    options={FORMULA_STATS.map((s) => ({
                        value: s,
                        label: getLimitStatLabel(s),
                    }))}
                />
                <Select
                    label="Direction"
                    className="w-40"
                    value={direction}
                    onChange={(value) => setDirection(value as FormulaDirection)}
                    options={[
                        { value: 'max', label: 'As much as possible' },
                        { value: 'min', label: 'As little as possible' },
                    ]}
                />
            </div>
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="How it counts"
                    className="w-48"
                    value={kind}
                    onChange={(value) => setKind(value as FormulaRowKind)}
                    options={[
                        { value: 'core', label: 'Multiplied — must be good' },
                        { value: 'bonus', label: 'Added — nice to have' },
                    ]}
                    helpLabel="A multiplied stat has to be good on its own for the build to score well, so balanced builds win. An added stat tops the score up without being able to carry it."
                />
                {kind === 'core' ? (
                    <Select
                        label="Importance"
                        className="w-32"
                        value={String(importance)}
                        onChange={(value) => setImportance(Number(value) as CoreImportance)}
                        options={IMPORTANCE_OPTIONS}
                    />
                ) : (
                    <div className="w-32">
                        <Input
                            label="Weight %"
                            type="number"
                            min="0"
                            value={percentage}
                            onChange={(e) => setPercentage(e.target.value)}
                            placeholder="100"
                        />
                    </div>
                )}
            </div>
            <div className="flex justify-end gap-2">
                {editingValue ? (
                    <>
                        <Button
                            aria-label="Cancel edit"
                            type="button"
                            variant="secondary"
                            onClick={onCancel}
                        >
                            Cancel
                        </Button>
                        <Button aria-label="Save formula stat" type="submit" variant="primary">
                            Save
                        </Button>
                    </>
                ) : (
                    <Button aria-label="Add formula stat" type="submit" variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
