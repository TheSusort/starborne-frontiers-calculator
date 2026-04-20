import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants';
import type { BaseStats, Stat, StatName } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { statVectorToBaseStats, STAT_INDEX } from '../../fastScoring/statVector';
import { calculatePriorityScore } from '../../autogear/scoring';
import { GEAR_SETS } from '../../../constants/gearSets';
import { isCalibrationEligible, getCalibratedMainStat } from '../calibrationCalculator';
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

/**
 * Score with the piece applied to the afterGear baseline, plus set-bonus
 * handling. Covers three call sites:
 *   - with-ship potentialScore (piece = original or simulated upgrade)
 *   - dummy currentScore (piece = original)
 *   - dummy potentialScore (piece = simulated upgrade)
 *
 * Mutates ctx.workspace. Caller must not rely on workspace state between calls.
 */
export function scorePieceApplied(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName
): number {
    const baseline = ctx.fixedSlotBaseline ?? ctx.baselinesBySlot.get(slot);
    if (!baseline) {
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(`scorePieceApplied: missing baseline for slot ${slot}`);
        }
        console.error(`[fast-potential] missing baseline for slot ${slot}`);
        return 0;
    }

    // 1. Reset workspace from baseline.
    const w = ctx.workspace.stats;
    const src = baseline.afterGearVector;
    for (let i = 0; i < w.length; i++) w[i] = src[i];

    // 2. Copy setCount baseline into workspace.setCount.
    const wc = ctx.workspace.setCount;
    const sc = baseline.setCount;
    // The workspace.setCount is always sized to ctx.setIdToName.length;
    // baseline.setCount matches, enforced in buildPotentialContext.
    for (let i = 0; i < wc.length; i++) wc[i] = sc[i];

    // 3. Dummy-mode crit baseline adjustment.
    //    Slow-path reference: potentialCalculator.ts:646-656 + 724.
    //    The slow path sets baseStats.crit = max(0, 100 - gearCrit) BEFORE the
    //    piece stats are applied on top, so the post-apply crit sums to ~100
    //    (baseline + gear contributions cancel). The fast path must follow the
    //    same order: seed workspace.crit with the baseline here, then step 5's
    //    applyStat calls add the piece's crit contributions back on top.
    //    With-ship uses the ship's actual crit (already in afterGear); skip.
    if (!ctx.withShip) {
        let gearCrit = 0;
        if (piece.mainStat?.name === 'crit') gearCrit += piece.mainStat.value;
        if (piece.subStats) {
            for (const s of piece.subStats) if (s.name === 'crit') gearCrit += s.value;
        }
        w[STAT_INDEX.crit] = Math.max(0, 100 - gearCrit);
    }

    // 4. Resolve the piece's main stat for application (calibration).
    //    Only with-ship mode checks calibration; dummy never applies.
    let mainStat: Stat | undefined = piece.mainStat ?? undefined;
    if (
        ctx.withShip &&
        ctx.ship &&
        piece.calibration?.shipId === ctx.ship.id &&
        isCalibrationEligible(piece) &&
        mainStat
    ) {
        mainStat = getCalibratedMainStat(piece) ?? undefined;
    }

    // 5. Apply main + substats to workspace.
    if (mainStat) applyStat(mainStat, w, ctx.percentRef);
    if (piece.subStats) {
        for (const s of piece.subStats) applyStat(s, w, ctx.percentRef);
    }

    // 6. Set bonus handling — diverges by mode.
    if (piece.setBonus) {
        const setId = ctx.setNameToId.get(piece.setBonus);
        const setDef = GEAR_SETS[piece.setBonus];

        if (ctx.withShip) {
            // Deltaful: only apply when adding this piece crosses a threshold.
            if (setId !== undefined && setDef) {
                const minPieces = setDef.minPieces ?? 2;
                const before = Math.floor(baseline.setCount[setId] / minPieces);
                wc[setId]++;
                const after = Math.floor(wc[setId] / minPieces);
                const delta = after - before;
                if (delta > 0 && setDef.stats) {
                    const scale = minPieces >= 4 ? 0.5 : 1;
                    for (let k = 0; k < delta; k++) {
                        for (const s of setDef.stats) {
                            applyStat(s, w, ctx.percentRef, scale);
                        }
                    }
                }
            }
        } else {
            // Dummy optimistic: apply the set stats once if present.
            if (setDef?.stats) {
                const minPieces = setDef.minPieces ?? 2;
                const scale = minPieces >= 4 ? 0.5 : 1;
                for (const s of setDef.stats) {
                    applyStat(s, w, ctx.percentRef, scale);
                }
            }
        }
    }

    // 7. Hand off to the canonical scorer.
    const stats = statVectorToBaseStats(w);
    const baseScore = calculatePriorityScore(stats, [], ctx.shipRole);
    return baseScore + getMainStatBonus(piece, ctx.selectedStats, baseScore);
}

function applyStat(stat: Stat, target: Float64Array, percentRef: BaseStats, scale = 1): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const value = stat.value * scale;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += value;
    } else if (stat.type === 'percentage') {
        const ref = percentRef[stat.name as keyof BaseStats] ?? 0;
        target[idx] += ref * (value / 100);
    } else {
        target[idx] += value;
    }
}
