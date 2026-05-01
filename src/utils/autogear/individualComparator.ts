/**
 * Minimal shape needed for feasibility-ranked comparison.
 * GeneticStrategy's Individual (with equipment) is assignable to this.
 */
export interface FeasibilityRanked {
    fitness: number;
    violation: number;
}

/**
 * Feasibility-aware comparator.
 *
 * 1. Feasible (violation === 0) always beats infeasible, ignoring fitness.
 * 2. Among feasible individuals, higher fitness ranks first.
 * 3. Among infeasible individuals, higher fitness ranks first — because the
 *    penalty system already encodes violations into fitness proportionally
 *    (each violation unit → 100 penalty points → proportional fitness reduction),
 *    making fitness the richer combined signal. Violation is only a tiebreaker
 *    when both fitness values are equal (e.g. both collapsed to 0 due to
 *    accumulated penalty overflow from many simultaneous constraint violations).
 *
 * Usage: pass as an Array.prototype.sort comparator. Return < 0 means a
 * ranks before b; return > 0 means b ranks before a.
 */
export function compareIndividuals(a: FeasibilityRanked, b: FeasibilityRanked): number {
    const aFeasible = a.violation === 0;
    const bFeasible = b.violation === 0;
    if (aFeasible && !bFeasible) return -1;
    if (!aFeasible && bFeasible) return 1;
    if (aFeasible && bFeasible) return b.fitness - a.fitness;
    // Among infeasible: fitness is the primary signal (penalty already reflects violation).
    // Fall back to lower violation when fitness is equal (both likely = 0).
    if (a.fitness !== b.fitness) return b.fitness - a.fitness;
    return a.violation - b.violation;
}
