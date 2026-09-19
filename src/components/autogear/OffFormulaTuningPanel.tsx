import React, { useEffect, useState } from 'react';
import { Button, Input } from '../ui';
import { DataTable, type Column } from '../ui/tables';
import type { Ship } from '../../types/ship';
import { SHIP_TYPES, type ShipTypeName } from '../../constants/shipTypes';
import type { LimitableStat } from '../../types/stats';
import type { GearSuggestion, StatPriority } from '../../types/autogear';
import type { CombatStatsDeps } from '../../utils/ship/combatStats';
import {
    gatingStatFor,
    type TunableOffFormulaFinding,
} from '../../utils/autogear/simRerank/offFormulaStats';
import type { StatBounds } from '../../utils/autogear/simRerank/statBounds';
import { randomSeed } from '../simulator/SeedRunControls';
import { clampRunCount, clampSeed } from '../../utils/simulator/seedRunInputs';
import { useOffFormulaTuning, type TuningRow } from '../../hooks/useOffFormulaTuning';

const DEFAULT_RUN_COUNT = 20;

const STAT_LABEL: Record<string, string> = {
    hp: 'HP',
    defence: 'Defence',
    attack: 'Attack',
    security: 'Security',
    shield: 'Shield %',
    hacking: 'Hacking',
};

const statLabel = (stat: LimitableStat): string => STAT_LABEL[stat] ?? stat;

const formatBand = (row: TuningRow): string =>
    `${Math.round(row.band.min).toLocaleString()} – ${Math.round(row.band.max).toLocaleString()}`;

interface TuningTableRow {
    row: TuningRow;
}

export interface OffFormulaTuningPanelProps {
    ship: Ship;
    /** Never null here — the panel only mounts from a finding, and `detectOffFormulaStats`
     *  never produces a finding in Custom mode. */
    configuredRole: ShipTypeName;
    /** Typed to the tunable variant: a finding with no gearable lever has nothing to band, and
     *  the notice offers no control for one. */
    finding: TunableOffFormulaFinding;
    deps: CombatStatsDeps;
    /** Runs one optimizer pass for `stat` under `priorities` and reports the ship's actual
     *  configured-role formula plus that constraint, with the algorithm forced to Genetic.
     *  Injected by the page — see `runOffFormulaTuningOptimizer` in `AutogearPage.tsx`. */
    runOptimizer: (
        stat: LimitableStat,
        priorities: StatPriority[]
    ) => Promise<{ suggestions: GearSuggestion[]; landed: number }>;
    /** The achievable range of `stat` over the pool this ship's run would draw from. Injected
     *  by the page — see `offFormulaTuningBounds` in `AutogearPage.tsx`. */
    statBounds: (stat: LimitableStat) => StatBounds;
}

/**
 * The measured tuning run for one off-formula finding: probes the stat's achievable range,
 * bands it, gears each band with the real optimizer, and replays every build against three
 * sparring opponents to score the role's real objective. Read-only — no Apply control here;
 * writing a band into the ship's config is a later stage.
 */
export const OffFormulaTuningPanel: React.FC<OffFormulaTuningPanelProps> = ({
    ship,
    configuredRole,
    finding,
    deps,
    runOptimizer,
    statBounds,
}) => {
    const stat = finding.tunableStat as LimitableStat;
    const gatingStat = gatingStatFor(finding.trigger);
    const [seed, setSeed] = useState(() => randomSeed());
    const [runCount, setRunCount] = useState(DEFAULT_RUN_COUNT);
    const { state, run, cancel, reset } = useOffFormulaTuning();

    const isRunning = state.status === 'gearing' || state.status === 'simulating';

    // Hard requirement: a completed table must never survive a context change. ship/configuredRole
    // /stat/gatingStat come from props the parent controls (a different ship, a different flagged
    // stat, or the same stat flagged by a different trigger can be selected while this panel stays
    // mounted); seed/runCount are this panel's own inputs. Every argument `handleRun` passes is
    // listed — nothing is omitted from this list to silence a lint warning, so this effect always
    // sees the CURRENT context.
    useEffect(() => {
        reset();
    }, [ship.id, configuredRole, stat, gatingStat, seed, runCount, reset]);

    const handleRun = () => {
        void run({
            ship,
            configuredRole,
            stat,
            gatingStat,
            seed,
            runCount,
            deps,
            runOptimizer: (priorities) => runOptimizer(stat, priorities),
            statBounds: () => statBounds(stat),
        });
    };

    const tableRows: TuningTableRow[] = state.rows.map((row) => ({ row }));

    const columns: Column<TuningTableRow>[] = [
        {
            key: 'band',
            label: `${statLabel(stat)} band`,
            render: ({ row }) => formatBand(row),
        },
        {
            key: 'landed',
            label: 'Landed',
            align: 'right',
            render: ({ row }) =>
                row.withinBand ? (
                    Math.round(row.landed).toLocaleString()
                ) : (
                    <span className="text-amber-400">
                        {Math.round(row.landed).toLocaleString()} — optimizer preferred outside this
                        band
                    </span>
                ),
        },
        ...state.opponents.map((label, opponentIndex): Column<TuningTableRow> => ({
            key: `opponent-${opponentIndex}`,
            label,
            align: 'right',
            render: ({ row }) => Math.round(row.byOpponent[opponentIndex] ?? 0).toLocaleString(),
        })),
        {
            key: 'constraint',
            label: 'Vs. unbanded',
            align: 'right',
            render: ({ row }) =>
                row.constraintHeld ? (
                    <span className="text-green-400">Holds</span>
                ) : (
                    <span className="text-red-400">Worse</span>
                ),
        },
    ];

    return (
        <div className="card space-y-3">
            <p className="text-xs text-theme-text-secondary">
                Bands {statLabel(stat)} across what your inventory can actually reach, gears each
                band with the Genetic algorithm — used for this run regardless of the algorithm you
                have selected elsewhere, because it is the one that produces meaningful results —
                and replays every build against three sparring opponents to measure the{' '}
                {SHIP_TYPES[configuredRole]?.name}&apos;s real objective. A band is a preference,
                not a wall: where the optimizer preferred a different value, the row says so. Writes
                nothing; it only measures.
            </p>

            <div className="flex gap-3 items-end">
                <Input
                    label="Seed"
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(clampSeed(Number(e.target.value)))}
                    className="max-w-[10rem]"
                    disabled={isRunning}
                />
                <Input
                    label="Runs"
                    type="number"
                    value={runCount}
                    onChange={(e) => setRunCount(clampRunCount(Number(e.target.value)))}
                    className="max-w-[6rem]"
                    disabled={isRunning}
                />
            </div>

            <div className="flex items-center gap-3">
                {isRunning ? (
                    <Button variant="secondary" onClick={cancel}>
                        Cancel
                    </Button>
                ) : (
                    <Button variant="primary" onClick={handleRun}>
                        Measure
                    </Button>
                )}
                {isRunning && (
                    <span aria-live="polite" className="text-sm text-theme-text-secondary">
                        {state.status === 'gearing' ? 'Gearing' : 'Simulating'}{' '}
                        {Math.round(state.progress.completed)} / {Math.round(state.progress.total)}
                    </span>
                )}
                {state.status === 'cancelled' && (
                    <span className="text-sm text-theme-text-secondary">Cancelled.</span>
                )}
                {state.error && <span className="text-sm text-red-400">{state.error}</span>}
            </div>

            {state.status === 'done' && state.baseline && (
                <p className="text-sm text-theme-text-secondary">
                    Unbanded (what autogear picks today, with no limit on {statLabel(stat)}):{' '}
                    {statLabel(stat)} lands at {Math.round(state.baseline.landed).toLocaleString()}.
                </p>
            )}

            {state.status === 'done' && (
                <DataTable
                    data={tableRows}
                    columns={columns}
                    getRowKey={(item) => `${item.row.band.min}-${item.row.band.max}`}
                    emptyMessage="No bands to show."
                    className="border-0 p-0"
                />
            )}
        </div>
    );
};
