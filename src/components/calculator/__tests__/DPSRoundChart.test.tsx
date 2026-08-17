import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DPSRoundChart } from '../DPSRoundChart';
import { simulateDPS, DPSSimulationInput } from '../../../utils/calculators/dpsSimulator';
import { setupKeyedTestRng } from '../../../utils/calculators/rateAccumulator';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
} from '../../../utils/calculators/dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';
import {
    dotKit,
    realEnemyInput,
} from '../../../utils/calculators/__testutils__/dpsRealEnemyFixture';

/**
 * SP-4b-1: the DPS chart had NO test at all, which is how a green 5756-test suite shipped a live
 * display regression — the normalization boundary flipped every walked team actor onto the
 * positional route, the engine's scalar `teamDamage` fold went silent, and every team feature on
 * this chart is `> 0`-guarded, so the whole thing vanished without ever painting a "0".
 *
 * This file therefore drives a REAL `simulateDPS` run shaped exactly like `DPSCalculatorPage`
 * (positioned focus, positioned real enemy, positioned walked team ship) and asserts what reaches
 * the chart. Asserting on a hand-built `RoundData` literal would NOT have caught it: the defect
 * lives in what the simulator puts in that field, not in how the chart reads it.
 */

// recharts needs real layout dimensions jsdom does not provide. Pass children through, and capture
// the two things that carry the team feature: the `data` array LineChart is fed, and every <Line>'s
// dataKey/name. <Tooltip content> is captured so the per-round rows can be driven in isolation.
let capturedData: Array<Record<string, number>> = [];
let capturedLines: Array<{ dataKey: string; name: string }> = [];
let capturedTooltip: React.ReactElement | null = null;
vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        LineChart: ({
            children,
            data,
        }: {
            children?: React.ReactNode;
            data: Array<Record<string, number>>;
        }) => {
            capturedData = data;
            return <div>{children}</div>;
        },
        Line: ({ dataKey, name }: { dataKey: string; name: string }) => {
            capturedLines.push({ dataKey, name });
            return null;
        },
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

const plainDamageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const ROUNDS = 3;

/**
 * The page's shape: a positioned focus, an ALWAYS-supplied positioned real enemy
 * (`DPSCalculatorPage.tsx` passes one unconditionally), and a positioned walked team ship.
 */
const pageShapedInput = (): DPSSimulationInput => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: ROUNDS,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300000,
    position: DEFAULT_ATTACKER_SLOT,
    shipSkills: plainDamageKit(),
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: {
                attack: 0, // the page's default — see DPSCalculatorPage.realEnemy.test.tsx
                crit: 0,
                critDamage: 150,
                speed: 40,
                defence: 1000,
                hp: 5_000_000, // survives the window, so no early trim muddies the series
            },
            chargeCount: 0,
            startCharged: false,
            position: DEFAULT_ENEMY_SLOT,
        },
    ],
    teamActors: [
        {
            id: 'team-1',
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: plainDamageKit(),
            stats: {
                attack: 15000,
                crit: 0,
                critDamage: 150,
                defensePenetration: 0,
                hacking: 200,
                security: 100,
                defence: 1000,
                hp: 300000,
                healModifier: 0,
            },
            position: 'M3',
        },
    ],
});

const renderChart = () => {
    const result = simulateDPS(pageShapedInput());
    render(
        <DPSRoundChart
            ships={[{ id: 'ship-1', name: 'Focus Ship', result }]}
            rounds={ROUNDS}
            enemyHp={5_000_000}
        />
    );
    return result;
};

describe('DPSRoundChart surfaces walked-team damage from a real page-shaped run', () => {
    beforeEach(() => {
        capturedData = [];
        capturedLines = [];
        capturedTooltip = null;
        // No `resetRateGateRng()` here: it clears BOTH streams, so calling it after the seed
        // un-seeds the test (see `rateGateSeedingOrder.test.ts`). `src/setupTests.ts` already
        // resets after every test.
        setupKeyedTestRng(12345);
    });

    it('draws the dashed "with team" overlay, which exists only when teamDamage is non-zero', () => {
        renderChart();

        // `hasTeamDamage` (rounds.some(r => (r.teamDamage ?? 0) > 0)) is the single gate behind the
        // overlay line, the legend entry and the combined kill marker. A suppressed aggregate
        // removes all three silently.
        expect(capturedLines.map((l) => l.dataKey)).toContain('ship-1__team');
        expect(capturedLines.find((l) => l.dataKey === 'ship-1__team')?.name).toBe(
            'Focus Ship — with team'
        );
        // ...and the legend names it too.
        expect(screen.getByText('Focus Ship — with team')).toBeInTheDocument();
    });

    it('feeds the chart a non-zero, strictly rising team series above the focus-only line', () => {
        renderChart();

        expect(capturedData).toHaveLength(ROUNDS);
        capturedData.forEach((point) => {
            // The combined "with team" total must exceed the focus-only total at every round —
            // that difference IS the team contribution.
            expect(point['ship-1__team']).toBeGreaterThan(point['ship-1']);
        });
        // The gap grows: the team keeps contributing, it did not just land once.
        const gap = capturedData.map((p) => p['ship-1__team'] - p['ship-1']);
        expect(gap[gap.length - 1]).toBeGreaterThan(gap[0]);
    });

    it('shows the violet team-damage row and the "(with team)" total in the round tooltip', () => {
        const result = renderChart();
        const round = 1;
        const teamDamage = result.rounds[round - 1].teamDamage ?? 0;
        expect(teamDamage).toBeGreaterThan(0);

        const Tooltip = capturedTooltip!.type as React.FC<Record<string, unknown>>;
        const props = capturedTooltip!.props as Record<string, unknown>;
        const combined = capturedData[round - 1]['ship-1__team'];
        render(
            <Tooltip
                {...props}
                active
                label={round}
                payload={[
                    {
                        name: 'Focus Ship',
                        value: capturedData[round - 1]['ship-1'],
                        color: '#fff',
                        dataKey: 'ship-1',
                    },
                    {
                        name: 'Focus Ship — with team',
                        value: combined,
                        color: '#fff',
                        dataKey: 'ship-1__team',
                    },
                ]}
            />
        );

        // Matched on the element's full textContent (the labels are built from several JSX text
        // nodes), and against the exact figures so a zeroed aggregate cannot pass.
        const hasText = (expected: string) => (_: string, el: Element | null) =>
            el?.textContent?.trim() === expected;
        expect(
            screen.getByText(hasText(`Team damage: ${teamDamage.toLocaleString()}`))
        ).toBeInTheDocument();
        expect(
            screen.getByText(hasText(`Total (with team): ${combined.toLocaleString()}`))
        ).toBeInTheDocument();
    });

    it('shows every damage-type row from a real simulated run', () => {
        setupKeyedTestRng(12345);
        const result = simulateDPS(realEnemyInput({ shipSkills: dotKit() }));

        render(
            <DPSRoundChart
                ships={[{ id: 'ship-1', name: 'Focus Ship', result }]}
                rounds={result.rounds.length}
                enemyHp={5_000_000}
            />
        );

        // Pick the first round where corrosion has actually landed, so the DoT row is not
        // vacuously absent.
        const round = result.rounds.findIndex((r) => r.corrosionDamage > 0) + 1;
        expect(round).toBeGreaterThan(0);
        const roundData = result.rounds[round - 1];

        const Tooltip = capturedTooltip!.type as React.FC<Record<string, unknown>>;
        const props = capturedTooltip!.props as Record<string, unknown>;
        render(
            <Tooltip
                {...props}
                active
                label={round}
                payload={[
                    {
                        name: 'Focus Ship',
                        value: roundData.cumulativeDamage,
                        color: '#fff',
                        dataKey: 'ship-1',
                    },
                ]}
            />
        );

        // PRESENCE, not value: the whole defect class is a `> 0`-guarded row VANISHING.
        expect(screen.getByText(/Direct: [\d,]+/)).toBeInTheDocument();
        expect(screen.queryByText('Direct: 0')).not.toBeInTheDocument();
        expect(screen.getByText(/Corr: [\d,]+/)).toBeInTheDocument();
        // No decimal tail reaches the user.
        expect(screen.queryByText(/Direct: [\d,]+\.\d/)).not.toBeInTheDocument();

        // Inf/Detonation are `> 0`-guarded and this fixture produces neither — fencing the
        // guard in the other direction.
        expect(screen.queryByText(/Inf: /)).not.toBeInTheDocument();
        expect(screen.queryByText(/Detonation: /)).not.toBeInTheDocument();
    });
});
