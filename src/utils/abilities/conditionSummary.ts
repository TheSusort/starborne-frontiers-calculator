import type { Condition, ConditionSubject } from '../../types/abilities';

/**
 * The subject-label vocabulary ConditionRow's dropdown and conditionSummary share.
 *
 * Moved here (not copied) from two former sources so there is exactly one copy:
 * - `EXTRA_SUBJECT_LABELS`, previously file-local to `ConditionRow.tsx`.
 * - `CONDITIONAL_CONDITION_LABELS`, previously exported from `src/types/calculator.ts`
 *   keyed by the narrower `ConditionalCondition` union (a subset of `ConditionSubject`
 *   used by the older DPS/charge-gain "conditional" model). It had no other consumer.
 *
 * `ConditionRow.subjectLabel` used to resolve `EXTRA_SUBJECT_LABELS[subject] ??
 * CONDITIONAL_CONDITION_LABELS[subject] ?? subject` — i.e. the extra-labels object won
 * on a key collision. Only one key collided ('always': 'Always' vs 'every round'), so
 * that entry is listed last below to preserve the exact same winner.
 */
export const CONDITION_SUBJECT_LABELS: Partial<Record<ConditionSubject, string>> = {
    // Formerly CONDITIONAL_CONDITION_LABELS (src/types/calculator.ts).
    'self-buff': 'per buff on this unit',
    'enemy-debuff': 'per debuff on the enemy',
    'enemy-buff': 'per buff on the enemy',
    'adjacent-ally': 'per adjacent ally',
    'enemy-adjacent': 'per unit adjacent to the enemy',
    'enemy-destroyed': 'per destroyed enemy',
    'self-crit': 'on critical hit',
    'enemy-type': 'when enemy matches type',
    // Formerly EXTRA_SUBJECT_LABELS (src/components/skills/ConditionRow.tsx).
    always: 'Always',
    'self-debuff': 'per debuff on this unit',
    'hp-threshold': 'when HP crosses a threshold',
    'enemy-hp-pct': "per point of the enemy's current HP %",
    'enemy-hp-missing-pct': "per point of the enemy's missing HP %",
    'ally-inflicts-debuff': 'when an ally inflicts a debuff',
    'ally-critically-repaired': 'after an ally is critically repaired',
    'ally-crit-dot': 'when an ally crits with a DoT',
    'ally-on-team': 'when a specific ally is on the team',
    'lowest-speed-ally': 'when this unit has the lowest Speed among allies',
    'target-repaired-this-round': 'when the target was repaired this round',
};

/** Human-facing name for `Condition.hpSubject`. 'self' is deliberately absent — it
 *  renders bare ("below 60% HP") rather than "below 60% self HP". */
const HP_SUBJECT_NAMES: Partial<Record<NonNullable<Condition['hpSubject']>, string>> = {
    enemy: 'enemy',
    target: 'heal target',
};

const fallbackLabel = (subject: ConditionSubject): string =>
    CONDITION_SUBJECT_LABELS[subject] ?? subject;

/** Human-readable one-line summary of a gating condition, e.g. "below 60% HP".
 *
 * Renders the SPECIFIC phrasing for the subjects that carry enough data for one
 * (`hp-threshold`'s comparator/percentage/whose-HP, a named buff/debuff on
 * `self-buff`/`self-debuff`/`enemy-buff`/`enemy-debuff`, a required enemy type on
 * `enemy-type` honouring `negate`) and falls back to `CONDITION_SUBJECT_LABELS[subject]`
 * for everything else — including a buff/debuff/enemy-type subject missing the field
 * it needs for the specific phrasing.
 *
 * Fields deliberately NOT read here (see `src/types/abilities.ts`'s `Condition` for the
 * full list): `manualCount` (only meaningful with `derivable: false`, an authoring
 * detail, not part of what the condition itself says); `anyOf` (governs how this
 * condition combines with the PREVIOUS one in a list — a fact about the list, not this
 * condition); `countComparator`/`countThreshold` (threshold gating for count subjects —
 * the generic subject labels above already describe the rate/count vocabulary, e.g.
 * "per debuff on the enemy", without needing a specific number); `period`/`offset`
 * (only used by `every-n-turns`, itself only reached via the fallback label); and
 * `compareStat`/`statComparator` (only used by `stat-vs-target`, likewise
 * fallback-only). None of these change what a SINGLE condition's one-line phrase says
 * about itself.
 */
export function conditionSummary(condition: Condition): string {
    switch (condition.subject) {
        case 'hp-threshold': {
            const comparator = condition.hpComparator ?? 'below';
            const percent = condition.hpPercent ?? 0;
            const hpSubject = condition.hpSubject ?? 'enemy';
            const whose =
                hpSubject === 'self' ? '' : `${HP_SUBJECT_NAMES[hpSubject] ?? hpSubject} `;
            return `${comparator} ${percent}% ${whose}HP`;
        }
        case 'self-buff':
            return condition.buffName
                ? `while ${condition.buffName} is active`
                : fallbackLabel(condition.subject);
        case 'self-debuff':
            return condition.buffName
                ? `while affected by ${condition.buffName}`
                : fallbackLabel(condition.subject);
        case 'enemy-buff':
            return condition.buffName
                ? `while the enemy has ${condition.buffName}`
                : fallbackLabel(condition.subject);
        case 'enemy-debuff':
            return condition.buffName
                ? `while the enemy is affected by ${condition.buffName}`
                : fallbackLabel(condition.subject);
        case 'enemy-type':
            if (!condition.requiredEnemyType) return fallbackLabel(condition.subject);
            return condition.negate
                ? `when targeting a non-${condition.requiredEnemyType}`
                : `when targeting a ${condition.requiredEnemyType}`;
        default:
            return fallbackLabel(condition.subject);
    }
}
