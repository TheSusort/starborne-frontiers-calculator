// Not mounted in the UI. Retained as the owner-side tool for locating the threshold on the two
// GATED ships (Xcellence, Vindicator), whose off-stat channel switches on at a boundary against
// the opponent's security/hacking and so cannot be expressed as a weighted basis. #544.

import type { StatPriority } from '../../../types/autogear';
import type { LimitableStat } from '../../../types/stats';

export interface StatBand {
    min: number;
    max: number;
}

export interface BandOutcome {
    band: StatBand;
    /** The stat value the optimizer actually reached. */
    landed: number;
    /** False when `landed` falls outside `band`. Not a failure: the band is a preference, so
     *  this says the optimizer PREFERRED to sit outside it — see `bandPriorities`. */
    withinBand: boolean;
}

/** Up to BAND_COUNT bands, plus a baseline pass — one optimizer pass each, and the whole cost of
 *  a tuning run's gearing phase. The achievable range itself is read off the inventory
 *  (`statBoundsFromInventory`) rather than searched for, so no pass is spent finding it. This is
 *  a COST CEILING, not a tuning constant — raising it multiplies the largest compute spend in
 *  the app. */
export const BAND_COUNT = 5;

/**
 * Splits `[floor, ceiling]` into up to `BAND_COUNT` contiguous bands.
 *
 * Each interior boundary is computed once and shared by the band below (as `max`) and the band
 * above (as `min`), so bands always touch exactly — there is no value a real build could land on
 * that falls between two bands. The first and last boundaries are the exact `floor`/`ceiling`,
 * not rounded approximations, so a build sitting at either edge of the achievable range always
 * lands inside a band instead of just outside it. Interior boundaries are rounded to land on
 * values a real build can reach; a boundary is kept only when it lands strictly between the
 * previous kept boundary and `ceiling`, so a boundary that rounds below the (possibly fractional)
 * `floor`, or that collides with or overshoots a neighbour, is dropped rather than producing an
 * inverted (`min > max`) or degenerate (`min === max`) band.
 */
export function bandsBetween(floor: number, ceiling: number): StatBand[] {
    if (floor > ceiling) {
        throw new Error(`band floor ${floor} exceeds ceiling ${ceiling}`);
    }
    if (floor === ceiling) return [{ min: floor, max: ceiling }];

    const width = (ceiling - floor) / BAND_COUNT;
    const boundaries: number[] = [floor];
    for (let i = 1; i < BAND_COUNT; i++) {
        const boundary = Math.round(floor + width * i);
        const last = boundaries[boundaries.length - 1];
        if (boundary > last && boundary < ceiling) {
            boundaries.push(boundary);
        }
    }
    boundaries.push(ceiling);

    const bands: StatBand[] = [];
    for (let i = 1; i < boundaries.length; i++) {
        bands.push({ min: boundaries[i - 1], max: boundaries[i] });
    }
    return bands;
}

/**
 * A band is a SOFT limit — deliberately no `hardRequirement`.
 *
 * `hardRequirement` states a bound the player already knows and is certain about ("this ship
 * must reach 152 speed"). A tuning run is the opposite situation: nobody knows where the bound
 * belongs, which is the thing being measured. Pinning a guess as a hard requirement would assert
 * a certainty the run does not have and make the optimizer fail outright rather than report what
 * it preferred.
 *
 * So the band biases the search and the optimizer may overrule it. Seeing WHERE it overruled the
 * band, and by how much, is part of what the table is for — that is why `classifyOutcome`
 * reports a landed value outside the band as a result rather than an error.
 */
export function bandPriorities(stat: LimitableStat, band: StatBand): StatPriority[] {
    return [{ stat, minLimit: band.min, maxLimit: band.max }];
}

export function classifyOutcome(band: StatBand, landed: number): BandOutcome {
    return { band, landed, withinBand: landed >= band.min && landed <= band.max };
}
