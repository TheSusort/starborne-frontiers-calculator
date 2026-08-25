import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealingCumulativeChart } from '../HealingCumulativeChart';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../../utils/calculators/healingEngineAdapter';

// recharts' ResponsiveContainer needs real layout dimensions jsdom doesn't provide. Render a
// passthrough; <Tooltip content={...}/> is captured so the rich per-round tooltip can be driven
// active in isolation and its per-config numbers asserted (mirroring the DPS RoundTooltip pattern).
let capturedTooltip: React.ReactElement | null = null;
vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        LineChart: Pass,
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
    barrierAbsorbed: 0,
    convertedToShield: 0,
    incomingDamageRaw: 0,
    targetHpPct: 100,
    targetShieldPool: 0,
    totalRoundHealing: 0,
    cumulativeHealing: 0,
    activeSelfBuffs: [],
    healTargetBuffs: [],
    enemyEffects: [],
    ...over,
});

const summary = (): HealingSimulationResult['summary'] => ({
    totalHealing: 0,
    totalDirectHeal: 0,
    totalHotHeal: 0,
    totalShield: 0,
    totalCleanses: 0,
    totalEffectiveHealing: 0,
    totalOverheal: 0,
    totalShieldAbsorbed: 0,
    totalBarrierAbsorbed: 0,
    totalIncomingDamage: 0,
    avgHealingPerRound: 0,
});

// Config A: round 1 = crit active heal (direct + HoT + shield + cleanse + overheal + incoming),
//           round 1 carries enemy effects from one enemy.
const configA: HealingSimulationResult = {
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
            targetHpPct: 60,
            enemyEffects: [
                {
                    enemyId: 'e1',
                    selfBuffs: [{ buffName: 'Attack Up', turnsRemaining: 2 }],
                    debuffs: [{ buffName: 'Defense Down', turnsRemaining: 3 }],
                    dots: [],
                    resistedDebuffs: [],
                    resistedDots: [],
                },
            ],
        }),
    ],
    summary: summary(),
};

// Config B: round 1 = charged action with a distinct effective heal and its own enemy effect.
const configB: HealingSimulationResult = {
    rounds: [
        row({
            round: 1,
            action: 'charged',
            chargeCount: 3,
            directHeal: 7777,
            effectiveHealing: 6666,
            targetHpPct: 40,
            enemyEffects: [
                {
                    enemyId: 'e2',
                    selfBuffs: [{ buffName: 'Crit Up', turnsRemaining: 1 }],
                    debuffs: [],
                    dots: [],
                    resistedDebuffs: [],
                    resistedDots: [],
                },
            ],
        }),
    ],
    summary: summary(),
};

const healers = [
    { id: 'a', name: 'Healer A', result: configA },
    { id: 'b', name: 'Healer B', result: configB },
];

const NAMES: Record<string, string> = { e1: 'Makoli', e2: 'Enemy 2' };
const enemyName = (id: string) => NAMES[id] ?? id;

describe('HealingCumulativeChart', () => {
    it('renders without crashing and shows the per-config legend', () => {
        render(<HealingCumulativeChart healers={healers} rounds={1} enemyName={enemyName} />);
        // Legend label appears for each config (use getAllByText since the panel may also list it).
        expect(screen.getAllByText('Healer A').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Healer B').length).toBeGreaterThan(0);
    });

    it('right panel starts in the hover-gated empty state', () => {
        render(<HealingCumulativeChart healers={healers} rounds={1} enemyName={enemyName} />);
        expect(screen.getByText('Hover a round')).toBeInTheDocument();
    });

    describe('rich tooltip surfaces per-config numbers for the hovered round', () => {
        const renderTooltip = (activeLabel: number) => {
            render(<HealingCumulativeChart healers={healers} rounds={1} enemyName={enemyName} />);
            const Tooltip = capturedTooltip!.type as React.FC<{
                active?: boolean;
                label?: number;
                healers: typeof healers;
            }>;
            const props = capturedTooltip!.props as { healers: typeof healers };
            render(<Tooltip active label={activeLabel} healers={props.healers} />);
        };

        it('lists BOTH configs with their per-round heal numbers', () => {
            renderTooltip(1);
            // Config A active-heal numbers.
            expect(screen.getByText(/5,000/)).toBeInTheDocument(); // direct
            expect(screen.getByText(/1,200/)).toBeInTheDocument(); // HoT
            expect(screen.getByText(/3,000/)).toBeInTheDocument(); // shield
            expect(screen.getByText(/4,800/)).toBeInTheDocument(); // effective
            expect(screen.getByText(/1,400/)).toBeInTheDocument(); // overheal
            expect(screen.getByText(/2,500/)).toBeInTheDocument(); // incoming
            // Config B's distinct number, proving all configs are listed.
            expect(screen.getByText(/7,777/)).toBeInTheDocument();
            // Both config names appear as block headers (also in the legend/panel, hence getAll).
            expect(screen.getAllByText('Healer A').length).toBeGreaterThan(0);
            expect(screen.getAllByText('Healer B').length).toBeGreaterThan(0);
        });

        it('marks crit and charged badges on the appropriate config blocks', () => {
            renderTooltip(1);
            expect(screen.getByText(/crit/i)).toBeInTheDocument(); // Config A
            expect(screen.getByText(/charged/i)).toBeInTheDocument(); // Config B
        });

        it('shows the charge bank for configs with a charged skill', () => {
            renderTooltip(1);
            // Config B has chargeCount 3 → "Charges 0/3"; Config A (chargeCount 0) shows none.
            expect(screen.getByText(/Charges 0\/3/)).toBeInTheDocument();
        });

        it('shows each config target HP%', () => {
            renderTooltip(1);
            expect(screen.getByText(/Target HP 60%/)).toBeInTheDocument();
            expect(screen.getByText(/Target HP 40%/)).toBeInTheDocument();
        });

        it('names the two axes, because this tooltip shows both at once', () => {
            renderTooltip(1);
            // Direct/HoT/Shield are SOURCE-axis (healer throughput); Effective/Overheal are
            // RECIPIENT-axis (what landed on the heal target). They can disagree by design, and this
            // is the only surface that puts them side by side.
            expect(screen.getByText(/Direct\/HoT\/Shield/)).toBeInTheDocument();
            expect(screen.getByText(/Effective\/Overheal/)).toBeInTheDocument();
        });
    });

    // ⚠️ The empty-state gate enumerates the metrics by hand, and it MISSED the recipient axis:
    // `effectiveHealing`/`overheal` changed axis mid-branch and were never added, so a round where the
    // healer produced nothing while an ALLY's cast landed on the heal target printed "No healer output
    // this round" on top of numbers it was hiding.
    it('does not claim an empty round when only the RECIPIENT axis is non-zero', () => {
        const allyLanded: HealingSimulationResult = {
            // Zero healer throughput (no direct/HoT/shield/cleanse), but a repair from elsewhere
            // landed on the heal target — the role-filtered-regeneration shape.
            rounds: [row({ round: 1, effectiveHealing: 1000, overheal: 1500 })],
            summary: summary(),
        };
        const only = [{ id: 'a', name: 'Ally Fed', result: allyLanded }];
        render(<HealingCumulativeChart healers={only} rounds={1} enemyName={enemyName} />);
        const Tooltip = capturedTooltip!.type as React.FC<{
            active?: boolean;
            label?: number;
            healers: typeof only;
        }>;
        render(<Tooltip active label={1} healers={only} />);

        expect(screen.queryByText('No healer output this round')).not.toBeInTheDocument();
        expect(screen.getByText('1,000')).toBeInTheDocument();
        expect(screen.getByText('1,500')).toBeInTheDocument();
    });

    it('still claims an empty round when EVERY metric is zero', () => {
        // ANTI-VACUITY CONTRAST: the empty state is not simply gone.
        const nothing: HealingSimulationResult = {
            rounds: [row({ round: 1 })],
            summary: summary(),
        };
        const only = [{ id: 'a', name: 'Idle', result: nothing }];
        render(<HealingCumulativeChart healers={only} rounds={1} enemyName={enemyName} />);
        const Tooltip = capturedTooltip!.type as React.FC<{
            active?: boolean;
            label?: number;
            healers: typeof only;
        }>;
        render(<Tooltip active label={1} healers={only} />);
        expect(screen.getByText('No healer output this round')).toBeInTheDocument();
    });
});
