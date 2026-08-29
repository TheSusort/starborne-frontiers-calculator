/**
 * #426 — the DPS page must pass the picked ship's NAME into `simulateDPS`.
 *
 * The engine's `ally-on-team` gate (Isha/Nayra's reciprocal Affinity Override) goes live only when
 * `nameByActorId` is non-empty, and that map is fed from `input.name` / `teamActors[].name`. The
 * unit coverage in `utils/calculators/__tests__/allyOnTeamGate.test.ts` proves the ADAPTER honours
 * those fields; this file covers the half that adapter tests cannot see — whether the page sets
 * them at all, which is where the defect actually lived.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DPSCalculatorPage from '../DPSCalculatorPage';
import * as dpsSimulator from '../../../utils/calculators/dpsSimulator';
import type { Ship } from '../../../types/ship';

const NAYRA: Ship = {
    id: 'nayra-1',
    name: 'Nayra',
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Defender',
    baseStats: {} as Ship['baseStats'],
    equipment: {},
    implants: {},
    refits: [],
};

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: [],
        getShipById: (id: string) => (id === 'nayra-1' ? NAYRA : undefined),
    }),
}));
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({ getEngineeringStatsForShipType: () => undefined }),
}));
vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: () => {} }),
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

describe('#426 DPSCalculatorPage threads the picked ship name', () => {
    it('passes the SHIP name (not the display label) as `name`', () => {
        const spy = vi.spyOn(dpsSimulator, 'simulateDPS');

        render(
            <MemoryRouter initialEntries={['/dps?shipId=nayra-1']}>
                <DPSCalculatorPage />
            </MemoryRouter>
        );

        expect(spy).toHaveBeenCalled();
        const names = spy.mock.calls.map(([input]) => input.name);
        expect(names).toContain('Nayra');
        // The config's display label happens to equal the ship name when a ship is picked, so the
        // discriminating assertion is the manual case below — a label must never leak through.
        spy.mockRestore();
    });

    it('leaves `name` undefined for a manual config (assume-met fallback preserved)', () => {
        const spy = vi.spyOn(dpsSimulator, 'simulateDPS');

        // No ?shipId= → the page seeds a manual config whose display label is "Ship 1". Passing
        // that through would switch the gate live with a name no kit can match, which is worse
        // than the assume-met fallback it replaced.
        render(
            <MemoryRouter initialEntries={['/dps']}>
                <DPSCalculatorPage />
            </MemoryRouter>
        );

        expect(spy).toHaveBeenCalled();
        for (const [input] of spy.mock.calls) {
            expect(input.name).toBeUndefined();
        }
        spy.mockRestore();
    });
});
