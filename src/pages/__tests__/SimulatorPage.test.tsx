import { describe, it, expect, vi } from 'vitest';
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
        expect(screen.getByRole('button', { name: /Run/i })).toBeInTheDocument();
    });
});
