import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';

// Heavy contexts and the chart library are mocked: this is a render smoke that verifies the page
// mounts with its default ship config and that the Advanced section hosts the skill editor —
// mirroring the HealingCalculatorPage.test.tsx render-harness conventions.
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
vi.mock('../../../components/ship/ShipSelector', () => ({ ShipSelector: () => null }));
vi.mock('../../../components/seo/Seo', () => ({ default: () => null }));
vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff', bg: '#000' }),
}));

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ComposedChart: Pass,
        LineChart: Pass,
        ScatterChart: Pass,
        Bar: () => null,
        Line: () => null,
        Scatter: () => null,
        LabelList: () => null,
        Customized: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

const renderDefenseCalculatorPage = () =>
    render(
        <MemoryRouter>
            <DefenseCalculatorPage />
        </MemoryRouter>
    );

describe('DefenseCalculatorPage', () => {
    it('renders the page with a default ship config', () => {
        renderDefenseCalculatorPage();
        expect(screen.getByText('Defense Calculator')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Ship 1')).toBeInTheDocument();
    });

    it('a blank config exposes editable skill slots', () => {
        renderDefenseCalculatorPage();
        // The Advanced section hosts the skill editor; a blank config still has editable slots.
        fireEvent.click(screen.getByText(/Show Advanced/i));
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('Charged')).toBeInTheDocument();
    });

    it('reports a measured EHP once an attacker applies pressure', async () => {
        renderDefenseCalculatorPage();
        fireEvent.click(screen.getByText(/Combat Settings/i));
        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));
        expect(await screen.findByText(/Measured EHP/i)).toBeInTheDocument();
    });
});
