import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SimulatorPage from '../SimulatorPage';

// Heavy contexts are mocked: this is a render smoke that verifies the page mounts with the
// two placement boards and a Run button (placement + Run wiring — playback is Task 3/4).
vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters: [], loading: false }),
}));
vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../hooks/useShipsData', () => ({ useShipsData: () => ({ ships: [] }) }));
vi.mock('../../components/seo/Seo', () => ({ default: () => null }));

// The page autosaves its setup to localStorage and restores it on mount, so a setup left
// behind by one test would load itself into the next one's boards.
beforeEach(() => localStorage.clear());

describe('SimulatorPage', () => {
    it('renders the page title, two placement boards, and a Run button', () => {
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Combat Simulator')).toBeInTheDocument();
        // One FormationGrid per side (player + enemy), each root has role="grid".
        expect(screen.getAllByRole('grid')).toHaveLength(2);
        expect(screen.getByRole('button', { name: /Run Simulation/i })).toBeInTheDocument();
    });

    it('renders the seed and run-count controls', () => {
        render(
            <MemoryRouter>
                <SimulatorPage />
            </MemoryRouter>
        );
        // Exact labels: the stat sweep panel carries its own seed-count field.
        expect(screen.getByLabelText('Seed')).toBeInTheDocument();
        expect(screen.getByLabelText('Runs')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /new seed/i })).toBeInTheDocument();
    });
});
