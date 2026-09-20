import React from 'react';
import { Button, CloseIcon, EditIcon } from '../ui';
import type { CustomFormulaRow } from '../../types/autogear';
import type { BaseStats } from '../../types/stats';
import { getLimitStatLabel } from '../../constants';
import { resolveLimitStatValue } from '../../utils/autogear/priorityScore';
import { isBasisTilt } from '../../utils/autogear/customFormula';

const IMPORTANCE_LABEL: Record<string, string> = {
    '0.5': 'Slight',
    '1': 'Normal',
    '2': 'Heavy',
};

/** A row's basis is only ever honoured by the scorer on a `core`/`max` row (`usableBasis`'s own
 *  gate) — mirrored here so the summary never shows terms the scorer would ignore. */
const showsBasis = (row: CustomFormulaRow): boolean =>
    row.kind === 'core' && row.direction === 'max';

const basisIntro = (row: CustomFormulaRow): string =>
    isBasisTilt(row.stat)
        ? 'Tilt — Defence already shapes Effective HP through mitigation:'
        : "This ship's own equation:";

interface Props {
    row: CustomFormulaRow;
    isEditing: boolean;
    /** Current build's stats, for the zero-stat note. Null when no ship is selected. */
    shipStats: BaseStats | null;
    /** True when this is the only core row and there are no bonus rows. */
    isLoneCoreRow: boolean;
    onEdit: () => void;
    onRemove: () => void;
}

export const CustomFormulaRowView: React.FC<Props> = ({
    row,
    isEditing,
    shipStats,
    isLoneCoreRow,
    onEdit,
    onRemove,
}) => {
    const value = shipStats ? resolveLimitStatValue(shipStats, row.stat) : null;
    // A maximized core row on a stat the build has none of scores every candidate 0, which
    // ties the whole search. The live score shows the symptom; this note gives the cause.
    const zeroesTheFormula = row.kind === 'core' && row.direction === 'max' && value === 0;
    const basisTerms = showsBasis(row) ? (row.basis ?? []) : [];
    const excludedNote = row.excludedNote ?? [];

    return (
        <div className="space-y-1">
            <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
                <span className="text-xs uppercase tracking-wide text-theme-text-secondary w-16">
                    {row.kind === 'core' ? 'Core' : 'Bonus'}
                </span>
                <span>
                    {getLimitStatLabel(row.stat)}
                    <span className="text-theme-text-secondary">
                        {row.direction === 'min' ? ' — as little as possible' : ''}
                    </span>
                    {row.kind === 'core' && !isLoneCoreRow && (
                        <span className="text-theme-text-secondary">
                            {' '}
                            · {IMPORTANCE_LABEL[String(row.importance ?? 1)]}
                        </span>
                    )}
                    {row.kind === 'bonus' && (
                        <span className="text-theme-text-secondary">
                            {' '}
                            · {row.percentage ?? 100}%
                        </span>
                    )}
                    {zeroesTheFormula && (
                        <span className="text-amber-400">
                            {' '}
                            — 0 on this ship, so the formula scores 0 until gear supplies it
                        </span>
                    )}
                    {isEditing && (
                        <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                    )}
                </span>
                <Button
                    aria-label="Edit formula stat"
                    title="Edit formula stat"
                    variant="secondary"
                    size="sm"
                    onClick={onEdit}
                    className="ml-auto"
                >
                    <EditIcon />
                </Button>
                <Button
                    aria-label="Remove formula stat"
                    variant="danger"
                    size="sm"
                    onClick={onRemove}
                >
                    <CloseIcon />
                </Button>
            </div>
            {excludedNote.length > 0 && (
                <div className="pl-16 space-y-0.5">
                    {excludedNote.map((note, index) => (
                        <p key={index} className="text-xs text-amber-400">
                            {note}
                        </p>
                    ))}
                </div>
            )}
            {basisTerms.length > 0 && (
                <p className="pl-16 text-xs text-theme-text-secondary">
                    {basisIntro(row)}{' '}
                    {basisTerms
                        .map((term) => `${getLimitStatLabel(term.stat)} x${term.weight.toFixed(3)}`)
                        .join(' + ')}
                </p>
            )}
        </div>
    );
};
