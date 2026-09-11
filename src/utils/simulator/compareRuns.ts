import type { BattleResult } from '../calculators/battleSimulator';
import type { BoardState } from '../../components/simulator/PlacementBoard';
import type { StatOverrides } from './statOverrides';
import type { SeedSetAggregate } from './seededRuns';

/** A board's overrides at one point in time, keyed `"<side>:<position>"` so both boards flatten
 *  into one object and a pinned baseline can be diffed against a later snapshot. */
export type OverrideSnapshot = Record<string, StatOverrides>;

/** A seed-set aggregate frozen as the comparison point, alongside the override snapshot that
 *  produced it. The seed and run count live inside `aggregate` — see `effectiveRunParams`' doc
 *  for how a pinned baseline forces a variant run onto this same seed set. */
export interface PinnedBaseline {
    aggregate: SeedSetAggregate;
    overrides: OverrideSnapshot;
}

/** Take a snapshot of both boards' overrides. Placements with no override are omitted — a
 *  snapshot only ever carries keys that mean something in a diff. */
export function snapshotOverrides(
    playerBoard: BoardState,
    enemyBoard: BoardState
): OverrideSnapshot {
    const snapshot: OverrideSnapshot = {};
    const boards: Array<[string, BoardState]> = [
        ['player', playerBoard],
        ['enemy', enemyBoard],
    ];
    for (const [side, board] of boards) {
        for (const [position, placement] of Object.entries(board)) {
            if (placement?.overrides && Object.keys(placement.overrides).length > 0) {
                // Copy, not alias: a pinned baseline must survive later edits to the live
                // placement's overrides object.
                snapshot[`${side}:${position}`] = { ...placement.overrides };
            }
        }
    }
    return snapshot;
}

export interface OverrideDiffRow {
    key: string;
    stat: string;
    from?: number;
    to?: number;
}

/** Diff two override snapshots down to individual stat changes: a stat gained, lost, or
 *  changed its value. Rows are sorted by key then stat so the output is stable across runs. */
export function diffOverrides(from: OverrideSnapshot, to: OverrideSnapshot): OverrideDiffRow[] {
    const rows: OverrideDiffRow[] = [];
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    for (const key of keys) {
        const fromStats = from[key] ?? {};
        const toStats = to[key] ?? {};
        const stats = new Set([...Object.keys(fromStats), ...Object.keys(toStats)]);
        for (const stat of stats) {
            const fromValue = fromStats[stat as keyof StatOverrides];
            const toValue = toStats[stat as keyof StatOverrides];
            if (fromValue !== toValue) {
                rows.push({ key, stat, from: fromValue, to: toValue });
            }
        }
    }
    rows.sort((a, b) =>
        a.key === b.key ? a.stat.localeCompare(b.stat) : a.key.localeCompare(b.key)
    );
    return rows;
}

/** True when two rosters name different actors — a different count, or the same actorId now
 *  resolving to a different ship (side/name/position). Board edits made after a baseline was
 *  pinned renumber and reassign the engine's actorIds (see `battleSimulator`'s `p:<shipId>:<i>`
 *  scheme), which can make an unrelated ship's current figures line up against the baseline's
 *  row for that id — this is the check that catches it. */
export function rostersDiffer(a: BattleResult['roster'], b: BattleResult['roster']): boolean {
    if (a.length !== b.length) return true;
    const key = (r: BattleResult['roster'][number]) =>
        `${r.actorId}|${r.side}|${r.name}|${r.position}`;
    const sortedA = a.map(key).sort();
    const sortedB = b.map(key).sort();
    return sortedA.some((k, i) => k !== sortedB[i]);
}
