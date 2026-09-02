import type { Position } from '../../../types/encounters';
import type { CombatLogEntryKind } from '../log/types';

export type InteractionClass =
    | 'leader-aura'
    | 'reactive-trigger'
    | 'persistent-stacking'
    | 'detonation-bomb'
    | 'protection-redirect'
    | 'cleanse-purge'
    | 'control'
    | 'shield'
    | 'stealth';

export type OracleKind = 'invariant' | 'differential' | 'ablation';

export interface InvariantViolation {
    /** Stable id of the invariant, e.g. 'hp-bounds'. */
    invariant: string;
    /** Round the violation was observed in (0 for whole-battle invariants). */
    round: number;
    actorId?: string;
    detail: string;
}

export interface FingerprintDiff {
    actorId: string;
    shipName: string;
    /** Log-kinds the ship produced solo but NOT in composition (suppressed). */
    missingInComposition: CombatLogEntryKind[];
    /** Log-kinds the ship produced in composition but NEVER solo (spurious). */
    extraInComposition: CombatLogEntryKind[];
}

export interface AblationResult {
    /** True when {A+B} per-actor fingerprint is NOT explained by {A}∪{B}. */
    diverges: boolean;
    detail: string;
}

export interface Finding {
    oracle: OracleKind;
    ships: string[];
    slots: Position[];
    seed: number;
    /** Populated per-oracle: invariant id, or fingerprint diff, or ablation detail. */
    invariant?: string;
    fingerprintDiff?: FingerprintDiff;
    ablationDetail?: string;
    minimalRepro?: { playerShips: string[]; enemyShips: string[] };
    severity: 'high' | 'med' | 'low';
}

/** Which of the engine's three actor paths runs the subject. `playerTeam[0]` becomes the
 *  `'attacker'` focus by ARRAY INDEX (in `battleSimulator`), `playerTeam[1..3]` become `'team'`
 *  walked actors, and the enemy side is `'enemy'` — three distinct code paths for the same kit. */
export type Placement = 'focus' | 'team' | 'enemy';

export const PLACEMENTS: readonly Placement[] = ['focus', 'team', 'enemy'] as const;

/** The unordered pairs to compare. Each yields TWO findings-directions (a→b and b→a), so all six
 *  ordered comparisons are covered without duplicating a pair. */
export const PLACEMENT_PAIRS: readonly (readonly [Placement, Placement])[] = [
    ['focus', 'team'],
    ['focus', 'enemy'],
    ['team', 'enemy'],
] as const;

/** One directed placement asymmetry: kinds the subject produced in `from` but never in `to`.
 *  `missing` is non-empty by construction — `diffPlacements` returns null otherwise. */
export interface PlacementDiff {
    shipName: string;
    from: Placement;
    to: Placement;
    missing: CombatLogEntryKind[];
}
