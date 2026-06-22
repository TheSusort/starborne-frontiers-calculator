import { describe, it, expect } from 'vitest';
import { conditionsMet } from '../evaluateConditions';
import { makeConditionContext } from './conditionContextFixture';

describe('first-activator condition', () => {
    it('is met when firstActivator is true', () => {
        const ctx = makeConditionContext({ firstActivator: true });
        expect(conditionsMet([{ subject: 'first-activator', derivable: true }], ctx)).toBe(true);
    });
    it('is NOT met when firstActivator is false/absent', () => {
        const ctx = makeConditionContext({ firstActivator: false });
        expect(conditionsMet([{ subject: 'first-activator', derivable: true }], ctx)).toBe(false);
    });
});
