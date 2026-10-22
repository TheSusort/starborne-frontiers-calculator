import { describe, it, expect } from 'vitest';
import { findBuffDescription, resolveTaggedEffect } from '../skillTextParser';
import { csvAvailable, loadShipSkillRecords } from '../../../scripts/lib/shipSkillCsv';

describe('resolveTaggedEffect', () => {
    it.each([
        ['cleanses 1 debuff', 'Cleanse'],
        ['cleanses all debuffs', 'Cleanse'],
        ['purges 2 buffs', 'Purge'],
        ['purged', 'Purge'],
        ['purge all buffs', 'Purge'],
        ['steals up to 2', 'Steal Buff'],
        ['adds 1 charge', 'Charge Manipulation'],
        ['removes all charges', 'Charge Manipulation'],
        ['fully charged', 'Charge Manipulation'],
        ['charge loss', 'Charge Manipulation'],
        ['gains 1 extra end of round action', 'Extra Action'],
        ['gains one extra action', 'Extra Action'],
        ['detonates', 'Detonation'],
        ['damage over time debuffs', 'Damage Over Time effect'],
        ['reflects', 'Reflect'],
        ['buffs are extended by 1 turn', 'Buff Duration Extension'],
        ['debuffs extended by 1 turn', 'Debuff Duration Extension'],
        ['extends the duration the newly inflicted', 'Debuff Duration Extension'],
        ['reduces the duration of all active', 'Debuff Duration Expiration'],
    ])('"%s" -> %s', (phrase, effect) => {
        expect(resolveTaggedEffect(phrase)?.title).toBe(effect);
    });

    it('resolves a named effect by name before any action phrase', () => {
        // "Charged" would also match the Charge Manipulation phrase.
        const named = resolveTaggedEffect('Charged Overdrive II');
        expect(named?.title).toBe('Charged Overdrive II');
        expect(named?.description).toMatch(/Defense Penetration/);
    });

    it('resolves a catalogue spelling to the description of the engine name', () => {
        const engine = findBuffDescription('Tianchao Precision II');
        expect(engine).toBeDefined();
        expect(findBuffDescription('Tianchen Precision II')).toBe(engine);
        expect(findBuffDescription('Reverse Repairs')).toBe(
            findBuffDescription('Reversed Repairs')
        );
    });

    it('returns undefined for unknown text', () => {
        expect(resolveTaggedEffect('Not A Status')).toBeUndefined();
    });
});

describe('effect descriptions across the real skill text', () => {
    it('every <unit-skill> tag in docs/ship-skills.csv has a description', () => {
        if (!csvAvailable()) {
            throw new Error(
                'docs/ship-skills.csv is missing from this worktree (gitignored reference data).'
            );
        }
        const missing = new Set<string>();
        for (const rec of loadShipSkillRecords()) {
            for (const text of [rec.active, rec.charge, ...rec.passives]) {
                for (const m of text.matchAll(/<unit-skill>(.*?)<\/unit-skill>/g)) {
                    if (findBuffDescription(m[1]) === undefined) missing.add(m[1]);
                }
            }
        }
        expect([...missing]).toEqual([]);
    });
});
