import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Ship } from '../../types/ship';
// vi.mock calls below are hoisted above these imports, so the page import is safe here.
import SimulatorPage from '../SimulatorPage';
import { SETUP_STORAGE_KEYS } from '../../utils/simulator/setupStorage';

const fakeShip = { id: 'fake-ship', name: 'Fake' } as unknown as Ship;

// Stands in for the real board: exposes the two callbacks the page drives and renders the ship
// ids it was handed, so a restored board is observable.
vi.mock('../../components/simulator/PlacementBoard', () => ({
    default: ({
        title,
        formation,
        onSelectPosition,
        onPickShip,
        onRemoveShip,
    }: {
        title: string;
        formation: { shipId: string }[];
        onSelectPosition: (p: 'T1') => void;
        onPickShip: (s: Ship) => void;
        onRemoveShip: (p: 'T1') => void;
    }) => (
        <div>
            <button onClick={() => onSelectPosition('T1')}>select {title}</button>
            <button onClick={() => onPickShip(fakeShip)}>pick {title}</button>
            <button onClick={() => onRemoveShip('T1')}>remove {title}</button>
            <span data-testid={`formation-${title}`}>
                {formation.map((entry) => entry.shipId).join(',')}
            </span>
        </div>
    ),
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

beforeEach(() => localStorage.clear());

describe('SimulatorPage setup autosave', () => {
    it('brings both boards back on a remount, without the user saving anything', async () => {
        const first = renderPage();
        fireEvent.click(screen.getByText(/select Your Team/i));
        fireEvent.click(screen.getByText(/pick Your Team/i));
        fireEvent.click(screen.getByText(/select Enemy Team/i));
        fireEvent.click(screen.getByText(/pick Enemy Team/i));

        await waitFor(() =>
            expect(localStorage.getItem(SETUP_STORAGE_KEYS.autosave)).not.toBeNull()
        );
        first.unmount();

        renderPage();
        await waitFor(() =>
            expect(screen.getByTestId('formation-Your Team (1)')).toHaveTextContent('fake-ship')
        );
        expect(screen.getByTestId('formation-Enemy Team (1)')).toHaveTextContent('fake-ship');
    });

    it('leaves out a ship that no longer resolves and says how many it skipped', async () => {
        localStorage.setItem(
            SETUP_STORAGE_KEYS.autosave,
            JSON.stringify({
                version: 1,
                name: '(autosave)',
                playerBoard: { T1: { shipId: fakeShip.id }, M2: { shipId: 'deleted-ship' } },
                enemyBoard: {},
                seed: 1,
                runCount: 1,
                savedAt: 1,
            })
        );

        renderPage();
        expect(screen.getByTestId('formation-Your Team (1)')).toHaveTextContent('fake-ship');
        expect(await screen.findByText(/could no longer be found/i)).toHaveTextContent(/^1 ship /);
    });

    it('does not overwrite a stored setup whose ships all failed to resolve', async () => {
        const stored = {
            version: 1,
            name: '(autosave)',
            playerBoard: { T1: { shipId: 'not-loaded-yet' } },
            enemyBoard: {},
            seed: 1,
            runCount: 1,
            savedAt: 1,
        };
        localStorage.setItem(SETUP_STORAGE_KEYS.autosave, JSON.stringify(stored));

        renderPage();
        expect(await screen.findByText(/could no longer be found/i)).toBeInTheDocument();
        // Long enough for the debounced write to have fired had it been allowed to.
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(JSON.parse(localStorage.getItem(SETUP_STORAGE_KEYS.autosave) ?? 'null')).toEqual(
            stored
        );
    });
});

describe('SimulatorPage named setups', () => {
    it('saves the current boards under a name and loads them back', async () => {
        renderPage();
        fireEvent.click(screen.getByText(/select Your Team/i));
        fireEvent.click(screen.getByText(/pick Your Team/i));
        expect(screen.getByTestId('formation-Your Team (1)')).toHaveTextContent('fake-ship');

        fireEvent.change(screen.getByLabelText(/setup name/i), { target: { value: 'Wave 3' } });
        fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
        await waitFor(() => expect(localStorage.getItem(SETUP_STORAGE_KEYS.saved)).not.toBeNull());

        // The board must actually be EMPTY before the load, or the final assertion passes
        // whether or not loading does anything.
        fireEvent.click(screen.getByText(/remove Your Team/i));
        expect(screen.getByTestId('formation-Your Team')).toHaveTextContent('');

        fireEvent.click(screen.getByRole('button', { name: /saved setups/i }));
        fireEvent.click(screen.getByRole('option', { name: 'Wave 3' }));
        fireEvent.click(screen.getByRole('button', { name: /load/i }));
        expect(screen.getByTestId('formation-Your Team (1)')).toHaveTextContent('fake-ship');
    });
});
