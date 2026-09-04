import React from 'react';
import { SHIP_TYPES, ShipTypeName } from '../../constants/shipTypes';
import { GEAR_SLOTS, GEAR_SLOT_ORDER, GearSlotName } from '../../constants/gearTypes';
import { CoverageCell, CoverageMatrix } from '../../utils/gear/roleSlotCoverage';

interface Props {
    matrix: CoverageMatrix;
    onCellClick: (role: ShipTypeName, slot: GearSlotName) => void;
}

// Colour buckets by rank within the slot column, worst-covered first. Rank is
// used rather than the raw headroom so the scale stays informative for a player
// whose whole inventory is thin, or whose whole inventory is deep.
const RANK_CLASSES = [
    'bg-red-900/70 text-red-100',
    'bg-orange-800/70 text-orange-100',
    'bg-yellow-800/60 text-yellow-100',
    'bg-lime-800/60 text-lime-100',
    'bg-green-800/60 text-green-100',
];

function rankClass(rank: number, roleCount: number): string {
    const bucket = Math.min(
        RANK_CLASSES.length - 1,
        Math.floor(((rank - 1) / roleCount) * RANK_CLASSES.length)
    );
    return RANK_CLASSES[bucket];
}

const CoverageCellButton: React.FC<{
    cell: CoverageCell;
    roleCount: number;
    onClick: () => void;
}> = ({ cell, roleCount, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        data-testid={`coverage-cell-${cell.role}-${cell.slot}`}
        aria-label={`${SHIP_TYPES[cell.role].name} ${GEAR_SLOTS[cell.slot].label}: ${cell.count} at level 16, ${Math.round(cell.priority * 100)} percent headroom`}
        className={`rounded-sm px-1 py-1.5 text-center transition-opacity hover:opacity-80 ${rankClass(cell.rank, roleCount)}`}
    >
        <span className="block text-xs font-semibold">{cell.count}</span>
        <span className="block text-xxs opacity-80">{Math.round(cell.priority * 100)}%</span>
    </button>
);

export const GearCoverageGrid: React.FC<Props> = ({ matrix, onCellClick }) => {
    const roleCount = matrix.roleOrder.length;

    return (
        <div className="card space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                <h3 className="text-lg font-medium">Coverage</h3>
                <span className="text-xs text-theme-text-secondary">
                    Level-16 pieces owned, and how much better your best one is than the next 19.
                    High percentages are worth farming; low ones are already saturated.
                </span>
            </div>
            <div className="text-xs text-theme-text-secondary">
                Colour ranks each slot column: reddest has the most headroom in that column,
                greenest is the most saturated.
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
                            className="text-xxs uppercase tracking-wide text-theme-text-secondary text-center pb-1"
                        >
                            {GEAR_SLOTS[slot].label}
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
                                    roleCount={roleCount}
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
