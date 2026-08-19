/**
 * "Assume all gear is calibrated" — the autogear mode that scores every
 * calibration-eligible piece as if it were calibrated to the ship being
 * optimized, so gear competes on its ceiling rather than on whichever ship
 * happens to hold its calibration today.
 *
 * Design note — BAKE, DON'T TAG. This module writes the calibrated value
 * straight into a copy of the piece's mainStat and strips the `calibration`
 * field, rather than tagging the piece with `calibration: { shipId }`.
 * Two reasons:
 *
 *   1. Both downstream consumers (statsCalculator.ts and
 *      fastScoring/gearRegistry.ts) gate on isCalibrationEligible(), which
 *      hard-requires level === 16. A tagged sub-16 piece under "Use upgraded
 *      stats" would silently receive no bonus.
 *   2. Stripping `calibration` prevents DOUBLE APPLICATION on a piece already
 *      calibrated to the target ship — it would otherwise get the bonus once
 *      from here and again from the consumer.
 *
 * See docs/superpowers/specs/2026-08-19-autogear-assume-calibrated-design.md
 */

import { GearPiece } from '../../types/gear';
import { applyCalibrationToStat } from './calibrationUtils';

/**
 * Relaxed calibration eligibility for the assumed-calibration mode.
 *
 * Real calibration additionally requires level 16 (see isCalibrationEligible).
 * When `allowSimulatedLevel` is true — i.e. the ship's "Use upgraded stats" is
 * on, so sub-16 gear is being scored at its simulated level-16 stats — the
 * level requirement is dropped, because such a piece WOULD be eligible once
 * upgraded. Both toggles then answer the same question: what is the ceiling if
 * I invest in this gear?
 */
export function assumedCalibrationEligible(gear: GearPiece, allowSimulatedLevel: boolean): boolean {
    return (
        !gear.slot.includes('implant') &&
        (gear.stars === 5 || gear.stars === 6) &&
        (gear.level === 16 || allowSimulatedLevel)
    );
}

/**
 * Return a copy of `gear` scored as if calibrated to the ship being optimized.
 * Ineligible pieces, and pieces with no main stat, are returned unchanged (by
 * reference) so callers can map an entire inventory cheaply.
 *
 * Sub-stats are never touched — calibration only affects the main stat.
 */
export function withAssumedCalibration(gear: GearPiece, allowSimulatedLevel: boolean): GearPiece {
    if (!gear.mainStat || !assumedCalibrationEligible(gear, allowSimulatedLevel)) {
        return gear;
    }
    return {
        ...gear,
        mainStat: {
            ...gear.mainStat,
            value: applyCalibrationToStat(gear.mainStat, gear.stars),
        },
        calibration: undefined,
    };
}

/**
 * Wrap a gear getter so every piece it returns is scored as if calibrated.
 *
 * Memoised: the slow scoring path calls the getter once per gear per scored
 * loadout, so an unmemoised wrapper would allocate a fresh object on every call
 * inside the optimizer's hot loop. The cache lives as long as the wrapper, i.e.
 * one autogear run for one ship.
 *
 * Compose this OUTSIDE any upgraded-stats getter — assumed(upgraded(get)) — so
 * the bonus applies to the simulated level-16 main stat rather than the level-0
 * one.
 */
export function makeAssumedCalibrationGetter(
    getGearPiece: (id: string) => GearPiece | undefined,
    allowSimulatedLevel: boolean
): (id: string) => GearPiece | undefined {
    const cache = new Map<string, GearPiece | undefined>();
    return (id: string) => {
        if (cache.has(id)) return cache.get(id);
        const piece = getGearPiece(id);
        const transformed = piece ? withAssumedCalibration(piece, allowSimulatedLevel) : undefined;
        cache.set(id, transformed);
        return transformed;
    };
}
