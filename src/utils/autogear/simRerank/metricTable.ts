import { matchesRoleCategory, type ShipTypeName } from '../../../constants/shipTypes';
import { pairedDelta, type PairedDelta, type PairedMetricKind } from '../../simulator/deltaStats';
import type { CandidateRun } from './runCandidates';

export type SimMetric =
    | 'winRate'
    | 'rounds'
    | 'focusDamageDealt'
    | 'focusDamageTaken'
    | 'focusHealingDone'
    | 'teamDamageDealt';

export const SIM_METRICS: readonly SimMetric[] = [
    'winRate',
    'rounds',
    'focusDamageDealt',
    'focusDamageTaken',
    'focusHealingDone',
    'teamDamageDealt',
];

export const METRIC_LABELS: Record<SimMetric, string> = {
    winRate: 'Win rate',
    rounds: 'Rounds',
    focusDamageDealt: 'Damage dealt',
    focusDamageTaken: 'Damage taken',
    focusHealingDone: 'Repairs done',
    teamDamageDealt: 'Team damage',
};

/** Metrics a candidate improves by making SMALLER. Everything else improves by growing. */
export const METRIC_LOWER_IS_BETTER: Partial<Record<SimMetric, true>> = {
    focusDamageTaken: true,
    rounds: true,
};

/** A metric's kind is a property of the METRIC, never of how one sample happened to land. A
 *  win/draw indicator puts most of its mass at zero, which the t rule badly misfits — see
 *  `PairedDelta`'s doc at the top of deltaStats.ts for why the sign test replaces it there. */
const METRIC_KIND: Record<SimMetric, PairedMetricKind> = {
    winRate: 'binary',
    rounds: 'continuous',
    focusDamageDealt: 'continuous',
    focusDamageTaken: 'continuous',
    focusHealingDone: 'continuous',
    teamDamageDealt: 'continuous',
};

/** True for every actor on the player side, including the reserved bare id `'attacker'` that
 *  player index 0 fights under (battleSimulator.ts). Only enemy actors carry the `e:` prefix, so
 *  this reads as "not an enemy" rather than "starts with `p:`" — the latter would silently drop
 *  index 0 from a team total. */
const isPlayerActor = (actorId: string): boolean => !actorId.startsWith('e:');

export function metricSeries(run: CandidateRun, metric: SimMetric): number[] {
    const { runs } = run.aggregate;
    switch (metric) {
        case 'winRate':
            return runs.map((r) => (r.winner === 'player' ? 1 : 0));
        case 'rounds':
            return runs.map((r) => r.lastRound);
        case 'focusDamageDealt':
            return runs.map((r) => r.perActor[run.focusActorId]?.damageDealt ?? 0);
        case 'focusDamageTaken':
            return runs.map((r) => r.perActor[run.focusActorId]?.damageTaken ?? 0);
        case 'focusHealingDone':
            return runs.map((r) => r.perActor[run.focusActorId]?.healingDone ?? 0);
        case 'teamDamageDealt':
            return runs.map((r) =>
                Object.entries(r.perActor)
                    .filter(([actorId]) => isPlayerActor(actorId))
                    .reduce((sum, [, totals]) => sum + totals.damageDealt, 0)
            );
    }
}

/**
 * The column a role's reader most likely wants sorted first. A suggestion, not a verdict: every
 * metric is shown for every role, because ranking a controller on any one of them is a confident
 * wrong answer.
 */
export function suggestedPrimary(role: ShipTypeName | undefined): SimMetric {
    if (matchesRoleCategory(role, ['ATTACKER'])) return 'focusDamageDealt';
    if (matchesRoleCategory(role, ['DEFENDER'])) return 'focusDamageTaken';
    if (matchesRoleCategory(role, ['SUPPORTER'])) return 'focusHealingDone';
    return 'teamDamageDealt';
}

export interface MetricCell extends PairedDelta {
    metric: SimMetric;
}

export interface CandidateRow {
    id: string;
    cells: Record<SimMetric, MetricCell>;
}

export function buildMetricTable(
    baseline: CandidateRun,
    candidates: CandidateRun[]
): CandidateRow[] {
    return candidates.map((candidate) => {
        const cells = {} as Record<SimMetric, MetricCell>;
        for (const metric of SIM_METRICS) {
            cells[metric] = {
                metric,
                ...pairedDelta(
                    metricSeries(baseline, metric),
                    metricSeries(candidate, metric),
                    METRIC_KIND[metric]
                ),
            };
        }
        return { id: candidate.id, cells };
    });
}
