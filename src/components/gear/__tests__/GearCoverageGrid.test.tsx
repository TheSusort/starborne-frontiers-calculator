import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// The grid's collapsed state is persisted via `usePersistedPreference`,
// which reads `useAuth`.
let mockUser: { id: string } | null = null;
let mockLoading = false;
vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: mockUser, loading: mockLoading }),
}));

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
    beforeEach(() => {
        localStorage.clear();
        mockUser = null;
        mockLoading = false;
    });

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

    it('spans the full colour scale when every priority sits in a narrow high band', () => {
        // Target 100 on a real inventory compresses every cell into ~49%-89%
        // (see PR description) — a fixed absolute scale saturates there and
        // paints the grid one colour. Colouring by this grid's own min/max
        // must still use both ends of the scale even though the raw spread
        // (0.09) is narrow.
        const matrix = makeMatrix({
            'ATTACKER:weapon': { priority: 0.8 },
            'DEFENDER:hull': { priority: 0.89 },
        });
        // Every other cell defaults to priority 0.5 in `makeMatrix`, so pull
        // them into the same narrow band the two probes sit in.
        for (const role of Object.keys(SHIP_TYPES)) {
            for (const slot of GEAR_SLOT_ORDER) {
                if (role === 'ATTACKER' && slot === 'weapon') continue;
                if (role === 'DEFENDER' && slot === 'hull') continue;
                matrix.cells[role][slot] = { ...matrix.cells[role][slot], priority: 0.85 };
            }
        }
        render(
            <GearCoverageGrid
                matrix={matrix}
                onCellClick={() => {}}
                sampleSize={100}
                onSampleSizeChange={() => {}}
            />
        );

        const lowCell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        const highCell = screen.getByTestId('coverage-cell-DEFENDER-hull');

        expect(lowCell.className).toContain('bg-green-800/60');
        expect(highCell.className).toContain('bg-red-900/70');
    });

    it('renders a fully-tied grid in one neutral colour, not the reddest extreme', () => {
        // Every cell at an identical priority (e.g. an empty inventory, or a
        // target so high every slot saturates) must not divide-by-zero its
        // way into painting everything the top colour — the rank-based
        // scheme this replaced did exactly that by giving every tied cell
        // rank 1.
        const matrix = makeMatrix({});
        for (const role of Object.keys(SHIP_TYPES)) {
            for (const slot of GEAR_SLOT_ORDER) {
                matrix.cells[role][slot] = { ...matrix.cells[role][slot], priority: 0.37 };
            }
        }
        render(
            <GearCoverageGrid
                matrix={matrix}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );

        const someCell = screen.getByTestId('coverage-cell-ATTACKER-weapon');
        const anotherCell = screen.getByTestId('coverage-cell-DEFENDER-hull');

        expect(someCell.className).toContain('bg-yellow-800/60');
        expect(someCell.className).not.toContain('bg-red-900/70');
        expect(anotherCell.className).toBe(someCell.className);
    });

    it('renders an empty state instead of crashing when roleOrder is empty', () => {
        // roleOrder is empty when shipRoles is empty, or (after the Role
        // Filter fix) when it excludes every role. The header counts used to
        // read `matrix.cells[roleOrder[0]]`, which has nothing to read from
        // once roleOrder has no first element.
        const matrix = makeMatrix();
        const empty = { ...matrix, roleOrder: [] };
        render(
            <GearCoverageGrid
                matrix={empty}
                onCellClick={() => {}}
                sampleSize={20}
                onSampleSizeChange={() => {}}
            />
        );
        expect(screen.getByTestId('coverage-grid-empty')).toBeInTheDocument();
        expect(screen.queryByTestId(/^coverage-role-/)).not.toBeInTheDocument();
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

    describe('collapsing', () => {
        it('is expanded by default, showing the grid', () => {
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={() => {}}
                />
            );
            expect(screen.getByTestId('coverage-grid-toggle')).toHaveAttribute(
                'aria-expanded',
                'true'
            );
            expect(screen.getByTestId('coverage-cell-DEFENDER-hull')).toBeVisible();
        });

        it('hides the grid when the header is toggled closed, and shows it again when reopened', async () => {
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={() => {}}
                />
            );
            const toggle = screen.getByTestId('coverage-grid-toggle');
            const cell = screen.getByTestId('coverage-cell-DEFENDER-hull');
            expect(cell).toBeVisible();

            await userEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-expanded', 'false');
            expect(cell).not.toBeVisible();

            await userEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-expanded', 'true');
            expect(cell).toBeVisible();
        });

        it('points aria-controls at the region it toggles', () => {
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={() => {}}
                />
            );
            const toggle = screen.getByTestId('coverage-grid-toggle');
            const controlsId = toggle.getAttribute('aria-controls');
            expect(controlsId).toBeTruthy();
            expect(document.getElementById(controlsId as string)).not.toBeNull();
        });

        it('adopts a stored collapsed state on mount', () => {
            mockUser = { id: 'user-1' };
            localStorage.setItem('gear-coverage-grid-expanded:user-1', 'false');
            render(
                <GearCoverageGrid
                    matrix={buildCoverageMatrix([])}
                    onCellClick={() => {}}
                    sampleSize={20}
                    onSampleSizeChange={() => {}}
                />
            );
            expect(screen.getByTestId('coverage-grid-toggle')).toHaveAttribute(
                'aria-expanded',
                'false'
            );
            expect(screen.getByTestId('coverage-cell-DEFENDER-hull')).not.toBeVisible();
        });
    });
});
