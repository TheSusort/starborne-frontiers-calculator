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
     *  the optimizer returns its best infeasible build WITHOUT signalling it. */
    reachable: boolean;
}

/** Up to BAND_COUNT bands, plus a baseline pass, plus two probes. Each band and the baseline run
 *  one GA attempt; each probe pins a value no build can satisfy, so it never meets its hard
 *  requirement and runs every attempt `GeneticStrategy` allows. This is a COST CEILING, not a
 *  tuning constant — raising it multiplies the largest compute spend in the app. */
export const BAND_COUNT = 5;

/** The ceiling probe pins the stat here. Every real build falls short of it, so
 *  `calculatePriorityScore`'s soft minLimit penalty leaves a fitness of
 *  `roleScore * value / CEILING_PROBE_VALUE` — the search maximises the role score TIMES the
 *  stat, which pushes the stat up. A trade-off rather than a pure maximiser: a build that scores
 *  far better on the role formula can still outrank a slightly higher stat value. */
const CEILING_PROBE_VALUE = 1e9;

/** The floor probe pins the stat here, NOT at 0: `calculatePriorityScore` and
 *  `calculateHardViolation` both truthy-check the limits, so a limit of 0 is read as "no limit"
 *  and the probe degrades into an unconstrained run.
 *
 *  At 1, any build whose value is at least 2 overshoots by more than 100% of the limit, the
 *  penalty drives `Math.max(0, ...)` to exactly 0, and `compareIndividuals` falls through to its
 *  violation tiebreak — which orders by `value - 1`, i.e. by the stat itself, ascending. That
 *  tiebreak, not the penalty gradient, is what makes this probe an exact minimiser wherever the
 *  whole population sits at 2 or above, which is every flat stat on a real ship. A stat whose
 *  achievable values are small single digits — `shield` is a per-round percentage — can put
 *  builds below 2, where fitness stays positive and the probe becomes a role-score trade-off
 *  like the ceiling probe rather than an exact minimiser. */
const FLOOR_PROBE_VALUE = 1;

function pinPriorities(stat: LimitableStat, value: number): StatPriority[] {
    return [{ stat, minLimit: value, maxLimit: value, hardRequirement: true }];
}

/** Drives the optimizer to the LOWEST value of `stat` its inventory can reach. */
export function floorProbePriorities(stat: LimitableStat): StatPriority[] {
    return pinPriorities(stat, FLOOR_PROBE_VALUE);
}

/** Drives the optimizer towards the HIGHEST value of `stat` its inventory can reach. */
export function ceilingProbePriorities(stat: LimitableStat): StatPriority[] {
    return pinPriorities(stat, CEILING_PROBE_VALUE);
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
