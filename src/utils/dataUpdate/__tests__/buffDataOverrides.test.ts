/**
 * The hand-corrected buff tiers match the official unit catalogue, and `fetch-buffs` re-applies
 * exactly what `buffs.ts` holds — so a regen cannot revert a correction.
 */
import { describe, it, expect } from 'vitest';
import { BUFFS } from '../../../constants/buffs';
import { parseBuffEffects } from '../../calculators/buffParser';
import { MANUAL_DESCRIPTION_OVERRIDES, MANUAL_TYPE_OVERRIDES } from '../buffDataOverrides';

const entry = (name: string) => {
    const found = BUFFS.find((b) => b.name === name);
    if (!found) throw new Error(`${name} missing from BUFFS`);
    return found;
};
const effectsOf = (name: string) => parseBuffEffects(name, entry(name).description);

describe('catalogue tier magnitudes', () => {
    it('Binderburg Resilience I/II carry the Defense half (+5% / +10%)', () => {
        expect(effectsOf('Binderburg Resilience I')).toEqual({ security: 10, defense: 5 });
        expect(effectsOf('Binderburg Resilience II')).toEqual({ security: 20, defense: 10 });
        expect(effectsOf('Binderburg Resilience III')).toEqual({ security: 30, defense: 15 });
    });

    it('Speed Up I is +15%', () => {
        expect(effectsOf('Speed Up I')).toEqual({ speed: 15 });
    });

    it('Everliving Regeneration I/II carry +10 / +15 Security', () => {
        expect(effectsOf('Everliving Regeneration I')).toEqual({ incomingHeal: 10, security: 10 });
        expect(effectsOf('Everliving Regeneration II')).toEqual({
            incomingHeal: 20,
            security: 15,
        });
        expect(effectsOf('Everliving Regeneration III')).toEqual({
            incomingHeal: 30,
            security: 20,
        });
    });

    it('Out. Detonation Damage Up III is +30%', () => {
        expect(effectsOf('Out. Detonation Damage Up III')).toEqual({ detonationDamage: 30 });
    });

    it('Inc. DoT Damage Up I/II/III are debuffs', () => {
        for (const tier of ['I', 'II', 'III'])
            expect(entry(`Inc. DoT Damage Up ${tier}`).type).toBe('debuff');
    });
});

describe('fetch-buffs overrides re-apply what buffs.ts holds', () => {
    it.each(Object.entries(MANUAL_DESCRIPTION_OVERRIDES))('%s description', (name, desc) => {
        expect(entry(name).description).toBe(desc);
    });

    it.each(Object.entries(MANUAL_TYPE_OVERRIDES))('%s type', (name, type) => {
        expect(entry(name).type).toBe(type);
    });
});
