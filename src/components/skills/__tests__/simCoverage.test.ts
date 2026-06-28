import { describe, it, expect } from 'vitest';
import { isAbilityNotSimulated, SIMULATED_CONTROL_EFFECTS } from '../simCoverage';
import { Ability } from '../../../types/abilities';

describe('isAbilityNotSimulated', () => {
    it('treats modeled control effects as simulated', () => {
        for (const effect of [
            'stasis',
            'provoke',
            'taunt',
            'concentrate-fire',
            'disable',
        ] as const) {
            expect(
                isAbilityNotSimulated({
                    type: 'control',
                    config: { type: 'control', effect },
                } as Ability)
            ).toBe(false);
        }
    });

    it('still flags an unmodeled control effect (overload)', () => {
        expect(
            isAbilityNotSimulated({
                type: 'control',
                config: { type: 'control', effect: 'overload' },
            } as Ability)
        ).toBe(true);
    });

    it('leaves non-control types simulated as before', () => {
        expect(isAbilityNotSimulated({ type: 'damage' } as Ability)).toBe(false);
    });
});

describe('SIMULATED_CONTROL_EFFECTS', () => {
    it('contains all five modeled effects', () => {
        expect(SIMULATED_CONTROL_EFFECTS.has('stasis')).toBe(true);
        expect(SIMULATED_CONTROL_EFFECTS.has('provoke')).toBe(true);
        expect(SIMULATED_CONTROL_EFFECTS.has('taunt')).toBe(true);
        expect(SIMULATED_CONTROL_EFFECTS.has('concentrate-fire')).toBe(true);
        expect(SIMULATED_CONTROL_EFFECTS.has('disable')).toBe(true);
    });

    it('does not contain overload', () => {
        expect(SIMULATED_CONTROL_EFFECTS.has('overload')).toBe(false);
    });
});
