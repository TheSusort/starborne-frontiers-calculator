import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealingTimelineChart } from '../HealingTimelineChart';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../../utils/calculators/healingEngineAdapter';

// recharts' ResponsiveContainer needs real layout dimensions jsdom doesn't provide. Render a
// passthrough; the <Tooltip content={...}/> is captured so the enriched tooltip can be rendered
// in isolation and its per-round numbers asserted (mirroring the DPS RoundTooltip pattern).
let capturedTooltip: React.ReactElement | null = null;
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
        Tooltip: ({ content }: { content: React.ReactElement }) => {
            capturedTooltip = content;
            return null;
        },
        ResponsiveContainer: Pass,
    };
});

vi.mock('../../../hooks/useThemeColors', () => ({
    useThemeColors: () => ({ gridStroke: '#000', text: '#fff' }),
}));

const row = (over: Partial<HealingRoundData>): HealingRoundData => ({
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
    incomingDamage: 0,
    shieldAbsorbed: 0,
    targetHpPct: 100,
    targetShieldPool: 0,
    totalRoundHealing: 0,
    cumulativeHealing: 0,
    activeSelfBuffs: [],
    enemyEffects: [],
    ...over,
});

// Round 1: a crit active heal with HoT, shield, a cleanse, overheal, incoming damage.
// Round 2: a charged action, empty. Round 3: team healing present.
const result: HealingSimulationResult = {
    rounds: [
        row({
            round: 1,
            didCrit: true,
            directHeal: 5000,
            hotHeal: 1200,
            shield: 3000,
            cleanseCount: 2,
            effectiveHealing: 4800,
            overheal: 1400,
            incomingDamage: 2500,
            shieldAbsorbed: 1000,
            targetHpPct: 60,
            targetShieldPool: 2000,
            totalRoundHealing: 6200,
            cumulativeHealing: 6200,
        }),
        row({ round: 2, action: 'charged', chargeCount: 3, targetHpPct: 80 }),
        row({
            round: 3,
            directHeal: 2000,
            effectiveHealing: 2000,
            targetHpPct: 95,
            totalRoundHealing: 2000,
            cumulativeHealing: 8200,
            teamHealing: 1500,
        }),
    ],
    summary: {
        totalHealing: 8200,
        totalDirectHeal: 7000,
        totalHotHeal: 1200,
        totalShield: 3000,
        totalCleanses: 2,
        totalEffectiveHealing: 6800,
        totalOverheal: 1400,
        totalShieldAbsorbed: 1000,
        totalIncomingDamage: 2500,
        avgHealingPerRound: 2733,
    },
};

const noop = (id: string) => id;

describe('HealingTimelineChart', () => {
    it('renders without crashing and shows the config name and legend', () => {
        render(
            <HealingTimelineChart result={result} name="Healer 1" rounds={3} enemyName={noop} />
        );
        expect(screen.getByText(/Healer 1/)).toBeInTheDocument();
        expect(screen.getByText('Target HP %')).toBeInTheDocument();
        expect(screen.getByText('Effective Healing')).toBeInTheDocument();
        expect(screen.getByText('Incoming Damage')).toBeInTheDocument();
    });

    it('renders the right-hand enemy effects panel (hover-gated empty state)', () => {
        render(
            <HealingTimelineChart result={result} name="Healer 1" rounds={3} enemyName={noop} />
        );
        // The panel starts in the "Hover a round" state (no round hovered yet).
        expect(screen.getByText('Hover a round')).toBeInTheDocument();
    });

    describe('hover tooltip surfaces the per-round healer numbers', () => {
        const renderTooltip = (activeLabel: number) => {
            render(
                <HealingTimelineChart result={result} name="Healer 1" rounds={3} enemyName={noop} />
            );
            // capturedTooltip is the <TimelineTooltip result={...}/> element; drive it active.
            const Tooltip = capturedTooltip!.type as React.FC<{
                active?: boolean;
                label?: number;
                result: HealingSimulationResult;
            }>;
            const props = capturedTooltip!.props as { result: HealingSimulationResult };
            render(<Tooltip active label={activeLabel} result={props.result} />);
        };

        it('shows direct heal, HoT, shield, effective, overheal, cleanses, incoming and HP% for an active round', () => {
            renderTooltip(1);
            expect(screen.getByText(/5,000/)).toBeInTheDocument(); // direct
            expect(screen.getByText(/1,200/)).toBeInTheDocument(); // HoT
            expect(screen.getByText(/3,000/)).toBeInTheDocument(); // shield
            expect(screen.getByText(/4,800/)).toBeInTheDocument(); // effective
            expect(screen.getByText(/1,400/)).toBeInTheDocument(); // overheal
            expect(screen.getByText(/2,500/)).toBeInTheDocument(); // incoming
            expect(screen.getByText(/Cleanses/)).toBeInTheDocument();
            expect(screen.getByText(/Target HP 60%/)).toBeInTheDocument();
        });

        it('marks a crit round with a Crit badge', () => {
            renderTooltip(1);
            expect(screen.getByText(/crit/i)).toBeInTheDocument();
        });

        it('marks a charged round with a Charged badge', () => {
            renderTooltip(2);
            expect(screen.getByText(/charged/i)).toBeInTheDocument();
        });

        it('shows team healing when the round carries it', () => {
            renderTooltip(3);
            expect(screen.getByText(/1,500/)).toBeInTheDocument();
        });
    });
});
