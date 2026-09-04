import type { GearPiece } from '../../types/gear';
import type { BaseStats, PercentageOnlyStats, Stat } from '../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../types/stats';
import type { ShipTypeName } from '../../constants/shipTypes';
import { getBaseRoleStats } from '../../constants/roleBaseStats';
import { calculateRoleScore } from '../autogear/priorityScore';

/** Only fully-levelled gear counts as supply. */
export const COVERAGE_MIN_LEVEL = 16;

/** How deep into the quality tail the headroom gap looks. */
export const COVERAGE_SAMPLE_SIZE = 20;

/**
 * Add one gear stat to a stat block. This mirrors `addStatModifier` in
 * `src/utils/ship/statsCalculator.ts` — the canonical rule for every stat in
 * the app — which has exactly three cases and no per-stat special cases:
 * a percentage-only stat (crit, critDamage, ...) is stored as an integer and
 * adds directly; a percentage-typed flexible stat (including speed, hacking
 * and security) adds a share of the reference block; a flat stat adds its
 * value. If that function gains a case, this one must gain it too.
 */
function addStat(stat: Stat, target: BaseStats, reference: BaseStats): void {
    const isPercentageOnly = PERCENTAGE_ONLY_STATS.includes(stat.name as PercentageOnlyStats);
    if (isPercentageOnly) {
        target[stat.name] = (target[stat.name] ?? 0) + stat.value;
    } else if (stat.type === 'percentage') {
        target[stat.name] =
            (target[stat.name] ?? 0) + (reference[stat.name] ?? 0) * (stat.value / 100);
    } else {
        target[stat.name] = (target[stat.name] ?? 0) + stat.value;
    }
}

/** Baseline role scores never change, so compute each one once. */
const baselineScoreByRole = new Map<ShipTypeName, number>();

function getBaselineScore(role: ShipTypeName): number {
    const cached = baselineScoreByRole.get(role);
    if (cached !== undefined) return cached;
    const score = calculateRoleScore(role, getBaseRoleStats(role));
    baselineScoreByRole.set(role, score);
    return score;
}

/**
 * How much this piece raises the role's dummy baseline score.
 *
 * Deliberately NOT the dummy path in potentialCalculator: that one rebaselines
 * crit to `100 - the piece's own crit`, which is fair for a within-piece
 * before/after delta and useless across pieces (it neutralises crit entirely).
 * Set bonuses and calibration are excluded — read the spec's Metric section.
 */
export function scorePieceForRole(piece: GearPiece, role: ShipTypeName): number {
    const baseline = getBaseRoleStats(role);
    const withPiece: BaseStats = { ...baseline };

    if (piece.mainStat) addStat(piece.mainStat, withPiece, baseline);
    for (const sub of piece.subStats ?? []) addStat(sub, withPiece, baseline);

    return calculateRoleScore(role, withPiece) - getBaselineScore(role);
}

/**
 * How much farming headroom a set of marginal scores implies, in [0, 1].
 *
 * 0 means the top of the distribution is filled in — the best piece is no
 * better than the next 19, so further drops will not move the needle.
 * 1 means all the quality sits in one piece (or there is no piece at all).
 *
 * Substats roll randomly, so the spread of the top order statistics shrinks
 * as the sample grows: this measures how deep into the tail the player has
 * already sampled, which raw counts cannot.
 */
export function computeHeadroom(marginals: number[]): number {
    const sample = [...marginals].sort((a, b) => b - a).slice(0, COVERAGE_SAMPLE_SIZE);
    if (sample.length <= 1) return 1;

    const best = sample[0];
    if (best <= 0) return 1;

    const rest = sample.slice(1);
    const restMean = rest.reduce((sum, value) => sum + value, 0) / rest.length;

    const gap = (best - restMean) / best;
    return Math.min(1, Math.max(0, gap));
}
