import React from 'react';
import { SHIP_TYPES, ShipTypeName } from '../../constants/shipTypes';
import { GEAR_SLOTS, GEAR_SLOT_ORDER, GearSlotName } from '../../constants/gearTypes';
import {
    COVERAGE_MIN_LEVEL,
    CoverageCell,
    CoverageMatrix,
    TIE_EPSILON,
} from '../../utils/gear/roleSlotCoverage';
import { COVERAGE_SAMPLE_SIZE_STEPS } from '../../hooks/usePersistedCoverageSampleSize';
import { usePersistedPreference } from '../../hooks/usePersistedPreference';
import { Select, CollapsibleAccordion, ChevronDownIcon } from '../ui';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const COVERAGE_GRID_CONTENT_ID = 'gear-coverage-grid-content';

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
 * Five colour classes, lowest priority (least worth farming) to highest.
 * `priorityClass` picks an index into this by where a cell's priority sits
 * between the grid's own min and max, so the band names stay fixed while
 * what counts as "the reddest 20%" moves with the grid.
 */
const PRIORITY_CLASSES = [
    'bg-green-800/60 text-green-100',
    'bg-lime-800/60 text-lime-100',
    'bg-yellow-800/60 text-yellow-100',
    'bg-orange-800/70 text-orange-100',
    'bg-red-900/70 text-red-100',
];

const NEUTRAL_PRIORITY_CLASS = PRIORITY_CLASSES[2];

/**
 * Colour buckets a cell by where its priority sits between the lowest and
 * highest priority actually present in the grid (`min`/`max`), not by a
 * fixed absolute scale. Raising "Target pieces per slot" raises every
 * priority, so a fixed scale saturates: at a high target every cell clears
 * the old top threshold and the whole grid renders one colour, discarding
 * the real spread that is still there. `cell.rank` (competition rank within
 * its slot column) still drives role-card and slot-tab order elsewhere — it
 * is deliberately not used for colour here.
 *
 * A degenerate range (`max - min` within `TIE_EPSILON`, the coverage
 * module's own tie tolerance) must not divide by ~zero or fall through to
 * an extreme class: every cell renders the neutral middle band instead.
 * This is the specific failure of the rank-based scheme removed earlier in
 * this branch — it gave every tied cell rank 1 and painted a fully-tied
 * column entirely red — and it must not reappear in this new form.
 */
function priorityClass(priority: number, min: number, max: number): string {
    const range = max - min;
    if (range <= TIE_EPSILON) return NEUTRAL_PRIORITY_CLASS;

    const t = (priority - min) / range;
    const index = Math.min(PRIORITY_CLASSES.length - 1, Math.floor(t * PRIORITY_CLASSES.length));
    return PRIORITY_CLASSES[index];
}

const CoverageCellButton: React.FC<{
    cell: CoverageCell;
    min: number;
    max: number;
    onClick: () => void;
}> = ({ cell, min, max, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        data-testid={`coverage-cell-${cell.role}-${cell.slot}`}
        aria-label={`${SHIP_TYPES[cell.role].name} ${GEAR_SLOTS[cell.slot].label}: ${Math.round(cell.priority * 100)} percent priority to farm`}
        className={`rounded-sm px-1 py-2 text-center transition-opacity hover:opacity-80 ${priorityClass(cell.priority, min, max)}`}
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
    const hasRoles = matrix.roleOrder.length > 0;
    const firstRole = matrix.roleOrder[0];
    const [isOpen, setIsOpen] = usePersistedPreference(
        'gear-coverage-grid-expanded',
        true,
        isBoolean
    );

    // Min/max across every cell, computed once per render rather than per
    // cell — `priorityClass` needs the whole grid's range to place a single
    // cell within it.
    const { min, max } = React.useMemo(() => {
        let min = Infinity;
        let max = -Infinity;
        for (const role of matrix.roleOrder) {
            for (const slot of GEAR_SLOT_ORDER) {
                const { priority } = matrix.cells[role][slot];
                if (priority < min) min = priority;
                if (priority > max) max = priority;
            }
        }
        return { min, max };
    }, [matrix]);

    return (
        // `card` supplies the border/background; padding is zeroed here and
        // owned separately by the toggle button and by `CollapsibleAccordion`
        // (which wraps its own children in `p-4 bg-dark`) so the two don't
        // stack into a double-padded, double-backgrounded gap between them.
        <div className="card p-0">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-controls={COVERAGE_GRID_CONTENT_ID}
                aria-label="Coverage grid"
                data-testid="coverage-grid-toggle"
                className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-dark-lighter transition-colors"
            >
                <h3 className="text-lg font-medium">Coverage</h3>
                <ChevronDownIcon
                    className={`w-4 h-4 text-theme-text-secondary flex-shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                    }`}
                />
            </button>
            <CollapsibleAccordion isOpen={isOpen} id={COVERAGE_GRID_CONTENT_ID}>
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <span className="text-xs text-theme-text-secondary block">
                            Level-16 pieces owned, and how much farming each role and slot would pay
                            off. A high percentage means it would help; a low one means you are
                            close to the best you can get.
                        </span>
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
                        Colour is relative to the highest- and lowest-priority cells in your own
                        grid; the percentage shown on each cell is always the absolute value.
                    </div>

                    {hasRoles ? (
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
                                            {matrix.cells[firstRole][slot].count} at{' '}
                                            {COVERAGE_MIN_LEVEL}
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
                                                min={min}
                                                max={max}
                                                onClick={() => onCellClick(role, slot)}
                                            />
                                        ))}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    ) : (
                        // No role has a row to show (an empty `shipRoles`, or a Role
                        // Filter that excludes every role). The per-slot header counts
                        // read from the first row's cells, so there is nothing safe to
                        // show there either — render a plain empty state instead.
                        <div
                            data-testid="coverage-grid-empty"
                            className="text-xs text-theme-text-secondary text-center py-4"
                        >
                            No roles to show coverage for.
                        </div>
                    )}
                </div>
            </CollapsibleAccordion>
        </div>
    );
};
