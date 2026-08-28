import { describe, it, expect } from 'vitest';
import { conditionSummary } from '../conditionSummary';

describe('conditionSummary', () => {
    it('renders a self HP threshold with its comparator and percentage', () => {
        expect(
            conditionSummary({
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 60,
                hpSubject: 'self',
            })
        ).toBe('below 60% HP');
    });

    it('names WHOSE HP when it is not this ship', () => {
        expect(
            conditionSummary({
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'above',
                hpPercent: 50,
                hpSubject: 'enemy',
            })
        ).toBe('above 50% enemy HP');
    });

    it('renders a named self-buff gate', () => {
        expect(
            conditionSummary({ subject: 'self-buff', derivable: true, buffName: 'Stealth' })
        ).toBe('while Stealth is active');
    });

    it('renders an enemy-type gate', () => {
        expect(
            conditionSummary({
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: 'Defender',
            })
        ).toBe('when targeting a Defender');
    });

    it('falls back to the subject label for a gate with no specific phrasing', () => {
        expect(conditionSummary({ subject: 'lowest-speed-ally', derivable: true })).toContain(
            'lowest Speed'
        );
    });

    // --- Decisions on the Condition fields the brief's examples don't exercise ---

    it('names the heal target when hpSubject is "target"', () => {
        expect(
            conditionSummary({
                subject: 'hp-threshold',
                derivable: true,
                hpComparator: 'below',
                hpPercent: 25,
                hpSubject: 'target',
            })
        ).toBe('below 25% heal target HP');
    });

    it('defaults hpSubject to enemy and hpComparator to below when omitted', () => {
        expect(conditionSummary({ subject: 'hp-threshold', derivable: true, hpPercent: 10 })).toBe(
            'below 10% enemy HP'
        );
    });

    it('renders a named self-debuff gate', () => {
        expect(
            conditionSummary({ subject: 'self-debuff', derivable: true, buffName: 'Corrosion' })
        ).toBe('while affected by Corrosion');
    });

    it('renders a named enemy-buff gate', () => {
        expect(
            conditionSummary({ subject: 'enemy-buff', derivable: true, buffName: 'Taunt' })
        ).toBe('while the enemy has Taunt');
    });

    it('renders a named enemy-debuff gate', () => {
        expect(
            conditionSummary({ subject: 'enemy-debuff', derivable: true, buffName: 'Exposed' })
        ).toBe('while the enemy is affected by Exposed');
    });

    it('honours negate on an enemy-type gate', () => {
        expect(
            conditionSummary({
                subject: 'enemy-type',
                derivable: true,
                requiredEnemyType: 'Defender',
                negate: true,
            })
        ).toBe('when targeting a non-Defender');
    });

    it('falls back to the subject label for a buff/debuff subject with no buffName', () => {
        expect(conditionSummary({ subject: 'enemy-buff', derivable: true })).toBe(
            'per buff on the enemy'
        );
    });

    it('falls back to the subject label for enemy-type with no requiredEnemyType', () => {
        expect(conditionSummary({ subject: 'enemy-type', derivable: true })).toBe(
            'when enemy matches type'
        );
    });

    // --- countComparator/countThreshold: a binary THRESHOLD, not the per-unit scaling rate the
    // generic subject labels describe. Only reached when the condition carries no buffName. ---

    it('renders a count threshold with "at least" for gte', () => {
        expect(
            conditionSummary({
                subject: 'enemy-debuff',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 3,
            })
        ).toBe('while the enemy has at least 3 debuffs');
    });

    it('renders a count threshold with "at most" for lte', () => {
        expect(
            conditionSummary({
                subject: 'enemy-debuff',
                derivable: true,
                countComparator: 'lte',
                countThreshold: 2,
            })
        ).toBe('while the enemy has at most 2 debuffs');
    });

    it('renders a count threshold with "exactly" for eq, singular at 1', () => {
        expect(
            conditionSummary({
                subject: 'enemy-debuff',
                derivable: true,
                countComparator: 'eq',
                countThreshold: 1,
            })
        ).toBe('while the enemy has exactly 1 debuff');
    });

    it('renders count thresholds for self-buff, self-debuff, enemy-buff, adjacency and destroyed subjects', () => {
        expect(
            conditionSummary({
                subject: 'self-buff',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 2,
            })
        ).toBe('while this unit has at least 2 buffs');
        expect(
            conditionSummary({
                subject: 'self-debuff',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 1,
            })
        ).toBe('while this unit has at least 1 debuff');
        expect(
            conditionSummary({
                subject: 'enemy-buff',
                derivable: true,
                countComparator: 'lte',
                countThreshold: 1,
            })
        ).toBe('while the enemy has at most 1 buff');
        expect(
            conditionSummary({
                subject: 'adjacent-ally',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 2,
            })
        ).toBe('while this unit has at least 2 adjacent allies');
        expect(
            conditionSummary({
                subject: 'enemy-adjacent',
                derivable: true,
                countComparator: 'eq',
                countThreshold: 1,
            })
        ).toBe('while exactly 1 unit is adjacent to the enemy');
        expect(
            conditionSummary({
                subject: 'enemy-destroyed',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 3,
            })
        ).toBe('while at least 3 enemies have been destroyed');
    });

    it('ignores countComparator/countThreshold when buffName is set — the named phrasing wins', () => {
        expect(
            conditionSummary({
                subject: 'enemy-debuff',
                derivable: true,
                buffName: 'Exposed',
                countComparator: 'gte',
                countThreshold: 3,
            })
        ).toBe('while the enemy is affected by Exposed');
    });

    it('ignores anyOf, countComparator/countThreshold, period/offset, and compareStat/statComparator', () => {
        // These fields drive OR-combination across a condition LIST, count-threshold gating,
        // periodic-turn gating, and owner-vs-target stat comparisons respectively — none of
        // them change what a SINGLE condition's one-line phrase says about itself, so they are
        // deliberately not read here. Covered by regression, not by inspecting output shape.
        expect(
            conditionSummary({
                subject: 'enemy-debuff',
                derivable: true,
                buffName: 'Exposed',
                anyOf: true,
                countComparator: 'gte',
                countThreshold: 3,
                period: 2,
                offset: 1,
                compareStat: 'speed',
                statComparator: 'gt',
            })
        ).toBe('while the enemy is affected by Exposed');
    });

    // --- Task 9 (#391 review): three subjects with no CONDITION_SUBJECT_LABELS entry, which
    // previously made conditionSummary print the raw enum string. ---

    it('renders a readable label for every-n-turns instead of the raw enum', () => {
        expect(
            conditionSummary({ subject: 'every-n-turns', derivable: true, period: 2, offset: 1 })
        ).toBe('on a recurring turn interval');
    });

    it('renders a readable label for stat-vs-target instead of the raw enum', () => {
        expect(
            conditionSummary({
                subject: 'stat-vs-target',
                derivable: true,
                compareStat: 'speed',
                statComparator: 'gt',
            })
        ).toBe("when a stat compares favourably to the target's");
    });

    it('renders a readable fallback label for enemy-dot-count with no threshold', () => {
        expect(conditionSummary({ subject: 'enemy-dot-count', derivable: true })).toBe(
            'per DoT effect on the enemy'
        );
    });

    it('renders enemy-dot-count with a count threshold and no named DoT family', () => {
        expect(
            conditionSummary({
                subject: 'enemy-dot-count',
                derivable: true,
                countComparator: 'gte',
                countThreshold: 3,
            })
        ).toBe('while the enemy has at least 3 DoTs');
    });

    it('renders enemy-dot-count singular at threshold 1', () => {
        expect(
            conditionSummary({
                subject: 'enemy-dot-count',
                derivable: true,
                countComparator: 'eq',
                countThreshold: 1,
            })
        ).toBe('while the enemy has exactly 1 DoT');
    });

    it('renders enemy-dot-count with a named DoT family, combining threshold and name', () => {
        expect(
            conditionSummary({
                subject: 'enemy-dot-count',
                derivable: true,
                buffName: 'Acidic Decay',
                countComparator: 'gte',
                countThreshold: 3,
            })
        ).toBe('while the enemy has at least 3 Acidic Decay');
    });
});
