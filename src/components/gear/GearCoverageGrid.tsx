import React from 'react';
import { SHIP_TYPES, ShipTypeName } from '../../constants/shipTypes';
import { GEAR_SLOTS, GEAR_SLOT_ORDER, GearSlotName } from '../../constants/gearTypes';
import {
    COVERAGE_MIN_LEVEL,
    CoverageCell,
    CoverageMatrix,
} from '../../utils/gear/roleSlotCoverage';
import { COVERAGE_SAMPLE_SIZE_STEPS } from '../../hooks/usePersistedCoverageSampleSize';
import { Select } from '../ui';

interface Props {
    matrix: CoverageMatrix;
    onCellClick: (role: ShipTypeName, slot: GearSlotName) => void;
    /** How many of a slot's best pieces to sample per (role, slot) cell. */
    sampleSize: number;
    onSampleSizeChange: (value: number) => void;
}

const SAMPLE_SIZE_OPTIONS = COVERAGE_SAMPLE_SIZE_STEPS.map((step) => ({
    value: String(step),
    label: String(step),
}));

/**
 * Colour buckets by the cell's own `priority` value on a fixed absolute
 * scale, so the same percentage is the same colour in every column and
 * colour can never disagree with the number shown. `cell.rank` (competition
 * rank within its slot column) still drives role-card and slot-tab order
 * elsewhere — it is deliberately not used for colour here, since a tied
 * column (e.g. every role at 0%) would otherwise paint its rank-1 entries
 * the reddest class despite there being nothing to farm.
 */
function priorityClass(priority: number): string {
    if (priority >= 0.5) return 'bg-red-900/70 text-red-100';
    if (priority >= 0.3) return 'bg-orange-800/70 text-orange-100';
    if (priority >= 0.15) return 'bg-yellow-800/60 text-yellow-100';
    if (priority >= 0.05) return 'bg-lime-800/60 text-lime-100';
    return 'bg-green-800/60 text-green-100';
}

const CoverageCellButton: React.FC<{
    cell: CoverageCell;
    onClick: () => void;
}> = ({ cell, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        data-testid={`coverage-cell-${cell.role}-${cell.slot}`}
        aria-label={`${SHIP_TYPES[cell.role].name} ${GEAR_SLOTS[cell.slot].label}: ${Math.round(cell.priority * 100)} percent priority to farm`}
        className={`rounded-sm px-1 py-2 text-center transition-opacity hover:opacity-80 ${priorityClass(cell.priority)}`}
    >
        <span className="block text-sm font-semibold">{Math.round(cell.priority * 100)}%</span>
    </button>
);

export const GearCoverageGrid: React.FC<Props> = ({
    matrix,
    onCellClick,
    sampleSize,
    onSampleSizeChange,
}) => {
    const firstRole = matrix.roleOrder[0];

    return (
        <div className="card space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="space-y-1">
                    <h3 className="text-lg font-medium">Coverage</h3>
                    <span className="text-xs text-theme-text-secondary block">
                        Level-16 pieces owned, and how much farming each role and slot would pay
                        off. A high percentage means it would help; a low one means you are close to
                        the best you can get.
                    </span>
                </div>
                <div className="w-full sm:w-40 shrink-0">
                    <Select
                        label="Target pieces per slot"
                        value={String(sampleSize)}
                        onChange={(value) => onSampleSizeChange(Number(value))}
                        options={SAMPLE_SIZE_OPTIONS}
                        data-testid="coverage-sample-size-select"
                    />
                </div>
            </div>
            <div className="text-xs text-theme-text-secondary">
                Colour reflects the percentage directly, on a fixed scale, so it means the same
                thing in every column.
            </div>

            <div className="overflow-x-auto">
                <div
                    className="grid gap-1 min-w-max"
                    style={{
                        gridTemplateColumns: `minmax(9rem, auto) repeat(${GEAR_SLOT_ORDER.length}, minmax(3.5rem, 1fr))`,
                    }}
                >
                    <div className="sticky left-0 bg-dark z-10" />
                    {GEAR_SLOT_ORDER.map((slot) => (
                        <div
                            key={slot}
                            data-testid={`coverage-header-${slot}`}
                            className="text-xxs uppercase tracking-wide text-theme-text-secondary text-center pb-1"
                        >
                            <div>{GEAR_SLOTS[slot].label}</div>
                            <div className="normal-case opacity-80">
                                {matrix.cells[firstRole][slot].count} at {COVERAGE_MIN_LEVEL}
                            </div>
                        </div>
                    ))}

                    {matrix.roleOrder.map((role) => (
                        <React.Fragment key={role}>
                            <div
                                data-testid={`coverage-role-${role}`}
                                className="sticky left-0 bg-dark z-10 pr-2 flex items-center justify-end text-xs text-theme-text-secondary"
                            >
                                {SHIP_TYPES[role].name}
                            </div>
                            {GEAR_SLOT_ORDER.map((slot) => (
                                <CoverageCellButton
                                    key={slot}
                                    cell={matrix.cells[role][slot]}
                                    onClick={() => onCellClick(role, slot)}
                                />
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            </div>
        </div>
    );
};
