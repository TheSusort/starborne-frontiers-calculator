import { describe, expect, it } from 'vitest';
import { parseSkillEffects } from '../skillTextParser';

// R190: a Cheat Death whose own clause states "for N turns" keeps that window, on the conjoined
// self-grant path as on the tagged one.
describe('conjoined Cheat Death grant', () => {
    it('keeps the stated duration', () => {
        const effects = parseSkillEffects(
            'This Unit gains 1 charge and Cheat Death for 6 turns.',
            'passive1'
        );
        expect(effects.find((e) => e.buffName === 'Cheat Death')?.duration).toBe(6);
    });
});
