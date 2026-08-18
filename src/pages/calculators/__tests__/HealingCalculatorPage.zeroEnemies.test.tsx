/**
 * The page must be able to REACH the zero-enemy scenario end to end. Before SP-4b-2b the roster was
 * floored at one because an empty one handed the run to the engine's vestigial dummy; the practice
 * target removed that reason, and this test is what keeps the floor from creeping back.
 *
 * Sibling split: `HealingCalculatorPage.test.tsx` owns the remove CONTROL (one button per card, all
 * the way down to zero). This file owns the CONSEQUENCE — that the emptied board still simulates and
 * still renders a result — which is the half a `> 0` guard somewhere in the display layer would
 * break. It is a separate file because that is the assertion most at risk of being quietly deleted
 * if it lived as one more line inside the control test.
 *
 * Mocks mirror `HealingCalculatorPage.test.tsx` exactly (heavy contexts + recharts), because the
 * page under test is the same one; only the scenario differs. Consolidating the two blocks into a
 * shared helper was attempted and abandoned: `vi.mock` is hoisted above imports by Vitest, so a call
 * made from inside an imported helper runs AFTER the module graph is already built and has no
 * effect — each spec file needs its own literal `vi.mock` calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HealingCalculatorPage from '../HealingCalculatorPage';
import type { Ship } from '../../../types/ship';

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

describe('HealingCalculatorPage with an empty enemy team', () => {
    it('lets the last enemy be removed and still renders a result', () => {
        render(
            <MemoryRouter>
                <HealingCalculatorPage />
            </MemoryRouter>
        );

        // PRECONDITION, so the assertions below cannot pass on a page that never had an enemy.
        expect(screen.getByText(/Enemy Team \(1\)/)).toBeInTheDocument();
        expect(screen.getAllByText('Effective Healing').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByLabelText('Remove enemy'));
        expect(screen.getByText(/Enemy Team \(0\)/)).toBeInTheDocument();

        // PRESENCE, never a number: a `> 0`-guarded display failure in this codebase shows up as a
        // vanished section, not as a wrong value. `simulateHealing` runs inside a `useMemo` during
        // render, so a throw on the empty roster would fail this render outright — which is the
        // other regression this guards: the engine boundary now REJECTS an empty roster outright
        // (`normalizeCombatRoster` throws, SP-4b-2b Task 3), and the practice target is the only
        // thing keeping this page out of that path.
        expect(screen.getAllByText('Effective Healing').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Overheal/).length).toBeGreaterThan(0);
        // The results panel is still the real thing, not an empty-state placeholder.
        expect(screen.getByText('About the Simulation')).toBeInTheDocument();
    });
});
