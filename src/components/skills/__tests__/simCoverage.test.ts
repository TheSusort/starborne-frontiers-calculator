import { describe, it, expect } from 'vitest';
import {
    isAbilityNotSimulated,
    SIMULATED_CONTROL_EFFECTS,
    NOT_SIMULATED_TYPES,
} from '../simCoverage';
import { Ability, ControlEffect } from '../../../types/abilities';

const ALL_CONTROL_EFFECTS: readonly ControlEffect[] = [
    'stasis',
    'provoke',
    'taunt',
    'concentrate-fire',
    'disable',
];

describe('isAbilityNotSimulated', () => {
    it('treats every control effect as simulated (last unmodeled effect closed)', () => {
        for (const effect of ALL_CONTROL_EFFECTS) {
            expect(
                isAbilityNotSimulated({
                    type: 'control',
                    config: { type: 'control', effect },
                } as Ability)
            ).toBe(false);
        }
    });

    it('leaves non-control types simulated as before', () => {
        expect(isAbilityNotSimulated({ type: 'damage' } as Ability)).toBe(false);
    });

    it('has no not-simulated ability types left', () => {
        expect(NOT_SIMULATED_TYPES.size).toBe(0);
    });
});

describe('SIMULATED_CONTROL_EFFECTS', () => {
    it('contains every control effect', () => {
        for (const effect of ALL_CONTROL_EFFECTS) {
            expect(SIMULATED_CONTROL_EFFECTS.has(effect)).toBe(true);
        }
        expect(SIMULATED_CONTROL_EFFECTS.size).toBe(ALL_CONTROL_EFFECTS.length);
    });
});
