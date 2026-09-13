import { describe, it, expect } from 'vitest';
import { getStatName, statFromGameTriple } from '../gameStatVocabulary';

describe('getStatName', () => {
    it.each([
        ['HullPoints', 'hp'],
        ['Power', 'attack'],
        ['Defense', 'defence'],
        ['Manipulation', 'hacking'],
        ['Security', 'security'],
        ['CritChance', 'crit'],
        ['CritBoost', 'critDamage'],
        ['Initiative', 'speed'],
        ['ShieldPoints', 'shield'],
        ['DefensePenetration', 'defensePenetration'],
        ['ShieldPenetration', 'shieldPenetration'],
    ])('maps %s to %s', (attribute, expected) => {
        expect(getStatName(attribute)).toBe(expected);
    });

    it('returns null for an attribute this app does not model', () => {
        expect(getStatName('CritResistance')).toBeNull();
    });
});

describe('statFromGameTriple', () => {
    // A flexible stat follows the declared type: a percentage arrives as a fraction and is
    // stored as an integer, a flat value is stored as-is.
    it('scales a Percentage flexible stat to an integer percentage', () => {
        expect(statFromGameTriple('HullPoints', 'Percentage', 0.15)).toEqual({
            name: 'hp',
            value: 15,
            type: 'percentage',
        });
    });

    it('leaves a Flat flexible stat alone', () => {
        expect(statFromGameTriple('Initiative', 'Flat', 10)).toEqual({
            name: 'speed',
            value: 10,
            type: 'flat',
        });
    });

    // The asymmetry worth pinning: the game sends crit, crit damage and the penetrations as
    // FRACTIONS typed "Flat". They are percentage-only stats, so the x100 keys on the STAT,
    // not on the declared type — reading the type alone stores 0.05 where 5 belongs.
    it.each([
        ['CritBoost', 0.05, 'critDamage', 5],
        ['CritChance', 0.2, 'crit', 20],
        ['ShieldPenetration', 0.2, 'shieldPenetration', 20],
        ['DefensePenetration', 0.2, 'defensePenetration', 20],
    ])('scales %s despite its Flat type', (attribute, value, name, expected) => {
        expect(statFromGameTriple(attribute, 'Flat', value)).toEqual({
            name,
            value: expected,
            type: 'percentage',
        });
    });

    it('returns null for an attribute this app does not model', () => {
        expect(statFromGameTriple('CritResistance', 'Flat', 0.1)).toBeNull();
    });
});
