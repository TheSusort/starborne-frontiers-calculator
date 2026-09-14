import React, { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { ChevronDownIcon, ChevronUpIcon } from '../ui/icons';
import type { Position } from '../../types/encounters';
import type { StatName } from '../../types/stats';
import { STATS } from '../../constants/stats';
import {
    combatStatsFromShip,
    shipFinalStats,
    type CombatStatsDeps,
} from '../../utils/ship/combatStats';
import {
    applyStatOverrides,
    OVERRIDABLE_STATS,
    type OverridableStat,
} from '../../utils/simulator/statOverrides';
import { sweepSteps, type SweepTarget } from '../../utils/simulator/statSweep';
import type { SweepPoint, SweepSeries } from '../../utils/simulator/sweepAnalysis';
import type { RunSweepArgs, SweepProvenance } from '../../hooks/useStatSweep';
import { clampRunCount, MAX_RUN_COUNT, MIN_RUN_COUNT } from '../../utils/simulator/seedRunInputs';
import StatSweepChart from './StatSweepChart';
import type { BoardState, Placement } from './PlacementBoard';

interface StatSweepPanelProps {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    statsDeps: CombatStatsDeps;
    /** The seed the page displays. A sweep run on a seed the user cannot see is unreproducible. */
    seed: number;
    points: SweepPoint[] | null;
    /** What produced `points`. The chart is captioned from this, never from the live selections
     *  above it — those keep moving while a result stays on screen. */
    provenance: SweepProvenance | null;
    isSweeping: boolean;
    progress: { completed: number; total: number } | null;
    error: string | null;
    onRunSweep: (args: RunSweepArgs) => void;
    onCancelSweep: () => void;
    /** An ordinary run is in flight. Run and Sweep disable each other: two engine loops competing
     *  for the page would each make the other's progress meaningless. */
    disabled?: boolean;
}

const DEFAULT_SWEEP_RUNS = 20;
/** Past this the wait is long enough to be worth a warning rather than a surprise. */
const COSTLY_BATTLES = 300;
const SIDE_LABELS = { player: 'Your team', enemy: 'Enemy' } as const;

const SERIES_OPTIONS: ReadonlyArray<{ series: SweepSeries; label: string }> = [
    { series: 'winRate', label: 'Win rate' },
    { series: 'meanRounds', label: 'Mean rounds' },
    { series: 'playerDamage', label: 'Player damage' },
];

interface TargetEntry {
    key: string;
    target: SweepTarget;
    label: string;
    placement: Placement;
}

const targetKey = (side: SweepTarget['side'], position: Position) => `${side}:${position}`;

const entriesFor = (side: SweepTarget['side'], board: BoardState): TargetEntry[] =>
    (Object.entries(board) as [Position, Placement][])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([position, placement]) => ({
            key: targetKey(side, position),
            target: { side, position },
            label: `${SIDE_LABELS[side]} ${position} — ${placement.ship.name}`,
            placement,
        }));

/**
 * Where the ship actually sits for one stat: gear, refits, implants and engineering, then any
 * override already on the placement — the same composition `buildTeam` bakes into the engine
 * input. Reading the gear figure alone would make the reference step a configuration the user
 * never runs.
 */
const resolvedStat = (placement: Placement, stat: OverridableStat, deps: CombatStatsDeps): number =>
    applyStatOverrides(
        combatStatsFromShip(shipFinalStats(placement.ship, deps)),
        placement.overrides
    )[stat];

/** A round step roughly seven steps wide. A step derived straight from the span would prefill
 *  fields with values like 8.833. */
const niceStep = (span: number): number => {
    const raw = Math.max(1, Math.round(span / 6));
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    for (const multiple of [1, 2, 5]) {
        if (raw <= multiple * magnitude) return multiple * magnitude;
    }
    return 10 * magnitude;
};

const StatSweepPanel: React.FC<StatSweepPanelProps> = ({
    playerBoard,
    enemyBoard,
    statsDeps,
    seed,
    points,
    provenance,
    isSweeping,
    progress,
    error,
    onRunSweep,
    onCancelSweep,
    disabled = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [targetKeyValue, setTargetKeyValue] = useState('');
    const [stat, setStat] = useState<OverridableStat>('speed');
    const [from, setFrom] = useState(0);
    const [to, setTo] = useState(0);
    const [step, setStep] = useState(1);
    const [count, setCount] = useState(DEFAULT_SWEEP_RUNS);
    const [series, setSeries] = useState<SweepSeries>('winRate');

    const targets = useMemo(
        () => [...entriesFor('player', playerBoard), ...entriesFor('enemy', enemyBoard)],
        [playerBoard, enemyBoard]
    );
    const selected = targets.find((entry) => entry.key === targetKeyValue);

    // Prefill is a one-shot reaction to a new target/stat pair, not a derived value: the fields
    // are the user's to edit afterwards.
    const prefill = (placement: Placement, nextStat: OverridableStat) => {
        const resolved = resolvedStat(placement, nextStat, statsDeps);
        const top = Math.round(resolved * 1.5);
        setFrom(resolved);
        setTo(top);
        setStep(niceStep(Math.max(0, top - resolved)));
    };

    const handleTargetChange = (key: string) => {
        setTargetKeyValue(key);
        const entry = targets.find((candidate) => candidate.key === key);
        if (entry) prefill(entry.placement, stat);
    };

    const handleStatChange = (next: string) => {
        const nextStat = next as OverridableStat;
        setStat(nextStat);
        if (selected) prefill(selected.placement, nextStat);
    };

    const resolved = selected ? resolvedStat(selected.placement, stat, statsDeps) : 0;

    // The step count is the same computation the run itself performs, so the preview cannot
    // promise a shape the run will not produce. An unusable range simply has no cost to preview;
    // the run reports why.
    let stepCount: number | null = null;
    try {
        stepCount = sweepSteps(stat, from, to, step, resolved).length;
    } catch {
        stepCount = null;
    }
    const battles = stepCount === null ? null : stepCount * count;

    // simulateBattle throws on an empty side, so a sweep with one empty board can only fail —
    // the same guard `canRun` puts on an ordinary run.
    const bothSidesManned =
        Object.keys(playerBoard).length > 0 && Object.keys(enemyBoard).length > 0;

    const handleRun = () => {
        if (!selected || !bothSidesManned) return;
        onRunSweep({
            target: selected.target,
            stat,
            from,
            to,
            step,
            resolved,
            baseSeed: seed,
            count,
        });
    };

    const statLabel = STATS[stat as StatName].label;

    return (
        <div className="card">
            <button
                type="button"
                data-testid="sweep-toggle"
                className="w-full flex items-center justify-between text-left"
                aria-expanded={isOpen}
                aria-controls="stat-sweep-body"
                onClick={() => setIsOpen((open) => !open)}
            >
                <span className="font-semibold">Stat sweep</span>
                {isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </button>

            <CollapsibleAccordion isOpen={isOpen} id="stat-sweep-body">
                <div className="space-y-4">
                    <p className="text-sm text-theme-text-secondary">
                        A sweep holds every other stat fixed, while real gear moves several at once
                        — so it answers what this stat is worth, not what a piece is worth.
                    </p>

                    <div className="flex flex-wrap items-end gap-4">
                        <Select
                            label="Ship to sweep"
                            data-testid="sweep-target"
                            value={targetKeyValue}
                            onChange={handleTargetChange}
                            options={targets.map((entry) => ({
                                value: entry.key,
                                label: entry.label,
                            }))}
                            defaultOption="Select a ship"
                            disabled={isSweeping}
                            className="max-w-[18rem]"
                        />
                        <Select
                            label="Stat to sweep"
                            data-testid="sweep-stat"
                            value={stat}
                            onChange={handleStatChange}
                            options={OVERRIDABLE_STATS.map((name) => ({
                                value: name,
                                label: STATS[name as StatName].label,
                            }))}
                            disabled={isSweeping}
                            className="max-w-[12rem]"
                        />
                    </div>

                    <div className="flex flex-wrap items-end gap-4">
                        <Input
                            id="sweep-from"
                            label="From"
                            type="number"
                            value={from}
                            onChange={(e) => setFrom(Number(e.target.value))}
                            disabled={isSweeping}
                            className="max-w-[8rem]"
                        />
                        <Input
                            id="sweep-to"
                            label="To"
                            type="number"
                            value={to}
                            onChange={(e) => setTo(Number(e.target.value))}
                            disabled={isSweeping}
                            className="max-w-[8rem]"
                        />
                        <Input
                            id="sweep-step"
                            label="Step"
                            type="number"
                            value={step}
                            onChange={(e) => setStep(Number(e.target.value))}
                            disabled={isSweeping}
                            className="max-w-[8rem]"
                        />
                        <Input
                            id="sweep-runs"
                            label="Seeds per step"
                            type="number"
                            min={MIN_RUN_COUNT}
                            max={MAX_RUN_COUNT}
                            value={count}
                            onChange={(e) => setCount(clampRunCount(Number(e.target.value)))}
                            disabled={isSweeping}
                            className="max-w-[8rem]"
                            helpLabel="A sweep's cost is multiplicative, so it keeps its own run count rather than inheriting the one chosen for a single run."
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-4">
                        {battles !== null && (
                            <span
                                className={`text-sm ${
                                    battles > COSTLY_BATTLES
                                        ? 'text-amber-400'
                                        : 'text-theme-text-secondary'
                                }`}
                            >
                                {stepCount} {stepCount === 1 ? 'step' : 'steps'} x {count} seeds ={' '}
                                {battles} battles
                            </span>
                        )}
                        {/* Mounted unconditionally, empty until there is progress: a screen reader
                            announces a live region inconsistently when the region and its first
                            text land in the same mutation. */}
                        <span
                            data-testid="sweep-progress"
                            aria-live="polite"
                            className="text-sm text-theme-text-secondary"
                        >
                            {progress && `Battle ${progress.completed} / ${progress.total}`}
                        </span>
                        {isSweeping ? (
                            <Button variant="secondary" onClick={onCancelSweep}>
                                Cancel sweep
                            </Button>
                        ) : (
                            <Button
                                variant="primary"
                                onClick={handleRun}
                                disabled={!selected || !bothSidesManned || disabled}
                            >
                                Run sweep
                            </Button>
                        )}
                    </div>

                    {error && <p className="text-sm text-red-400">Sweep error: {error}</p>}

                    {points && points.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap gap-2" data-testid="sweep-series-toggle">
                                {SERIES_OPTIONS.map((option) => (
                                    <Button
                                        key={option.series}
                                        size="sm"
                                        variant={series === option.series ? 'primary' : 'secondary'}
                                        aria-pressed={series === option.series}
                                        onClick={() => setSeries(option.series)}
                                    >
                                        {option.label}
                                    </Button>
                                ))}
                            </div>
                            <StatSweepChart
                                points={points}
                                series={series}
                                statLabel={
                                    provenance
                                        ? STATS[provenance.stat as StatName].label
                                        : statLabel
                                }
                            />
                            {provenance && (
                                <p
                                    className="text-sm text-theme-text-secondary"
                                    data-testid="sweep-provenance"
                                >
                                    {STATS[provenance.stat as StatName].label} on{' '}
                                    {provenance.target.side === 'player'
                                        ? 'your team'
                                        : 'the enemy'}{' '}
                                    {provenance.target.position}, seeds {provenance.baseSeed}-
                                    {provenance.baseSeed + provenance.count - 1}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </CollapsibleAccordion>
        </div>
    );
};

export default StatSweepPanel;
