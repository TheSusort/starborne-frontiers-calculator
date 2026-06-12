import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HealingCalculatorPage from '../HealingCalculatorPage';

// Heavy contexts and the chart library are mocked: this is a render smoke that verifies the page
// mounts with its panels and a default healer config, exercising the simulateHealing wiring.
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ComposedChart: Pass,
        LineChart: Pass,
        Bar: () => null,
        Line: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

describe('HealingCalculatorPage', () => {
    it('renders the page with panels and a default healer config', () => {
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('Healing Calculator')).toBeInTheDocument();
        expect(screen.getByText('Heal Target')).toBeInTheDocument();
        expect(screen.getByText(/Enemy Team/)).toBeInTheDocument();
        expect(screen.getByText('Team')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Healer 1')).toBeInTheDocument();
        // Results summary renders → simulateHealing ran without throwing (the StatCard title and
        // the timeline legend both surface "Effective Healing").
        expect(screen.getAllByText('Effective Healing').length).toBeGreaterThan(0);
        expect(screen.getByText('About the Simulation')).toBeInTheDocument();
    });

    it('removeEnemy: clicking X on the only enemy attacker reduces the count to 0', () => {
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );
        // Initially one enemy → count shows (1).
        expect(screen.getByText(/Enemy Team \(1\)/)).toBeInTheDocument();
        // Click the remove button for the first (and only) enemy attacker.
        fireEvent.click(screen.getByLabelText('Remove enemy'));
        // Guard removed → count now shows (0).
        expect(screen.getByText(/Enemy Team \(0\)/)).toBeInTheDocument();
    });
});
