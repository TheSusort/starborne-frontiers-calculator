import { describe, it, expect } from 'vitest';
import { parseSkillDamage, parseSkillHeal, detectFullyCharged } from '../skillTextParser';

describe('parseSkillDamage', () => {
    it('returns 0 for empty string', () => {
        expect(parseSkillDamage('')).toBe(0);
    });

    it('extracts a single damage value', () => {
        expect(parseSkillDamage('Deals <unit-damage>180% damage</unit-damage> to target')).toBe(
            180
        );
    });

    it('returns the first damage value and ignores subsequent tags', () => {
        const text =
            'Deals <unit-damage>120% damage</unit-damage> then <unit-damage>60% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(120);
    });

    it('skips stat-based damage ("of its" follows closing tag)', () => {
        const text = 'Deals additional damage based on <unit-damage>30%</unit-damage> of its DEF';
        expect(parseSkillDamage(text)).toBe(0);
    });

    it('skips stat-based damage ("of this" follows closing tag)', () => {
        const text =
            "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP";
        expect(parseSkillDamage(text)).toBe(200);
    });

    it('keeps a normal damage tag that happens to follow a long sentence without "of its"', () => {
        const text = 'This unit attacks the enemy and deals <unit-damage>200% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(200);
    });

    it('returns integer percentage, not a float', () => {
        const result = parseSkillDamage('<unit-damage>180% damage</unit-damage>');
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBe(180);
    });

    it('handles a mix of stat-based and normal damage in the same text', () => {
        const text =
            'Deals <unit-damage>100% damage</unit-damage> plus extra based on <unit-damage>50%</unit-damage> of its HP';
        expect(parseSkillDamage(text)).toBe(100);
    });
});

describe('parseSkillHeal', () => {
    it('returns 0 for empty string', () => {
        expect(parseSkillHeal('')).toBe(0);
    });

    it('extracts heal percentage from repairs tag', () => {
        expect(
            parseSkillHeal('This Unit <unit-damage>repairs 15%</unit-damage> of target HP')
        ).toBe(15);
    });

    it('handles decimal heal percentages', () => {
        expect(parseSkillHeal('<unit-damage>repairs 12.5%</unit-damage>')).toBe(12.5);
    });

    it('is case-insensitive', () => {
        expect(parseSkillHeal('<unit-damage>Repairs 20%</unit-damage>')).toBe(20);
    });

    it('returns 0 when tag content is not a repair', () => {
        expect(parseSkillHeal('<unit-damage>180% damage</unit-damage>')).toBe(0);
    });

    it('returns 0 for flat heal text without percent', () => {
        expect(parseSkillHeal('<unit-damage>repairs 1500 HP</unit-damage>')).toBe(0);
    });

    it('ignores damage tags and finds the repairs tag', () => {
        const text =
            'Deals <unit-damage>100% damage</unit-damage> and <unit-damage>repairs 15%</unit-damage>';
        expect(parseSkillHeal(text)).toBe(15);
    });
});

describe('detectFullyCharged', () => {
    it('returns false for empty array', () => {
        expect(detectFullyCharged([])).toBe(false);
    });

    it('returns false when no skill text contains "fully charged"', () => {
        expect(detectFullyCharged(['Deals 180% damage', 'Passive bonus'])).toBe(false);
    });

    it('returns true for "starts combat fully charged"', () => {
        expect(detectFullyCharged(['This unit starts combat fully charged.'])).toBe(true);
    });

    it('returns true for "starts combat with a fully charged charged skill" variant', () => {
        expect(
            detectFullyCharged(['This unit starts combat with a fully charged charged skill.'])
        ).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(detectFullyCharged(['This unit starts combat FULLY CHARGED.'])).toBe(true);
    });

    it('handles undefined entries in the array without throwing', () => {
        expect(detectFullyCharged([undefined, 'starts combat fully charged', undefined])).toBe(
            true
        );
    });

    it('returns true when match is in a passive skill (3rd entry)', () => {
        expect(
            detectFullyCharged([
                undefined,
                undefined,
                'This unit starts combat fully charged.',
                undefined,
                undefined,
            ])
        ).toBe(true);
    });

    it('returns false when all entries are undefined', () => {
        expect(detectFullyCharged([undefined, undefined])).toBe(false);
    });
});
