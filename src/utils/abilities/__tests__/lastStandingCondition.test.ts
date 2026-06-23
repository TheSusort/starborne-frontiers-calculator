import { describe, it, expect } from 'vitest';
import { conditionsMet } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture';

describe('last-standing condition', () => {
    it('is met when isLastStanding is true', () => {
        const ctx = makeConditionContext({ isLastStanding: true });
        expect(conditionsMet([{ subject: 'last-standing', derivable: true }], ctx)).toBe(true);
    });
    it('is NOT met when isLastStanding is false/absent', () => {
        const ctxFalse = makeConditionContext({ isLastStanding: false });
        expect(conditionsMet([{ subject: 'last-standing', derivable: true }], ctxFalse)).toBe(
            false
        );
        const ctxAbsent = makeConditionContext({});
        expect(conditionsMet([{ subject: 'last-standing', derivable: true }], ctxAbsent)).toBe(
            false
        );
    });
});
