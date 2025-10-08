import { describe, it, expect } from 'vitest';
import { parseSkillText, extractSkillNames } from '../skillTextParser';

describe('skillTextParser', () => {
    describe('parseSkillText', () => {
        it('should parse skill text with unit-skill tags', () => {
            const input =
                'This Unit deals <unit-damage>140% damage</unit-damage> and inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns.';
            const result = parseSkillText(input);

            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({ text: 'This Unit deals ', type: 'text' });
            expect(result[1]).toEqual({ text: '140% damage', type: 'unit-damage' });
            expect(result[2]).toEqual({ text: ' and inflicts ', type: 'text' });
            expect(result[3].text).toBe('Corrosion I');
            expect(result[3].type).toBe('unit-skill');
            expect(result[3].buffDescription).toBeDefined();
            expect(result[4]).toEqual({ text: ' for 2 turns.', type: 'text' });
        });

        it('should parse skill text with unit-aid tags', () => {
            const input =
                'This Unit <unit-aid>cleanses 1</unit-aid> debuff and deals <unit-damage>180% damage</unit-damage>.';
            const result = parseSkillText(input);

            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({ text: 'This Unit ', type: 'text' });
            expect(result[1]).toEqual({ text: 'cleanses 1', type: 'unit-aid' });
            expect(result[2]).toEqual({ text: ' debuff and deals ', type: 'text' });
            expect(result[3]).toEqual({ text: '180% damage', type: 'unit-damage' });
            expect(result[4]).toEqual({ text: '.', type: 'text' });
        });

        it('should handle multiple unit-skill tags', () => {
            const input =
                'Inflicts <unit-skill>Corrosion II</unit-skill> and <unit-skill>Stasis</unit-skill>.';
            const result = parseSkillText(input);

            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({ text: 'Inflicts ', type: 'text' });
            expect(result[1].type).toBe('unit-skill');
            expect(result[1].text).toBe('Corrosion II');
            expect(result[2]).toEqual({ text: ' and ', type: 'text' });
            expect(result[3].type).toBe('unit-skill');
            expect(result[3].text).toBe('Stasis');
            expect(result[4]).toEqual({ text: '.', type: 'text' });
        });

        it('should handle text without any tags', () => {
            const input = 'This is plain text with no tags.';
            const result = parseSkillText(input);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ text: 'This is plain text with no tags.', type: 'text' });
        });

        it('should handle empty or null input', () => {
            expect(parseSkillText('')).toEqual([]);
            expect(parseSkillText(null)).toEqual([]);
            expect(parseSkillText(undefined)).toEqual([]);
        });

        it('should find buff descriptions for known buffs', () => {
            const input = 'Inflicts <unit-skill>Corrosion I</unit-skill>.';
            const result = parseSkillText(input);

            expect(result[1].buffDescription).toBe("Deals Damage equal to 3% of target's max HP");
        });

        it('should handle HTML line breaks in skill text', () => {
            const input =
                'Deals damage.<br />If the enemy has 3 or more stacks, inflict <unit-skill>Stasis</unit-skill>.';
            const result = parseSkillText(input);

            // Should parse the br tag as plain text
            expect(result.some((s) => s.text.includes('<br />'))).toBe(true);
        });
    });

    describe('extractSkillNames', () => {
        it('should extract all skill names from text', () => {
            const input =
                'Inflicts <unit-skill>Corrosion I</unit-skill> and <unit-skill>Stasis</unit-skill>.';
            const result = extractSkillNames(input);

            expect(result).toEqual(['Corrosion I', 'Stasis']);
        });

        it('should remove duplicate skill names', () => {
            const input =
                '<unit-skill>Corrosion I</unit-skill> and <unit-skill>Corrosion I</unit-skill>.';
            const result = extractSkillNames(input);

            expect(result).toEqual(['Corrosion I']);
        });

        it('should handle text without skill tags', () => {
            const input = 'This deals <unit-damage>100% damage</unit-damage>.';
            const result = extractSkillNames(input);

            expect(result).toEqual([]);
        });

        it('should handle empty or null input', () => {
            expect(extractSkillNames('')).toEqual([]);
            expect(extractSkillNames(null)).toEqual([]);
            expect(extractSkillNames(undefined)).toEqual([]);
        });
    });
});
