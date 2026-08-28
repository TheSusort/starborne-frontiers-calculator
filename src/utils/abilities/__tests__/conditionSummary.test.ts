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
});
