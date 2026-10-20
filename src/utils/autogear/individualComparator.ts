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
 * 3. Among infeasible individuals, lower violation ranks first, and fitness
 *    only breaks a violation tie. When no build can meet the hard requirements,
 *    the suggestion is the one that comes closest to them (a 200-speed build
 *    beats a stronger 166-speed build when 215 speed is required), not the one
 *    the role formula prefers.
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
    if (a.violation !== b.violation) return a.violation - b.violation;
    return b.fitness - a.fitness;
}
