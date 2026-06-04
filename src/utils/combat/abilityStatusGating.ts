import { Condition, ConditionSubject } from '../../types/abilities';

/**
 * Subjects whose live per-round counts the Phase-1 sim can derive. Conditions on
 * these gate buff/debuff abilities dynamically. Derivable conditions on any OTHER
 * subject (ally counts, enemy-buff, self-debuff — hardcoded 0 in the round context)
 * are neutralized to 'always', preserving the old static gate's "satisfiable in
 * principle" semantics: without this they would flip from included to permanently
 * excluded. Manual (non-derivable) conditions keep literal gating via manualCount.
 */
const LIVE_SUBJECTS: ReadonlySet<ConditionSubject> = new Set([
    'always',
    'enemy-debuff',
    'enemy-type',
    'self-buff',
    'self-crit',
    'hp-threshold',
    'enemy-hp-pct',
    'enemy-hp-missing-pct',
]);

/**
 * Rewrite a buff/debuff ability's conditions for in-loop dynamic gating: derivable
 * conditions on non-live subjects are neutralized to 'always' (preserving the legacy
 * static-gate semantics for counts the Phase-1 sim cannot derive); live-subject and
 * manual conditions pass through untouched.
 */
export function liveGateConditions(conditions: Condition[]): Condition[] {
    return conditions.map((c) =>
        c.derivable && !LIVE_SUBJECTS.has(c.subject)
            ? { subject: 'always' as const, derivable: true, ...(c.anyOf ? { anyOf: true } : {}) }
            : c
    );
}
