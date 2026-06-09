import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealingTimelineChart } from '../HealingTimelineChart';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

// recharts' ResponsiveContainer needs real layout dimensions that jsdom doesn't provide; render
// a passthrough so the chart composition itself is exercised without measuring.
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

vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

const result: HealingSimulationResult = {
    rounds: [
        {
            round: 1,
            action: 'active',
            charges: 0,
            chargeCount: 0,
            didCrit: false,
            directHeal: 5000,
            hotHeal: 0,
            shield: 0,
            cleanseCount: 0,
            effectiveHealing: 5000,
            overheal: 0,
            incomingDamage: 2000,
            shieldAbsorbed: 0,
            targetHpPct: 90,
            targetShieldPool: 0,
            totalRoundHealing: 5000,
            cumulativeHealing: 5000,
            activeSelfBuffs: [],
            enemyEffects: [],
        },
    ],
    summary: {
        totalHealing: 5000,
        totalDirectHeal: 5000,
        totalHotHeal: 0,
        totalShield: 0,
        totalCleanses: 0,
        totalEffectiveHealing: 5000,
        totalOverheal: 0,
        totalShieldAbsorbed: 0,
        totalIncomingDamage: 2000,
        avgHealingPerRound: 5000,
    },
};

describe('HealingTimelineChart', () => {
    it('renders without crashing and shows the config name and legend', () => {
        render(<HealingTimelineChart result={result} name="Healer 1" rounds={3} />);
        expect(screen.getByText(/Healer 1/)).toBeInTheDocument();
        expect(screen.getByText('Target HP %')).toBeInTheDocument();
        expect(screen.getByText('Effective Healing')).toBeInTheDocument();
        expect(screen.getByText('Incoming Damage')).toBeInTheDocument();
    });
});
