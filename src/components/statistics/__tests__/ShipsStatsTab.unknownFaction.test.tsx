import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipsStatsTab } from '../ShipsStatsTab';
import { Ship } from '../../../types/ship';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project (see StatPriorityForm.test.tsx).
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

// recharts' ResponsiveContainer needs real layout dimensions that jsdom doesn't provide; render
// a passthrough so the chart composition itself is exercised without measuring (see
// HealingTimelineChart.test.tsx for the same workaround).
vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        BarChart: Pass,
        PieChart: Pass,
        Bar: Pass,
        Pie: Pass,
        Cell: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({
        bg: '#111827',
        bgLighter: '#1f2937',
        border: '#374151',
        primary: '#ec8c37',
        primaryHover: '#f7b06e',
        text: '#e5e7eb',
        textSecondary: '#9ca3af',
        accent: '#ec8c37',
        gridStroke: '#374151',
        axisStroke: '#9ca3af',
    }),
}));

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
    id: 'ship-1',
    name: 'Test Ship',
    rarity: 'common',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    baseStats: {
        hp: 1000,
        attack: 100,
        defence: 100,
        hacking: 100,
        security: 100,
        crit: 20,
        critDamage: 150,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    ...overrides,
});

describe('ShipsStatsTab — unknown faction (#567)', () => {
    it('shows the raw faction string with no crash when the faction is outside FACTIONS', () => {
        render(<ShipsStatsTab ships={[makeShip({ faction: 'NOT_A_REAL_FACTION' })]} />);
        expect(screen.getByText('NOT_A_REAL_FACTION')).toBeInTheDocument();
    });
});
