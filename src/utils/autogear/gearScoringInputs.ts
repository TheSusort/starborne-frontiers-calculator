/**
 * The two views of gear an autogear run hands to a strategy, built from one
 * source so they cannot disagree.
 *
 * Autogear has two scoring paths and they read gear differently:
 *
 *   - the SLOW path (`calculateTotalStats`) resolves each equipped id through
 *     the gear GETTER;
 *   - the FAST path (`fastScoring/gearRegistry`) precomputes a stat vector per
 *     piece straight off the inventory ARRAY.
 *
 * GeneticStrategy reads both in one run: fitness goes through the fast context
 * (or the slow path when `USE_FAST_SCORING` is off), while hard-requirement
 * checks, set counting and the `VERIFY_FAST_SCORING` cross-check resolve gear
 * through the getter. So any transform applied to one view and not the other
 * makes a run rank gear on one set of stats and check it against another. That
 * was issue #338: "Use upgraded stats" wrapped the getter but never the array, so
 * the fast path scored sub-level-16 gear from its raw stored main stat.
 *
 * The fix is structural rather than a second transform: build the array BY
 * mapping it through the finished getter. A future transform added to the
 * getter chain lands on both views automatically.
 */

import { GearPiece } from '../../types/gear';
import { makeAssumedCalibrationGetter } from '../gear/assumedCalibration';

export interface GearScoringInputs {
    /** Feeds the fast path's gear registry. */
    scoredInventory: GearPiece[];
    /** Feeds the slow path's `calculateTotalStats`. */
    getGearForShip: (id: string) => GearPiece | undefined;
}

export interface GearScoringInputsParams {
    /** Candidate pieces for this ship, already filtered for availability. */
    availableInventory: readonly GearPiece[];
    /** Resolves a gear id to its stored piece. */
    getGearPiece: (id: string) => GearPiece | undefined;
    /** Resolves a gear id to its simulated level-16 piece. */
    upgradedGearGetter: (id: string) => GearPiece | undefined;
    useUpgradedStats: boolean;
    assumeCalibrated: boolean;
}

export function buildGearScoringInputs({
    availableInventory,
    getGearPiece,
    upgradedGearGetter,
    useUpgradedStats,
    assumeCalibrated,
}: GearScoringInputsParams): GearScoringInputs {
    // Stored mainStat values are always BASE (uncalibrated) — the import
    // pipeline normalises calibrated gear at import time. calculateTotalStats
    // applies the real calibration bonus only when gear.calibration.shipId ===
    // the target ship's id, so no reversal is needed here.
    const baseGearGetter = useUpgradedStats ? upgradedGearGetter : getGearPiece;
    // Assumed calibration wraps OUTSIDE the upgraded-stats getter, so the bonus
    // lands on the simulated level-16 main stat rather than the level-0 one.
    const transformedGearGetter = assumeCalibrated
        ? makeAssumedCalibrationGetter(baseGearGetter, useUpgradedStats)
        : baseGearGetter;

    // A candidate the getter cannot resolve keeps its array entry rather than
    // vanishing from the pool.
    const scoredInventory = availableInventory.map(
        (piece) => transformedGearGetter(piece.id) ?? piece
    );

    // The getter answers every candidate id from the array itself — the SAME
    // object, so the two views cannot report different stats for a candidate,
    // including one only the array could resolve. Ids outside the pool (gear
    // equipped on the ship but filtered out of it) fall through unchanged.
    const scoredById = new Map(scoredInventory.map((piece) => [piece.id, piece]));
    const getGearForShip = (id: string): GearPiece | undefined =>
        scoredById.get(id) ?? transformedGearGetter(id);

    return { scoredInventory, getGearForShip };
}
