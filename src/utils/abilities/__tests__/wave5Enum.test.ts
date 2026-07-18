import { describe, it, expect } from 'vitest';
import { skillNeedsOpposingVictim } from '../applyAbilities';
import type { Skill } from '../../../types/abilities';

const mk = (target: string): Skill =>
    ({
        abilities: [{ type: 'debuff', target, config: { type: 'debuff', buffName: 'X' } }],
    }) as unknown as Skill;

describe('wave5 adjacent-enemies enum', () => {
    it('adjacent-enemies counts as opposing-victim-facing', () => {
        expect(skillNeedsOpposingVictim(mk('adjacent-enemies'))).toBe(true);
    });
    it('target-and-adjacent-enemies counts as opposing-victim-facing', () => {
        expect(skillNeedsOpposingVictim(mk('target-and-adjacent-enemies'))).toBe(true);
    });
});
