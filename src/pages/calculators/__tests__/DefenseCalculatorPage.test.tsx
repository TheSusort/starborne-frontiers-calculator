import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

    // Carried from Task 9: `bestShip` (the reduce behind the `isBest` highlight) had NO test. Before
    // the fix this epic made, the ranking was INVERTED for survivors — a tankier ship reported a
    // SMALLER measured figure and lost the "Best ship configuration" marker to the weaker one. This
    // test gives two configs deliberately lopsided defence (0 vs 20,000, plus HP as a safety margin
    // against exact-formula assumptions) under identical enemy pressure, so one dies on round 1 and
    // the other survives the whole window — driving their measured EHP figures far enough apart that
    // the comparison can't tie. It asserts the SURVIVOR (the one that withstood more raw damage)
    // carries the marker, not the casualty.
    it('gives the best-ship marker to the config that withstands more raw damage, not less', async () => {
        renderDefenseCalculatorPage();

        // Add a second config. Both still read the same default hp/defense at this point, so
        // `getAllByLabelText` unambiguously returns [ship1, ship2] in render order.
        fireEvent.click(screen.getByRole('button', { name: 'Add Ship' }));

        const hpInputs = screen.getAllByLabelText('HP');
        const defenseInputs = screen.getAllByLabelText('Defense');
        expect(hpInputs).toHaveLength(2);
        expect(defenseInputs).toHaveLength(2);

        // Config 1 ("Ship 1"): fragile — dies to the first hit.
        fireEvent.change(hpInputs[0], { target: { value: '50' } });
        fireEvent.change(defenseInputs[0], { target: { value: '0' } });
        // Config 2 ("Ship 2"): effectively unkillable — outlasts the whole round window.
        fireEvent.change(hpInputs[1], { target: { value: '999999999' } });
        fireEvent.change(defenseInputs[1], { target: { value: '20000' } });

        // Add one enemy attacker so there is pressure to measure at all.
        fireEvent.click(screen.getByText(/Combat Settings/i));
        fireEvent.click(screen.getByRole('button', { name: /Add Enemy/i }));

        const survivorNote = await screen.findByText(/Survived all/i);
        const destroyedNote = screen.getByText(/Destroyed round/i);

        const survivorCard = survivorNote.closest('.card');
        const destroyedCard = destroyedNote.closest('.card');
        expect(survivorCard).not.toBeNull();
        expect(destroyedCard).not.toBeNull();
        expect(survivorCard).not.toBe(destroyedCard);

        // The tankier config (the survivor) must carry the marker; the one that died first must not.
        expect(
            within(survivorCard as HTMLElement).getByText('Best ship configuration')
        ).toBeInTheDocument();
        expect(
            within(destroyedCard as HTMLElement).queryByText('Best ship configuration')
        ).not.toBeInTheDocument();
    });
});
