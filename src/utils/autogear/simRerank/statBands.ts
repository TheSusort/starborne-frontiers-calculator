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
    /** False when `landed` falls outside `band` — the inventory cannot satisfy the request, and
     *  the optimizer returns the nearest build WITHOUT signalling it. */
    reachable: boolean;
}

/** Up to BAND_COUNT bands, plus a baseline pass plus two probes, at roughly 105,000 evaluations
 *  per optimizer pass. This is a COST CEILING, not a tuning constant — raising it multiplies the
 *  largest compute spend in the app. */
export const BAND_COUNT = 5;

/** Pins a stat to one value. Used to discover the inventory's floor and ceiling: a band nothing
 *  can satisfy lands on the nearest reachable value, which is exactly the bound we want. */
export function probePriorities(stat: LimitableStat, value: number): StatPriority[] {
    return [{ stat, minLimit: value, maxLimit: value, hardRequirement: true }];
}

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

/** `hardRequirement` is read only by `calculateHardViolation`, which only `GeneticStrategy`
 *  calls. Under every other strategy these degrade to a soft penalty that will not hold a build
 *  inside the range — banding requires running Genetic. */
export function bandPriorities(stat: LimitableStat, band: StatBand): StatPriority[] {
    return [{ stat, minLimit: band.min, maxLimit: band.max, hardRequirement: true }];
}

export function classifyOutcome(band: StatBand, landed: number): BandOutcome {
    return { band, landed, reachable: landed >= band.min && landed <= band.max };
}
