import React, { useEffect, useState } from 'react';
import { Button, CloseIcon, Input, Select } from '../ui';
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

const IMPORTANCE_OPTIONS: { value: string; label: string }[] = [
    { value: '0.5', label: 'Slight' },
    { value: '1', label: 'Normal' },
    { value: '2', label: 'Heavy' },
];

/** A term's stat picker offers only what `usableBasis` can honour — never `directDamage` or
 *  `effectiveHp`, which the scorer reads off the stat block as `undefined` and drops. */
const BASIS_STAT_OPTIONS = FORMULA_STATS.filter(isBasisStat).map((s) => ({
    value: s,
    label: getLimitStatLabel(s),
}));

/** A term's weight kept as a string while being edited, the same way the bonus percentage is,
 *  so a field can sit empty or mid-edit without forcing a number. */
interface DraftBasisTerm {
    stat: LimitableStat;
    weight: string;
}

const draftFromBasis = (basis?: BasisTerm[]): DraftBasisTerm[] =>
    (basis ?? []).map((t) => ({ stat: t.stat, weight: String(t.weight) }));

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

    // A basis is only ever honoured by the scorer on a `core`/`max` row (`usableBasis`'s own
    // gate) — mirrored here so the picker never offers a control the scorer would ignore.
    // Also gated on editing an existing row: a basis refines a row that already exists (Apply's
    // output, or a previously-added custom row), so a brand-new row is added plain and picks up
    // a basis on the next edit — that keeps this form's single "Add" control unambiguous from
    // the basis section's own "Add stat" control.
    const showsBasis = !!editingValue && kind === 'core' && direction === 'max';

    const addBasisTerm = () => {
        const used = new Set(basisTerms.map((t) => t.stat));
        const nextOption = BASIS_STAT_OPTIONS.find((o) => !used.has(o.value));
        const nextStat = nextOption?.value ?? BASIS_STAT_OPTIONS[0].value;
        setBasisTerms([...basisTerms, { stat: nextStat, weight: '' }]);
    };

    const updateBasisTerm = (index: number, patch: Partial<DraftBasisTerm>) => {
        setBasisTerms(basisTerms.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    };

    const removeBasisTerm = (index: number) => {
        setBasisTerms(basisTerms.filter((_, i) => i !== index));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // A basis term the scorer would drop (bad stat, negative or non-finite weight) fails
        // the whole submit rather than being silently stripped — the same contract as the
        // bonus percentage check below.
        let basis: BasisTerm[] | undefined;
        if (showsBasis && basisTerms.length > 0) {
            const parsed: BasisTerm[] = [];
            for (const term of basisTerms) {
                const weight = Number(term.weight.trim());
                if (!isBasisStat(term.stat) || !Number.isFinite(weight) || weight < 0) {
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
        // Never authored by hand — carried through unchanged from the row Apply produced, so
        // the clause it names is still visible after an unrelated edit (e.g. importance).
        if (editingValue?.excludedNote) {
            row.excludedNote = editingValue.excludedNote;
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
                    {editingValue?.excludedNote && editingValue.excludedNote.length > 0 && (
                        <div className="space-y-1">
                            {editingValue.excludedNote.map((note, index) => (
                                <p key={index} className="text-xs text-amber-400">
                                    {note}
                                </p>
                            ))}
                        </div>
                    )}
                    <p className="text-xs text-theme-text-secondary">{basisHelpText(stat)}</p>
                    {basisTerms.map((term, index) => (
                        <div key={index} className="flex gap-3 items-end flex-wrap">
                            <Select
                                label="Basis stat"
                                className="flex-1 min-w-[8rem]"
                                value={term.stat}
                                onChange={(value) =>
                                    updateBasisTerm(index, { stat: value as LimitableStat })
                                }
                                options={BASIS_STAT_OPTIONS}
                            />
                            <div className="w-32">
                                <Input
                                    label="Basis weight"
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={term.weight}
                                    onChange={(e) =>
                                        updateBasisTerm(index, { weight: e.target.value })
                                    }
                                    placeholder="0"
                                />
                            </div>
                            <Button
                                aria-label="Remove basis term"
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => removeBasisTerm(index)}
                            >
                                <CloseIcon />
                            </Button>
                        </div>
                    ))}
                    <Button
                        aria-label="Add stat"
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addBasisTerm}
                    >
                        Add stat
                    </Button>
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
