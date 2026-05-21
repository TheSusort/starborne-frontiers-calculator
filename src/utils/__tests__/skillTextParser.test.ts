import { describe, it, expect } from 'vitest';
import {
    parseSkillDamage,
    parseSkillHeal,
    detectFullyCharged,
    parseSkillEffects,
    parseAllSkillEffects,
} from '../skillTextParser';
import type { Ship } from '../../types/ship';

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

describe('parseSkillEffects', () => {
    it('returns [] for null input', () => {
        expect(parseSkillEffects(null, 'active')).toEqual([]);
    });

    it('returns [] for empty string', () => {
        expect(parseSkillEffects('', 'active')).toEqual([]);
    });

    it('returns [] when no unit-skill tags present', () => {
        expect(
            parseSkillEffects('This Unit deals <unit-damage>180% damage</unit-damage>', 'active')
        ).toEqual([]);
    });

    it('parses inflicts → enemy with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            { buffName: 'Defense Down II', target: 'enemy', duration: 2, source: 'active' },
        ]);
    });

    it('parses gains → self with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
                'passive1'
            )
        ).toEqual([{ buffName: 'Attack Up III', target: 'self', duration: 1, source: 'passive1' }]);
    });

    it('parses grants → self with duration', () => {
        expect(
            parseSkillEffects(
                'This Unit grants <unit-skill>Hacking Up III</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([{ buffName: 'Hacking Up III', target: 'self', duration: 2, source: 'active' }]);
    });

    it('assigns source field from argument', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Defense Up II</unit-skill> for 1 turn',
            'passive2'
        );
        expect(result[0].source).toBe('passive2');
    });

    it('handles individual durations: inflicts X for 1 turn and Y for 2 turns', () => {
        expect(
            parseSkillEffects(
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 1 turn and <unit-skill>Speed Down II</unit-skill> for 2 turns',
                'active'
            )
        ).toEqual([
            { buffName: 'Defense Down II', target: 'enemy', duration: 1, source: 'active' },
            { buffName: 'Speed Down II', target: 'enemy', duration: 2, source: 'active' },
        ]);
    });

    it('handles shared duration: inflicts X and Y for 2 turns — both get 2', () => {
        const result = parseSkillEffects(
            'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Speed Down II</unit-skill> for 2 turns',
            'active'
        );
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            buffName: 'Defense Down II',
            target: 'enemy',
            duration: 2,
        });
        expect(result[1]).toMatchObject({
            buffName: 'Speed Down II',
            target: 'enemy',
            duration: 2,
        });
    });

    it('handles shared duration across three tags: inflicts X, Y, and Z for 2 turns', () => {
        const result = parseSkillEffects(
            'This Unit inflicts <unit-skill>Defense Down II</unit-skill>, <unit-skill>Speed Down II</unit-skill>, and <unit-skill>Attack Down II</unit-skill> for 2 turns',
            'active'
        );
        expect(result).toHaveLength(3);
        result.forEach((e) => expect(e.duration).toBe(2));
    });

    it('does not bleed shared duration across sentence boundaries', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Defense Up II</unit-skill>. This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            'passive1'
        );
        expect(result.find((e) => e.buffName === 'Defense Up II')?.duration).toBeNull();
        expect(result.find((e) => e.buffName === 'Attack Up III')?.duration).toBe(1);
    });

    it('skips tags preceded by ignoring', () => {
        expect(
            parseSkillEffects(
                "This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill>",
                'active'
            )
        ).toEqual([]);
    });

    it('skips tags preceded by loses', () => {
        expect(
            parseSkillEffects(
                'Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>',
                'passive1'
            )
        ).toEqual([]);
    });

    it('parses stack-based recurring effect', () => {
        const result = parseSkillEffects(
            'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn',
            'passive1'
        );
        expect(result).toEqual([
            {
                buffName: 'Blast',
                target: 'self',
                duration: 'recurring',
                stacks: 1,
                source: 'passive1',
            },
        ]);
    });

    it('parses "every turn" as recurring without stacks', () => {
        const result = parseSkillEffects(
            'This Unit gains <unit-skill>Attack Up II</unit-skill> every turn',
            'active'
        );
        expect(result[0]).toMatchObject({ duration: 'recurring' });
        expect(result[0].stacks).toBeUndefined();
    });

    it('does not override finite duration with recurring when stacks present', () => {
        const result = parseSkillEffects(
            'This Unit gains 3 stacks of <unit-skill>Blast</unit-skill> for 2 turns',
            'active'
        );
        expect(result[0]).toMatchObject({ stacks: 3, duration: 2 });
    });

    it('stops scanning backward at sentence boundary (.)', () => {
        const result = parseSkillEffects(
            'This Unit loses <unit-skill>Overload</unit-skill>. This Unit gains <unit-skill>Attack Up III</unit-skill> for 3 turns',
            'passive1'
        );
        expect(result).toEqual([
            { buffName: 'Attack Up III', target: 'self', duration: 3, source: 'passive1' },
        ]);
    });

    it('returns [] when no relevant verb is found before the tag', () => {
        expect(
            parseSkillEffects(
                'This Unit has <unit-skill>Defense Up II</unit-skill> at all times',
                'passive1'
            )
        ).toEqual([]);
    });

    it('skips tags preceded by when', () => {
        expect(
            parseSkillEffects('When this Unit has <unit-skill>Blast</unit-skill>', 'passive1')
        ).toEqual([]);
    });
});

describe('parseAllSkillEffects', () => {
    it('returns [] for a ship with no skill text', () => {
        const ship = { activeSkillText: undefined, chargeSkillText: undefined } as unknown as Ship;
        expect(parseAllSkillEffects(ship)).toEqual([]);
    });

    it('combines effects from all five skill fields with correct source labels', () => {
        const ship = {
            activeSkillText:
                'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
            chargeSkillText: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
            firstPassiveSkillText: undefined,
            secondPassiveSkillText: undefined,
            thirdPassiveSkillText: undefined,
        } as unknown as Ship;
        const result = parseAllSkillEffects(ship);
        expect(result).toHaveLength(2);
        expect(result.find((e) => e.source === 'active')?.buffName).toBe('Defense Down II');
        expect(result.find((e) => e.source === 'charge')?.buffName).toBe('Attack Up III');
    });
});
