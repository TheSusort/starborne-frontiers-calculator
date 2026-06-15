import { describe, it, expect } from 'vitest';
import { parseEffectScope } from '../effectScope';

describe('parseEffectScope', () => {
    it('detects "all enemies" (Amartya-style debuff-all)', () => {
        expect(
            parseEffectScope(
                'This Unit deals 150% damage, then inflicts Defense Down on all enemies.'
            )
        ).toBe('all enemies');
    });

    it('detects adjacent enemies (Asphyxiator-style)', () => {
        expect(
            parseEffectScope(
                'deals 175% damage, then inflicts Inferno III on the targeted enemy and all adjacent enemies.'
            )
        ).toBe('adjacent enemies');
    });

    it('detects adjacency with the adjective after the noun (Asphyxiator wording)', () => {
        expect(
            parseEffectScope(
                'inflicts Inferno III on the targeted enemy and all enemies adjacent to it.'
            )
        ).toBe('adjacent enemies');
    });

    it('tolerates the "adjavent" typo in the source data', () => {
        expect(parseEffectScope('inflicts X on all adjavent enemies')).toBe('adjacent enemies');
    });

    it('detects all allies and all other allies', () => {
        expect(parseEffectScope('grants Attack Up to all allies')).toBe('all allies');
        expect(parseEffectScope('heals all other allies')).toBe('all allies');
    });

    it('detects adjacent allies', () => {
        expect(parseEffectScope('shields all adjacent allies')).toBe('adjacent allies');
    });

    it('keeps the qualifier for conditional subsets', () => {
        expect(parseEffectScope('repairs all damaged enemies')).toBe('all damaged enemies');
        expect(parseEffectScope('detonates on all cleansed enemies')).toBe('all cleansed enemies');
    });

    it('strips HTML tags before matching', () => {
        expect(
            parseEffectScope('inflicts <unit-skill>Inferno</unit-skill> on all adjacent enemies')
        ).toBe('adjacent enemies');
    });

    it('returns null when no broader scope is mentioned', () => {
        expect(parseEffectScope('This Unit deals 160% damage.')).toBeNull();
        expect(parseEffectScope('inflicts Stun on the targeted enemy.')).toBeNull();
    });
});
