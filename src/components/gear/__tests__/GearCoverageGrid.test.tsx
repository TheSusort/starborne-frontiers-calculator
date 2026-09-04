import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GearCoverageGrid } from '../GearCoverageGrid';
import { buildCoverageMatrix } from '../../../utils/gear/roleSlotCoverage';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { GEAR_SLOT_ORDER, GEAR_SLOTS } from '../../../constants/gearTypes';
import { GearPiece } from '../../../types/gear';

function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

describe('GearCoverageGrid', () => {
    it('renders one column header per gear slot', () => {
        render(<GearCoverageGrid matrix={buildCoverageMatrix([])} onCellClick={() => {}} />);
        for (const slot of GEAR_SLOT_ORDER) {
            expect(screen.getByText(GEAR_SLOTS[slot].label)).toBeInTheDocument();
        }
    });

    it('renders one row per role', () => {
        render(<GearCoverageGrid matrix={buildCoverageMatrix([])} onCellClick={() => {}} />);
        for (const role of Object.keys(SHIP_TYPES)) {
            expect(screen.getByText(SHIP_TYPES[role].name)).toBeInTheDocument();
        }
    });

    it('shows the level-16 count and priority in each cell', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' }), makeGear({ id: 'b' })]);
        render(<GearCoverageGrid matrix={matrix} onCellClick={() => {}} />);
        const cell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        expect(cell).toHaveTextContent('2');
        expect(cell).toHaveTextContent('%');
    });

    it('reports the role and slot when a cell is clicked', async () => {
        const onCellClick = vi.fn();
        render(<GearCoverageGrid matrix={buildCoverageMatrix([])} onCellClick={onCellClick} />);
        await userEvent.click(screen.getByTestId('coverage-cell-DEFENDER-hull'));
        expect(onCellClick).toHaveBeenCalledWith('DEFENDER', 'hull');
    });

    it('lists rows in the matrix role order, not the static one', () => {
        const matrix = buildCoverageMatrix([]);
        const reordered = {
            ...matrix,
            roleOrder: [...matrix.roleOrder].reverse(),
        };
        render(<GearCoverageGrid matrix={reordered} onCellClick={() => {}} />);
        const labels = screen.getAllByTestId(/^coverage-role-/);
        expect(labels[0]).toHaveTextContent(SHIP_TYPES[reordered.roleOrder[0]].name);
    });
});
