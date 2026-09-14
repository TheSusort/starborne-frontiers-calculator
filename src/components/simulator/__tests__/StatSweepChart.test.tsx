import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import StatSweepChart from '../StatSweepChart';
import type { SweepPoint } from '../../../utils/simulator/sweepAnalysis';
import type { PairedDelta } from '../../../utils/simulator/deltaStats';

/**
 * recharts does not lay out in jsdom, so nothing it draws can be asserted on directly. The chart
 * therefore hands `<Line>` a dot renderer, and this file captures that renderer and invokes it
 * per point — the same function recharts calls, so the assertions land on production code rather
 * than on a parallel summary built for the test.
 */
type DotProps = { cx: number; cy: number; payload: Record<string, unknown>; index: number };

let capturedData: Array<Record<string, unknown>> = [];
let capturedDot: ((props: DotProps) => React.ReactElement) | null = null;
let capturedReferenceLines: Array<{ x?: number }> = [];
let capturedXAxis: { ticks?: number[] } | null = null;
let capturedYAxis: { domain?: unknown } | null = null;

vi.mock('recharts', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        LineChart: ({
            children,
            data,
        }: {
            children?: React.ReactNode;
            data: Array<Record<string, unknown>>;
        }) => {
            capturedData = data;
            return <div>{children}</div>;
        },
        Line: ({ dot }: { dot: (props: DotProps) => React.ReactElement }) => {
            capturedDot = dot;
            return null;
        },
        ReferenceLine: (props: { x?: number }) => {
            capturedReferenceLines.push(props);
            return null;
        },
        XAxis: (props: { ticks?: number[] }) => {
            capturedXAxis = props;
            return null;
        },
        YAxis: (props: { domain?: unknown }) => {
            capturedYAxis = props;
            return null;
        },
        CartesianGrid: () => null,
        Tooltip: () => null,
        ResponsiveContainer: Pass,
    };
});

const delta = (distinguishable: boolean): PairedDelta => ({
    mean: 1,
    se: 1,
    n: 12,
    distinguishable,
});

/** Win rate and mean rounds carry OPPOSITE verdicts, so a marker keyed to the wrong series is
 *  visible rather than coincidentally right. */
const points: SweepPoint[] = [
    { value: 100, isReference: true, winRate: 0.5, meanRounds: 10, playerDamage: 1000 },
    {
        value: 110,
        isReference: false,
        winRate: 0.8,
        meanRounds: 9,
        playerDamage: 1200,
        deltas: {
            winRate: delta(true),
            meanRounds: delta(false),
            playerDamage: delta(true),
        },
    },
    {
        value: 120,
        isReference: false,
        winRate: 0.55,
        meanRounds: 8,
        playerDamage: 1300,
        deltas: {
            winRate: delta(false),
            meanRounds: delta(true),
            playerDamage: delta(true),
        },
    },
];

const renderDots = () => {
    const rendered = capturedData.map((payload, index) =>
        capturedDot!({ cx: index * 10, cy: 5, payload, index })
    );
    render(
        <svg>
            {rendered.map((node, i) => (
                <React.Fragment key={i}>{node}</React.Fragment>
            ))}
        </svg>
    );
    return screen.getAllByTestId('sweep-point');
};

beforeEach(() => {
    capturedData = [];
    capturedDot = null;
    capturedReferenceLines = [];
    capturedXAxis = null;
    capturedYAxis = null;
});

describe('StatSweepChart axes', () => {
    it('gives win rate the whole 0-100% range rather than fitting the observed spread', () => {
        // Fitting the axis to the data redraws a couple of wins' wobble as a dramatic curve —
        // the exact misreading the distinguishability markers exist to prevent.
        render(<StatSweepChart points={points} series="winRate" statLabel="Speed" />);
        expect(capturedYAxis?.domain).toEqual([0, 1]);
    });

    it('measures a magnitude series from zero', () => {
        render(<StatSweepChart points={points} series="playerDamage" statLabel="Speed" />);
        expect(capturedYAxis?.domain).toEqual([0, 'auto']);
    });

    it('puts a tick on every swept value', () => {
        // Auto ticks land between steps, and a reader hunting a breakpoint cannot then tell
        // which value a point sits at.
        render(<StatSweepChart points={points} series="winRate" statLabel="Speed" />);
        expect(capturedXAxis?.ticks).toEqual([100, 110, 120]);
    });
});

describe('StatSweepChart', () => {
    it('plots the selected series against the swept value', () => {
        render(<StatSweepChart points={points} series="meanRounds" statLabel="Speed" />);
        expect(capturedData.map((row) => row.value)).toEqual([100, 110, 120]);
        expect(capturedData.map((row) => row.metric)).toEqual([10, 9, 8]);
    });

    it('marks a distinguishable point solid and an indistinguishable one hollow', () => {
        render(<StatSweepChart points={points} series="winRate" statLabel="Speed" />);
        const dots = renderDots();
        expect(dots.map((dot) => dot.getAttribute('data-distinguishable'))).toEqual([
            'reference',
            'true',
            'false',
        ]);
    });

    it('reads the verdict of the series on screen, not a single flag per point', () => {
        // Same points, other series: the two non-reference verdicts swap. A marker keyed to the
        // wrong series — or to any series — fails here.
        render(<StatSweepChart points={points} series="meanRounds" statLabel="Speed" />);
        const dots = renderDots();
        expect(dots.map((dot) => dot.getAttribute('data-distinguishable'))).toEqual([
            'reference',
            'false',
            'true',
        ]);
    });

    it('marks the reference step and draws a reference line at its value', () => {
        render(<StatSweepChart points={points} series="winRate" statLabel="Speed" />);
        const dots = renderDots();
        expect(dots.map((dot) => dot.getAttribute('data-reference'))).toEqual([
            'true',
            'false',
            'false',
        ]);
        expect(capturedReferenceLines.map((line) => line.x)).toEqual([100]);
    });

    it('states the solid/hollow rule in the legend', () => {
        render(<StatSweepChart points={points} series="winRate" statLabel="Speed" />);
        expect(screen.getByText(/current value/i)).toBeInTheDocument();
        expect(screen.getByText(/Differs from current/i)).toBeInTheDocument();
        expect(screen.getByText(/Not distinguishable/i)).toBeInTheDocument();
    });

    it('says so plainly when no step is distinguishable from the current value', () => {
        // A sweep where every point is hollow is a real answer — this stat does not move the
        // fight at this seed count — and must not read as a chart with a shape on it.
        const flat: SweepPoint[] = [
            points[0],
            { ...points[1], deltas: { ...points[1].deltas!, winRate: delta(false) } },
            points[2],
        ];
        render(<StatSweepChart points={flat} series="winRate" statLabel="Speed" />);
        expect(screen.getByText(/No step.*distinguishable/i)).toBeInTheDocument();
    });
});
