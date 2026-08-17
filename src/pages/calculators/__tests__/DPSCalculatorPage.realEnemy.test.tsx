import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('threads BOTH raw affinities into simulateDPS (focus config and enemy roster entry)', () => {
        // Task 5 fixed a regression where the page resolved affinity into a single scalar
        // (`affinityDamageModifier`) and stopped there — the positional damage path recomputes the
        // matchup per victim from the RAW `affinity` fields, so that scalar alone was inert and the
        // page's affinity selection stopped affecting damage. Nothing else in this suite exercises
        // the wiring: reverting either `affinity:` line in DPSCalculatorPage.tsx leaves `tsc` clean
        // and every other test in this directory green, so this is the only guard.
        const spy = vi.spyOn(dpsSimulator, 'simulateDPS');

        render(
            <MemoryRouter>
                <DPSCalculatorPage />
            </MemoryRouter>
        );

        // Drive the focus ship's own affinity picker (inside the config card's "Affinity" section)
        // to a non-default value so its presence in the sim call is unambiguous — 'chemical' can't
        // be confused with the 'antimatter' default a removed wire-up would silently keep emitting.
        fireEvent.click(screen.getByTestId('config-affinity-select'));
        fireEvent.click(screen.getByText('Chemical'));

        // Drive the enemy's affinity picker to a different non-default value.
        fireEvent.click(screen.getByLabelText('Enemy Affinity'));
        fireEvent.click(screen.getByText('Electric'));

        expect(spy).toHaveBeenCalled();
        const input = spy.mock.calls.at(-1)?.[0];

        expect(input?.affinity).toBe('chemical');
        expect(input?.enemyAttackers?.[0]?.affinity).toBe('electric');

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
