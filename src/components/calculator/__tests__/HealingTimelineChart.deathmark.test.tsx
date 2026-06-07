import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { HealingTimelineChart } from '../HealingTimelineChart';
import { HealingSimulationResult } from '../../../utils/calculators/healingEngineAdapter';

// Capture each <Line>'s props so the test can invoke its custom `dot` render-prop directly —
// the only way to assert the death marker, since recharts itself renders nothing in jsdom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineProps: any[] = [];
let referenceLines = 0;

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        ComposedChart: Pass,
        LineChart: Pass,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Line: (props: any) => {
            lineProps.push(props);
            return null;
        },
        Bar: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        Tooltip: () => null,
        ReferenceLine: () => {
            referenceLines++;
            return null;
        },
        ResponsiveContainer: Pass,
    };
});

vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

const makeResult = (destroyedRound?: number): HealingSimulationResult => ({
    rounds: [
        {
            round: 1,
            action: 'active',
            charges: 0,
            chargeCount: 0,
            didCrit: false,
            directHeal: 0,
            hotHeal: 0,
            shield: 0,
            cleanseCount: 0,
            effectiveHealing: 0,
            overheal: 0,
            incomingDamage: 9000,
            shieldAbsorbed: 0,
            targetHpPct: 100,
            targetShieldPool: 0,
            totalRoundHealing: 0,
            cumulativeHealing: 0,
            activeSelfBuffs: [],
        },
        {
            round: 2,
            action: 'active',
            charges: 0,
            chargeCount: 0,
            didCrit: false,
            directHeal: 0,
            hotHeal: 0,
            shield: 0,
            cleanseCount: 0,
            effectiveHealing: 0,
            overheal: 0,
            incomingDamage: 9000,
            shieldAbsorbed: 0,
            targetHpPct: 10,
            targetShieldPool: 0,
            totalRoundHealing: 0,
            cumulativeHealing: 0,
            activeSelfBuffs: [],
        },
    ],
    summary: {
        totalHealing: 0,
        totalDirectHeal: 0,
        totalHotHeal: 0,
        totalShield: 0,
        totalCleanses: 0,
        totalEffectiveHealing: 0,
        totalOverheal: 0,
        totalShieldAbsorbed: 0,
        totalIncomingDamage: 18000,
        avgHealingPerRound: 0,
        ...(destroyedRound !== undefined ? { destroyedRound } : {}),
    },
});

describe('HealingTimelineChart death mark', () => {
    it('renders a Destroyed marker only when the result has a destroyedRound', () => {
        lineProps.length = 0;
        referenceLines = 0;
        render(<HealingTimelineChart result={makeResult(2)} name="Healer 1" rounds={3} />);
        expect(referenceLines).toBe(1);
    });

    it('renders no marker when the target survives', () => {
        lineProps.length = 0;
        referenceLines = 0;
        render(<HealingTimelineChart result={makeResult()} name="Healer 1" rounds={3} />);
        expect(referenceLines).toBe(0);
    });
});
