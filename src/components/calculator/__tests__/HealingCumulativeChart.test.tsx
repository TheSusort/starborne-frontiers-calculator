import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { isValidElement, ReactElement, ReactNode } from 'react';
import { HealingCumulativeChart } from '../HealingCumulativeChart';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

// Capture each <Line>'s props so the test can invoke its custom `dot` render-prop directly to
// assert the per-config death dot — recharts renders nothing measurable in jsdom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineProps: any[] = [];

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        LineChart: Pass,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Line: (props: any) => {
            lineProps.push(props);
            return null;
        },
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

vi.mock('../ui/charts', () => ({
    BaseChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    CHART_LINE_COLORS: ['#aaa', '#bbb'],
    LINE_CHART_MARGIN: {},
    chartLineDefaults: () => ({}),
}));

const makeResult = (destroyedRound?: number): HealingSimulationResult => ({
    rounds: [baseRound(1), baseRound(2), baseRound(3)],
    summary: {
        totalHealing: 0,
        totalDirectHeal: 0,
        totalHotHeal: 0,
        totalShield: 0,
        totalCleanses: 0,
        totalEffectiveHealing: 0,
        totalOverheal: 0,
        totalShieldAbsorbed: 0,
        totalIncomingDamage: 0,
        avgHealingPerRound: 0,
        ...(destroyedRound !== undefined ? { destroyedRound } : {}),
    },
});

const baseRound = (round: number): HealingSimulationResult['rounds'][number] => ({
    round,
    action: 'active',
    charges: 0,
    chargeCount: 0,
    didCrit: false,
    directHeal: 0,
    hotHeal: 0,
    shield: 0,
    cleanseCount: 0,
    effectiveHealing: 1000,
    overheal: 0,
    incomingDamage: 0,
    shieldAbsorbed: 0,
    targetHpPct: 100,
    targetShieldPool: 0,
    totalRoundHealing: 1000,
    cumulativeHealing: 1000 * round,
    activeSelfBuffs: [],
});

describe('HealingCumulativeChart death dot', () => {
    it('renders a death dot at the config destroyedRound and nothing on other rounds', () => {
        lineProps.length = 0;
        render(
            <HealingCumulativeChart
                healers={[{ id: 'h1', name: 'Healer 1', result: makeResult(2) }]}
                rounds={3}
            />
        );
        const line = lineProps.find((p) => p.dataKey === 'h1');
        expect(typeof line.dot).toBe('function');
        // The death dot renders only at index 1 (round 2); other indices render an empty group.
        const atDeath = line.dot({ cx: 5, cy: 5, index: 1 }) as ReactElement<{
            children?: ReactNode;
        }>;
        const elsewhere = line.dot({ cx: 5, cy: 5, index: 0 }) as ReactElement<{
            children?: ReactNode;
        }>;
        expect(isValidElement(atDeath)).toBe(true);
        // The death marker is a <g> with children (the ringed circle); the empty one has none.
        expect(atDeath.props.children).toBeTruthy();
        expect(elsewhere.props.children).toBeFalsy();
    });

    it('renders no death dot when the config survives (dot stays false)', () => {
        lineProps.length = 0;
        render(
            <HealingCumulativeChart
                healers={[{ id: 'h1', name: 'Healer 1', result: makeResult() }]}
                rounds={3}
            />
        );
        const line = lineProps.find((p) => p.dataKey === 'h1');
        expect(line.dot).toBe(false);
    });
});
