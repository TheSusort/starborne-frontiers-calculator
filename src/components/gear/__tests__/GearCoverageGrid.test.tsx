import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GearCoverageGrid } from '../GearCoverageGrid';
import {
    buildCoverageMatrix,
    CoverageCell,
    CoverageMatrix,
} from '../../../utils/gear/roleSlotCoverage';
import { SHIP_TYPES, ShipTypeName } from '../../../constants/shipTypes';
import { GEAR_SLOT_ORDER, GEAR_SLOTS, GearSlotName } from '../../../constants/gearTypes';
import { GearPiece } from '../../../types/gear';

// The grid imports Select from the '../ui' barrel, which pulls in Sidebar,
// whose favicon.ico?url asset import is not available in the test
// environment.
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

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

/**
 * A CoverageMatrix fixture built directly (not through `buildCoverageMatrix`)
 * so ranks and priorities can be set independently per cell. Every cell
 * defaults to priority 0.5 / rank 1 / count 10; pass overrides keyed
 * `"ROLE:slot"` to control specific cells.
 */
function makeMatrix(overrides: Record<string, Partial<CoverageCell>> = {}): CoverageMatrix {
    const roles: ShipTypeName[] = Object.keys(SHIP_TYPES);
    const cells: Record<ShipTypeName, Record<GearSlotName, CoverageCell>> = {};
    for (const role of roles) {
        cells[role] = {};
        for (const slot of GEAR_SLOT_ORDER) {
            cells[role][slot] = {
                role,
                slot,
                count: 10,
                priority: 0.5,
                rank: 1,
                ...overrides[`${role}:${slot}`],
            };
        }
    }
    const slotOrderByRole: Record<ShipTypeName, GearSlotName[]> = {};
    for (const role of roles) slotOrderByRole[role] = [...GEAR_SLOT_ORDER];
    return { cells, roleOrder: roles, slotOrderByRole };
}

describe('GearCoverageGrid', () => {
    it('renders one column header per gear slot', () => {
        render(
            <GearCoverageGrid
                matrix={buildCoverageMatrix([])}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        for (const slot of GEAR_SLOT_ORDER) {
            expect(screen.getByText(GEAR_SLOTS[slot].label)).toBeInTheDocument();
        }
    });

    it('renders one row per role', () => {
        render(
            <GearCoverageGrid
                matrix={buildCoverageMatrix([])}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        for (const role of Object.keys(SHIP_TYPES)) {
            expect(screen.getByText(SHIP_TYPES[role].name)).toBeInTheDocument();
        }
    });

    it('shows the level-16 count once per column, in the header, not the cell', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' }), makeGear({ id: 'b' })]);
        render(
            <GearCoverageGrid
                matrix={matrix}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );

        const weaponCount = matrix.cells.ATTACKER.weapon.count;
        expect(screen.getByTestId('coverage-header-weapon')).toHaveTextContent(String(weaponCount));

        const cell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        const expectedPriority = `${Math.round(matrix.cells.ATTACKER.weapon.priority * 100)}%`;
        expect(cell.textContent).toBe(expectedPriority);
    });

    it("names the role, slot and priority in a cell's aria-label, without a count", () => {
        const matrix = makeMatrix({ 'ATTACKER:weapon': { priority: 0.42, count: 188, rank: 1 } });
        render(
            <GearCoverageGrid
                matrix={matrix}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        const cell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        expect(cell).toHaveAccessibleName(/Attacker/);
        expect(cell).toHaveAccessibleName(/Weapon/);
        expect(cell).toHaveAccessibleName(/42 percent/);
        expect(cell.getAttribute('aria-label')).not.toMatch(/188/);
    });

    it('reports the role and slot when a cell is clicked', async () => {
        const onCellClick = vi.fn();
        render(
            <GearCoverageGrid
                matrix={buildCoverageMatrix([])}
                onCellClick={onCellClick}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        await userEvent.click(screen.getByTestId('coverage-cell-DEFENDER-hull'));
        expect(onCellClick).toHaveBeenCalledWith('DEFENDER', 'hull');
    });

    it('lists rows in the matrix role order, not the static one', () => {
        const matrix = buildCoverageMatrix([]);
        const reordered = {
            ...matrix,
            roleOrder: [...matrix.roleOrder].reverse(),
        };
        render(
            <GearCoverageGrid
                matrix={reordered}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        const labels = screen.getAllByTestId(/^coverage-role-/);
        expect(labels[0]).toHaveTextContent(SHIP_TYPES[reordered.roleOrder[0]].name);
    });

    it('colours a cell from its own priority value, not its rank within the column', () => {
        // Two cells share the same 20% priority but sit at opposite ranks in
        // different (12-role) columns — value-based colour must treat them
        // the same. Rank 1 vs. rank 12 also differ enough under the OLD
        // rank-bucketing code (bucket 0 vs. bucket 4) to make this a real
        // discriminator, not an accidental pass.
        const matrix = makeMatrix({
            'ATTACKER:weapon': { priority: 0.2, rank: 1 },
            'DEFENDER:hull': { priority: 0.2, rank: 12 },
            // Rank 1 (top of its column) but 0% priority: a tied, fully-covered
            // column must NOT render as the reddest "farm this now" colour.
            'SUPPORTER:generator': { priority: 0, rank: 1 },
        });
        render(
            <GearCoverageGrid
                matrix={matrix}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );

        const weaponCell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        const hullCell = screen.getByTestId('coverage-cell-DEFENDER-hull');
        const zeroCell = screen.getByTestId('coverage-cell-SUPPORTER-generator');

        expect(weaponCell.className).toContain('bg-yellow-800/60');
        expect(hullCell.className).toContain('bg-yellow-800/60');

        expect(zeroCell.className).toContain('bg-green-800/60');
        expect(zeroCell.className).not.toContain('bg-red-900/70');
    });

    describe('sample size control', () => {
        it('shows the current sample size in a labelled control', () => {
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={100}
                    onSampleSizeChange={() => {}}
                />
            );
            expect(
                screen.getByRole('button', { name: 'Target pieces per slot' })
            ).toHaveTextContent('100');
        });

        it('reports the chosen sample size as a number when an option is picked', () => {
            const onSampleSizeChange = vi.fn();
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={onSampleSizeChange}
                />
            );
            fireEvent.click(screen.getByLabelText('Target pieces per slot'));
            fireEvent.click(screen.getByRole('option', { name: '100' }));
            expect(onSampleSizeChange).toHaveBeenCalledWith(100);
            expect(onSampleSizeChange).not.toHaveBeenCalledWith('100');
        });

        it('offers the fixed steps 10, 20, 50, 100 and 200', () => {
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={() => {}}
                />
            );
            fireEvent.click(screen.getByLabelText('Target pieces per slot'));
            const optionLabels = screen.getAllByRole('option').map((option) => option.textContent);
            expect(optionLabels).toEqual(['10', '20', '50', '100', '200']);
        });
    });
});
