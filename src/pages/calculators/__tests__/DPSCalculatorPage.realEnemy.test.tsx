import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DPSCalculatorPage from '../DPSCalculatorPage';
import * as dpsSimulator from '../../../utils/calculators/dpsSimulator';

// Same heavy-context harness as HealingCalculatorPage.test.tsx.
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
        BarChart: Pass,
        Bar: () => null,
        Line: () => null,
        XAxis: () => null,
        YAxis: () => null,
        ZAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        Legend: () => null,
        Cell: () => null,
        Scatter: () => null,
        ScatterChart: Pass,
        ResponsiveContainer: Pass,
        Customized: () => null,
        Rectangle: () => null,
        Text: () => null,
        ReferenceLine: () => null,
        LabelList: () => null,
    };
});

describe('DPSCalculatorPage supplies a real positioned enemy', () => {
    it('always passes a non-empty enemyAttackers with positions on BOTH sides', () => {
        // The page's wiring is otherwise untested: every simulateDPS golden calls the sim directly
        // with scalar inputs, so none of them exercises what the page actually passes.
        const spy = vi.spyOn(dpsSimulator, 'simulateDPS');

        render(
            <MemoryRouter>
                <DPSCalculatorPage />
            </MemoryRouter>
        );

        expect(spy).toHaveBeenCalled();
        const input = spy.mock.calls.at(-1)?.[0];

        // A real enemy is what flips the engine's `dpsEnemyTarget` false.
        expect(input?.enemyAttackers?.length).toBeGreaterThan(0);
        // BOTH positions are required: `isPositional` needs the actor's own slot AND an opposing
        // one, else selectTurnTarget silently falls back to the vestigial dummy.
        expect(input?.position).toBeDefined();
        expect(input?.enemyAttackers?.[0]?.position).toBeDefined();
        // The enemy carries a real HP/defence so it is a genuine damage target, not a sink.
        expect(input?.enemyAttackers?.[0]?.stats.hp).toBeGreaterThan(0);

        // Attack defaults to 0 so the attacker takes no damage out of the box and every config
        // faces identical conditions. Note the trade-off this locks in: a 0-attack enemy emits no
        // `attacked` events at all, so on-attacked / counter / reflect kits do NOT fire until the
        // user raises this. Changing the default flips that behaviour for everyone — deliberate
        // decision required, hence the assertion.
        expect(input?.enemyAttackers?.[0]?.stats.attack).toBe(0);

        spy.mockRestore();
    });

    it('renders the enemy panel and results without throwing', () => {
        render(
            <MemoryRouter>
                <DPSCalculatorPage />
            </MemoryRouter>
        );
        expect(screen.getByText('DPS Calculator')).toBeInTheDocument();
        expect(screen.getByText('Enemy Target')).toBeInTheDocument();
    });
});
