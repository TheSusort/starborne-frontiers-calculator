import React from 'react';
import { Button } from '../ui/Button';
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

/** Aggregate view for a multi-seed run. One seeded run reproduces a fight; this aggregate is what
 *  compares two configurations. Clicking a seed re-runs that single fight for playback. */
const SeedSetResults: React.FC<Props> = ({ aggregate, onOpenSeed }) => {
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
                {aggregate.runs.map((run) => (
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
        </div>
    );
};

export default SeedSetResults;
