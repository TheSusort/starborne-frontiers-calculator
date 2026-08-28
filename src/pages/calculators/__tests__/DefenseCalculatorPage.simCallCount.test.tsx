import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DefenseCalculatorPage from '../DefenseCalculatorPage';
import { simulateDefenseSurvivability } from '../../../utils/calculators/defenseSurvivabilitySim';
import type { Ship } from '../../../types/ship';

// This file exists to answer a question the sibling DefenseCalculatorPage.test.tsx cannot: HOW
// OFTEN does the sim actually run. The memo used to depend on the whole `configs` array, so an
// edit to a config's NAME — a field the sim never reads — re-ran a full engine simulation per
// config on every keystroke. Spying on `simulateDefenseSurvivability` itself (rather than
// asserting on rendered output) is the only boundary that can observe that at all.
const mockGetShipById = vi.fn((_id: string): Ship | undefined => undefined);

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: mockGetShipById }),
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

vi.mock('../../../utils/calculators/defenseSurvivabilitySim', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../../utils/calculators/defenseSurvivabilitySim')>();
    return { ...actual, simulateDefenseSurvivability: vi.fn(actual.simulateDefenseSurvivability) };
});

const simSpy = vi.mocked(simulateDefenseSurvivability);

const renderPage = () =>
    render(
        <MemoryRouter>
            <DefenseCalculatorPage />
        </MemoryRouter>
    );

describe('DefenseCalculatorPage sim call count', () => {
    // Braced, not `() => simSpy.mockClear()`: `mockClear()` returns the mock itself for chaining,
    // and Vitest treats a function RETURNED from `beforeEach` as a teardown callback to invoke
    // after the test — with zero arguments. An arrow expression body here would silently register
    // `simSpy` as its own post-test cleanup hook and crash the real implementation on `input`
    // being `undefined`.
    beforeEach(() => {
        simSpy.mockClear();
    });

    it('editing a config NAME runs zero simulations', () => {
        renderPage();
        simSpy.mockClear();
        const nameInput = screen.getAllByDisplayValue(/Ship|Configuration/i)[0];
        fireEvent.change(nameInput, { target: { value: 'Tanky McTankface' } });
        expect(simSpy).toHaveBeenCalledTimes(0);
    });

    it('editing HP runs the sim (the instrument can report non-zero)', () => {
        renderPage();
        simSpy.mockClear();
        const hp = screen.getByLabelText('HP');
        fireEvent.change(hp, { target: { value: '50000' } });
        expect(simSpy.mock.calls.length).toBeGreaterThan(0);
    });
});
