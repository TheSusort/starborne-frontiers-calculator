import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ship } from '../../types/ship';
import type { Position } from '../../types/encounters';
// vi.mock calls below are hoisted above these imports, so the page import is safe here.
import SimulatorPage from '../SimulatorPage';
import { SETUP_STORAGE_KEYS } from '../../utils/simulator/setupStorage';
import { SMALL_GRID_POSITIONS } from '../../utils/targeting/board';

const fakeShip = { id: 'fake-ship', name: 'Fake' } as unknown as Ship;

// Stands in for the real board: renders the cells it may use and where its ships stand, and
// exposes the writes the page takes from a board.
vi.mock('../../components/simulator/PlacementBoard', () => ({
    default: ({
        title,
        formation,
        cells,
        onSelectPosition,
        onPickShip,
        onLoadEncounter,
        onCopyToOtherSide,
    }: {
        title: string;
        formation: { position: Position }[];
        cells?: readonly Position[];
        onSelectPosition: (p: Position) => void;
        onPickShip: (s: Ship) => void;
        onLoadEncounter: (board: Record<string, { ship: Ship }>) => void;
        onCopyToOtherSide: () => void;
    }) => {
        const side = title.startsWith('Your') ? 'player' : 'enemy';
        return (
            <div>
                <button onClick={() => onSelectPosition('T1')}>select T1 {side}</button>
                <button onClick={() => onPickShip(fakeShip)}>pick {side}</button>
                <button
                    onClick={() =>
                        onLoadEncounter({
                            T1: { ship: fakeShip },
                            T4: { ship: fakeShip },
                            B4: { ship: fakeShip },
                        })
                    }
                >
                    load {side}
                </button>
                <button
                    onClick={() =>
                        onLoadEncounter(
                            Object.fromEntries(
                                ['T1', 'T2', 'T3', 'T4', 'M1', 'M2', 'M3', 'M4'].map((p) => [
                                    p,
                                    { ship: fakeShip },
                                ])
                            )
                        )
                    }
                >
                    load eight {side}
                </button>
                <button onClick={onCopyToOtherSide}>copy {side}</button>
                <span data-testid={`cells-${side}`}>{(cells ?? []).length}</span>
                <span data-testid={`positions-${side}`}>
                    {formation
                        .map((f) => f.position)
                        .sort()
                        .join(',')}
                </span>
            </div>
        );
    },
}));

vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: [fakeShip],
        getShipById: (id: string) => (id === fakeShip.id ? fakeShip : undefined),
    }),
}));
vi.mock('../../hooks/useShipsData', () => ({ useShipsData: () => ({ ships: [] }) }));
vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../utils/ship/combatStats', () => ({
    shipFinalStats: () => ({}),
    combatStatsFromShip: () => ({}),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <SimulatorPage />
        </MemoryRouter>
    );

const chooseGrid = (label: 'Normal (12 cells)' | 'Small grid (7 cells)') => {
    fireEvent.click(screen.getByLabelText('Board'));
    fireEvent.click(screen.getByRole('option', { name: label }));
};

const positions = (side: 'player' | 'enemy') =>
    screen.getByTestId(`positions-${side}`).textContent?.split(',').filter(Boolean) ?? [];

/** The tripwire: every ship on both sides stands on the small grid. */
const expectAllOnSmallGrid = () => {
    for (const side of ['player', 'enemy'] as const) {
        for (const p of positions(side)) expect(SMALL_GRID_POSITIONS).toContain(p);
    }
};

beforeEach(() => localStorage.clear());

describe('SimulatorPage small grid', () => {
    it('switching moves ships off the grid onto free cells and says so', () => {
        renderPage();
        expect(screen.getByTestId('cells-player')).toHaveTextContent('12');
        fireEvent.click(screen.getByText('load player'));
        expect(positions('player')).toEqual(['B4', 'T1', 'T4']);

        chooseGrid('Small grid (7 cells)');
        expect(screen.getByTestId('cells-player')).toHaveTextContent('7');
        expect(screen.getByTestId('cells-enemy')).toHaveTextContent('7');
        expect(positions('player')).toHaveLength(3);
        expectAllOnSmallGrid();
        expect(screen.getByText('3 ships moved onto the small grid.')).toBeInTheDocument();
    });

    it('keeps every later write on the grid: a loaded encounter, a copy, a picked cell', () => {
        renderPage();
        chooseGrid('Small grid (7 cells)');
        fireEvent.click(screen.getByText('load enemy'));
        expectAllOnSmallGrid();
        expect(positions('enemy')).toHaveLength(3);

        fireEvent.click(screen.getByText('copy enemy'));
        expect(positions('player')).toHaveLength(3);
        expectAllOnSmallGrid();
    });

    it('refuses to switch while a team has more ships than the small grid holds', () => {
        renderPage();
        fireEvent.click(screen.getByText('load eight player'));
        chooseGrid('Small grid (7 cells)');
        expect(screen.getByTestId('cells-player')).toHaveTextContent('12');
        expect(positions('player')).toHaveLength(8);
        expect(screen.getByText(/holds 7 ships per team/)).toBeInTheDocument();
    });

    it('a loaded encounter too big for the small grid keeps seven and says how many were left out', () => {
        renderPage();
        chooseGrid('Small grid (7 cells)');
        fireEvent.click(screen.getByText('load eight player'));
        expect(positions('player')).toHaveLength(7);
        expectAllOnSmallGrid();
        expect(screen.getByText(/1 ship did not fit on the small grid/)).toBeInTheDocument();
    });

    it('switching back to normal leaves the ships where they are', () => {
        renderPage();
        chooseGrid('Small grid (7 cells)');
        fireEvent.click(screen.getByText('load player'));
        const onGrid = positions('player');
        chooseGrid('Normal (12 cells)');
        expect(screen.getByTestId('cells-player')).toHaveTextContent('12');
        expect(positions('player')).toEqual(onGrid);
    });

    it('restores the grid with the autosave, fitting a stored board that is off it', async () => {
        localStorage.setItem(
            SETUP_STORAGE_KEYS.autosave,
            JSON.stringify({
                version: 1,
                name: '(autosave)',
                playerBoard: { T1: { shipId: fakeShip.id } },
                enemyBoard: { M3: { shipId: fakeShip.id } },
                seed: 1,
                runCount: 1,
                gridMode: 'small',
                savedAt: 1,
            })
        );
        renderPage();
        await waitFor(() => expect(screen.getByTestId('cells-player')).toHaveTextContent('7'));
        // T1's nearest small-grid cells are T2 and M2; it keeps its row.
        expect(positions('player')).toEqual(['T2']);
        expect(positions('enemy')).toEqual(['M3']);

        await waitFor(() =>
            expect(
                JSON.parse(localStorage.getItem(SETUP_STORAGE_KEYS.autosave) ?? '{}')
            ).toMatchObject({ gridMode: 'small', playerBoard: { T2: { shipId: fakeShip.id } } })
        );
    });

    it('a stored setup without the field opens on the normal board', () => {
        localStorage.setItem(
            SETUP_STORAGE_KEYS.autosave,
            JSON.stringify({
                version: 1,
                name: '(autosave)',
                playerBoard: { T1: { shipId: fakeShip.id } },
                enemyBoard: {},
                seed: 1,
                runCount: 1,
                savedAt: 1,
            })
        );
        renderPage();
        expect(screen.getByTestId('cells-player')).toHaveTextContent('12');
        expect(positions('player')).toEqual(['T1']);
    });
});
