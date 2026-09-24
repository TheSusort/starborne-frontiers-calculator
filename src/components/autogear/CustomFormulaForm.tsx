import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '../ui';
import type { LimitableStat } from '../../types/stats';
import type {
    BasisTerm,
    CoreImportance,
    CustomFormulaRow,
    FormulaDirection,
    FormulaRowKind,
} from '../../types/autogear';
import { getLimitStatLabel } from '../../constants/stats';
import {
    FORMULA_STATS,
    coreImportanceOf,
    isBasisStat,
    isBasisTilt,
} from '../../utils/autogear/customFormula';
import { BasisTermsEditor } from './BasisTermsEditor';
import { draftFromBasis, nextBasisStat, type DraftBasisTerm } from './basisTermDraft';

const IMPORTANCE_OPTIONS: { value: string; label: string }[] = [
    { value: '0.5', label: 'Slight' },
    { value: '1', label: 'Normal' },
    { value: '2', label: 'Heavy' },
];

const basisHelpText = (stat: LimitableStat): string =>
    isBasisTilt(stat)
        ? 'Defence already drives Effective HP through mitigation, so a term here is a deliberate tilt toward that stat, not a transcribed number.'
        : "Replaces this row's value with a weighted sum of stats, in the ship's own kit numbers — e.g. Attack x2.100 for a 210% skill.";

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
    const [basisTerms, setBasisTerms] = useState<DraftBasisTerm[]>([]);

    useEffect(() => {
        if (editingValue) {
            setStat(editingValue.stat);
            setKind(editingValue.kind);
            setDirection(editingValue.direction);
            setImportance(coreImportanceOf(editingValue));
            setPercentage(String(editingValue.percentage ?? 100));
            setBasisTerms(draftFromBasis(editingValue.basis));
        } else {
            setStat(FORMULA_STATS[0]);
            setKind('core');
            setDirection('max');
            setImportance(1);
            setPercentage('100');
            setBasisTerms([]);
        }
    }, [editingValue]);

    // A basis is only ever honoured by the scorer on a `core`/`max` row — this mirrors
    // `usableBasis`'s own gate, so the picker never offers a control the scorer would ignore
    // and never withholds one it would honour.
    const showsBasis = kind === 'core' && direction === 'max';

    const addBasisTerm = () => {
        setBasisTerms([...basisTerms, { stat: nextBasisStat(basisTerms), weight: '' }]);
    };

    const updateBasisTerm = (index: number, patch: Partial<DraftBasisTerm>) => {
        setBasisTerms(basisTerms.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    };

    const removeBasisTerm = (index: number) => {
        setBasisTerms(basisTerms.filter((_, i) => i !== index));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // A basis term the scorer would drop (bad stat, non-finite, negative, or zero weight)
        // fails the whole submit rather than being silently accepted. Zero is rejected here even
        // though `usableBasis` (customFormula.ts) would keep it: a core/max row MULTIPLIES its
        // term into the row's score, so a zero-weight term — typically an unfilled field, since
        // `Number('')` is 0 — doesn't just drop out, it zeroes the whole row for every candidate
        // and ties the search. The bonus percentage branch below has the matching guard for its
        // own field: bonus terms ADD rather than multiply, so 0 there stays a legitimate "add
        // nothing" and blank instead defaults to 100.
        let basis: BasisTerm[] | undefined;
        if (showsBasis && basisTerms.length > 0) {
            const parsed: BasisTerm[] = [];
            for (const term of basisTerms) {
                const weight = Number(term.weight.trim());
                if (!isBasisStat(term.stat) || !Number.isFinite(weight) || weight <= 0) {
                    return;
                }
                parsed.push({ stat: term.stat, weight });
            }
            basis = parsed;
        }

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
        if (basis) {
            row.basis = basis;
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
        setBasisTerms([]);
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
            {showsBasis && (
                <div className="space-y-2 border-t border-dark-border pt-3">
                    <p className="text-xs text-theme-text-secondary">{basisHelpText(stat)}</p>
                    <BasisTermsEditor
                        terms={basisTerms}
                        onUpdate={updateBasisTerm}
                        onRemove={removeBasisTerm}
                        onAdd={addBasisTerm}
                    />
                </div>
            )}
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
