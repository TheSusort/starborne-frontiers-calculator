import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants';
import type { StatName } from '../../../types/stats';
import { statVectorToBaseStats } from '../../fastScoring/statVector';
import { calculatePriorityScore } from '../../autogear/scoring';
import type { PotentialContext } from './potentialContext';

/**
 * Score the baseline (no piece applied). With-ship mode only — scores
 * baseline.final, i.e. the ship state without this slot's gear.
 *
 * Dummy mode must NOT call this; dummy has no "ship without this slot"
 * concept, and its current/potential both flow through scorePieceApplied.
 */
export function scoreCurrentWithShip(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName
): number {
    const baseline = ctx.fixedSlotBaseline ?? ctx.baselinesBySlot.get(slot);
    if (!baseline || !baseline.finalVector) {
        // Should never happen: dev throws, prod degrades to 0 so a single
        // missing baseline can't break the whole session.
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(`scoreCurrentWithShip: missing finalVector for slot ${slot}`);
        }
        // eslint-disable-next-line no-console
        console.error(`[fast-potential] missing finalVector for slot ${slot}`);
        return 0;
    }

    const stats = statVectorToBaseStats(baseline.finalVector);
    const baseScore = calculatePriorityScore(stats, [], ctx.shipRole);
    return baseScore + getMainStatBonus(piece, ctx.selectedStats, baseScore);
}

function getMainStatBonus(
    piece: GearPiece,
    selectedStats: readonly StatName[],
    baseScore: number
): number {
    if (selectedStats.length === 0 || !piece.mainStat) return 0;
    if (selectedStats.includes(piece.mainStat.name)) return baseScore * 0.5;
    return 0;
}

// Exported for reuse by scorePieceApplied (Task 9).
export { getMainStatBonus };
