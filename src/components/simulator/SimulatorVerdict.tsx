import React from 'react';
import { StatCard } from '../ui/StatCard';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
import { summarizeRun, type SeedSetAggregate } from '../../utils/simulator/seededRuns';
import { formatWhole, topDamageBySide } from '../../utils/simulator/runBreakdown';

interface Props {
    /** A multi-seed run. Wins over `result` when both are given. */
    aggregate?: SeedSetAggregate | null;
    /** A single fight. */
    result?: BattleResult | null;
}

interface Verdict {
    wins: number;
    count: number;
    rounds: string;
    roundsSubtitle: string;
    player: { label: string; damage: number } | null;
    enemy: { label: string; damage: number } | null;
}

const fromAggregate = (aggregate: SeedSetAggregate): Verdict => {
    const top = topDamageBySide(aggregate.roster, aggregate.perActorMean);
    return {
        wins: aggregate.wins.player,
        count: aggregate.count,
        rounds: aggregate.meanRounds.toFixed(1),
        roundsSubtitle: `median ${aggregate.medianRounds}`,
        player: top.player,
        enemy: top.enemy,
    };
};

const fromSingle = (result: BattleResult): Verdict => {
    // The seed only labels the summary; the totals read off the rounds.
    const { perActor, lastRound, winner } = summarizeRun(result, 0);
    const top = topDamageBySide(result.roster, perActor);
    return {
        wins: winner === 'player' ? 1 : 0,
        count: 1,
        rounds: String(lastRound),
        roundsSubtitle: 'rounds',
        player: top.player,
        enemy: top.enemy,
    };
};

const winRateColor = (wins: number, count: number) => {
    if (wins === 0) return 'red' as const;
    if (wins / count > 0.5) return 'green' as const;
    return undefined;
};

/** Four headline tiles for the displayed run, from a seed set or a single fight alike. */
const SimulatorVerdict: React.FC<Props> = ({ aggregate, result }) => {
    const verdict = aggregate ? fromAggregate(aggregate) : result ? fromSingle(result) : null;
    if (!verdict) return null;

    const winPct = verdict.count > 0 ? Math.round((verdict.wins / verdict.count) * 100) : 0;

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
                title="Your win rate"
                value={`${winPct}%`}
                subtitle={`${verdict.wins} of ${verdict.count}`}
                color={winRateColor(verdict.wins, verdict.count)}
            />
            <StatCard
                title="Fight length"
                value={verdict.rounds}
                subtitle={verdict.roundsSubtitle}
            />
            <StatCard
                title="Your top damage"
                value={formatWhole(verdict.player?.damage ?? 0)}
                subtitle={verdict.player?.label}
            />
            <StatCard
                title="Enemy top damage"
                value={formatWhole(verdict.enemy?.damage ?? 0)}
                subtitle={verdict.enemy?.label}
            />
        </div>
    );
};

export default SimulatorVerdict;
