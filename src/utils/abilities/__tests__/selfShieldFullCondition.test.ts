import { describe, it, expect } from 'vitest';
import { conditionsMet } from '../evaluateConditions';
import type { Condition } from '../../../types/abilities';

const GATE: Condition[] = [{ subject: 'self-shield-full', derivable: true }];

describe('self-shield-full condition', () => {
    it('is met when the owner shield is at or above max HP', () => {
        expect(conditionsMet(GATE, { selfShieldFull: true } as never)).toBe(true);
    });

    it('is NOT met when the shield is merely non-zero', () => {
        // The distinguishing case vs the existing `self-shield` subject: a partial shield
        // satisfies self-shield but must NOT satisfy self-shield-full.
        expect(conditionsMet(GATE, { selfShielded: true, selfShieldFull: false } as never)).toBe(
            false
        );
    });

    it('is NOT met when the field is absent (DPS mode / no shield modelling)', () => {
        expect(conditionsMet(GATE, {} as never)).toBe(false);
    });
});
