import { describe, it, expect } from 'vitest';
import { conditionMet, evaluateCondition } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture';

// Model-completeness SP-D — `enemy-dot-count` (Anemone's generic "3+ Damage over Time effects"
// Taunt gate, Belladonna's named "3+ Acidic Decay" Stasis gate, Snakeroot's per-stack scaling).
describe('enemy-dot-count condition', () => {
    it('bare enemy-dot-count = sum of DoT entries (Anemone), gate gte 3', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 3 }))).toBe(true);
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 2 }))).toBe(false);
    });

    it('named family filter is 0 until the family exists (Belladonna Acidic Decay inert)', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            buffName: 'Acidic Decay',
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(conditionMet(cond, makeConditionContext({ enemyDotCount: 5 }))).toBe(false); // no Acidic Decay family yet
    });

    it('as a scaling source, returns the raw DoT entry count (Snakeroot)', () => {
        const cond = { subject: 'enemy-dot-count' as const, derivable: true };
        expect(evaluateCondition(cond, makeConditionContext({ enemyDotCount: 8 }))).toBe(8);
    });

    it('named family filter reads enemyDotFamilyCounts when populated (post-SP-E)', () => {
        const cond = {
            subject: 'enemy-dot-count' as const,
            derivable: true,
            buffName: 'Acidic Decay',
            countComparator: 'gte' as const,
            countThreshold: 3,
        };
        expect(
            conditionMet(
                cond,
                makeConditionContext({
                    enemyDotCount: 5,
                    enemyDotFamilyCounts: { 'Acidic Decay': 3 },
                })
            )
        ).toBe(true);
    });
});
