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
