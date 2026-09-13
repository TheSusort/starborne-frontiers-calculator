import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Pagination } from '../ui/Pagination';
import { DataTable, type Column } from '../ui/tables/DataTable';
import type { SeedSetAggregate, ActorTotals } from '../../utils/simulator/seededRuns';

interface Props {
    aggregate: SeedSetAggregate;
    onOpenSeed: (seed: number) => void;
}

interface ActorMeanRow {
    actorId: string;
    totals: ActorTotals;
}

/** Seed buttons per page. Caps how many `Button`s a single pass mounts, no matter how large the
 *  aggregate. */
const SEEDS_PER_PAGE = 50;

/** Aggregate view for a multi-seed run. One seeded run reproduces a fight; this aggregate is what
 *  compares two configurations. Clicking a seed re-runs that single fight for playback.
 *
 *  Memoized: a run in flight ticks `onProgress` up to ~100 times (see `runSeedSetAsync`'s doc),
 *  and this component owns the one unbounded list in the results tree, so it is the render this
 *  memo exists to skip. It only pays off if `onOpenSeed` is referentially stable across those
 *  ticks — `useSimulatorRuns` wraps it in `useCallback` for exactly that reason. */
const SeedSetResults: React.FC<Props> = ({ aggregate, onOpenSeed }) => {
    const [currentPage, setCurrentPage] = useState(1);

    // A shorter run landing after a longer one would otherwise strand the view on a page past
    // the new run's last one.
    useEffect(() => {
        setCurrentPage(1);
    }, [aggregate]);

    const totalPages = Math.ceil(aggregate.runs.length / SEEDS_PER_PAGE);
    // Clamped at render time, not just by the effect above: the effect's reset only takes
    // effect on the render after this one, so an unclamped `currentPage` here would slice an
    // empty window for that one frame whenever a shorter aggregate replaces a longer one.
    const renderedPage = Math.min(currentPage, Math.max(1, totalPages));
    const visibleRuns = aggregate.runs.slice(
        (renderedPage - 1) * SEEDS_PER_PAGE,
        renderedPage * SEEDS_PER_PAGE
    );

    const nameFor = (actorId: string) =>
        aggregate.roster.find((r) => r.actorId === actorId)?.name ?? actorId;

    const actorRows: ActorMeanRow[] = Object.entries(aggregate.perActorMean).map(
        ([actorId, totals]) => ({ actorId, totals })
    );

    const columns: Column<ActorMeanRow>[] = [
        {
            key: 'actor',
            label: 'Actor',
            render: (row) => nameFor(row.actorId),
        },
        {
            key: 'damageDealt',
            label: 'Avg Damage Dealt',
            align: 'right',
            render: (row) => row.totals.damageDealt.toFixed(0),
        },
        {
            key: 'damageTaken',
            label: 'Avg Damage Taken',
            align: 'right',
            render: (row) => row.totals.damageTaken.toFixed(0),
        },
        {
            key: 'healingDone',
            label: 'Avg Healing Done',
            align: 'right',
            render: (row) => row.totals.healingDone.toFixed(0),
        },
    ];

    return (
        <div className="card space-y-4">
            <div className="flex flex-wrap gap-6 text-sm">
                <span>
                    Player wins:{' '}
                    <span className="font-semibold text-primary">
                        {aggregate.wins.player} / {aggregate.count}
                    </span>
                </span>
                <span>Enemy wins: {aggregate.wins.enemy}</span>
                <span>Draws: {aggregate.wins.draw}</span>
                <span>
                    Mean rounds: <span>{aggregate.meanRounds.toFixed(1)}</span>
                </span>
                <span>Median rounds: {aggregate.medianRounds}</span>
            </div>

            {/* per-actor means table — names from the roster, never raw actorIds */}
            <DataTable
                data={actorRows}
                columns={columns}
                getRowKey={(row) => row.actorId}
                emptyMessage="No actor data"
            />

            {/* per-seed rows, each a Button labelled "Seed <n> — <winner> in <rounds> rounds" */}
            <div className="flex flex-wrap gap-2">
                {visibleRuns.map((run) => (
                    <Button
                        key={run.seed}
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenSeed(run.seed)}
                    >
                        Seed {run.seed} — {run.winner} in {run.lastRound} rounds
                    </Button>
                ))}
            </div>

            {/* The seed grid sits mid-card, not at the top of the page — scrolling to top on
                every page change would yank the viewport away from what the click was about. */}
            <Pagination
                currentPage={renderedPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                scrollToTop={false}
            />
        </div>
    );
};

export default React.memo(SeedSetResults);
