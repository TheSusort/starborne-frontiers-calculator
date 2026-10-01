import { describe, it, expect } from 'vitest';
import {
    canonicalStatusName,
    canonicaliseStatusNames,
    findBuffDescription,
    parseSkillEffects,
} from '../../skillTextParser';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

// Pestilence charged is a number row ruled C (R15, user 2026-10-01): the catalogue's
// Binderburg Resilience II + Corrosion III are hand-substituted into `old` in place of our
// Binderburg Resilience III + Corrosion II, so the pair tests the wording only.
const PAIRS: RewordPair[] = [
    {
        ship: 'Anjian',
        slot: 'passive',
        old: 'When damaging a Debuffer or Supporter, this Unit gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchao Precision I</unit-skill> for 2 turns.',
        new: "This Unit's attack ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When damaging a debuffer or supporter, this Unit gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchen Precision I</unit-skill> for 2 turns.",
        expects: 'buff|self|on-cast|Tianchao Precision I',
    },
    {
        ship: 'Anjian',
        slot: 'passive',
        old: 'When damaging a Debuffer or Supporter, this Unit gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchao Precision II</unit-skill> for 3 turns.',
        new: "This Unit's attack ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When damaging a debuffer or supporter, this Unit gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchen Precision II</unit-skill> for 3 turns.",
        expects: 'buff|self|on-cast|Tianchao Precision II',
    },
    {
        ship: 'Sha Xing',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns when damaging a Debuffer or Supporter. Additionally, when Damaging a Debuffed enemy, it gains <unit-skill>Tianchao Precision II</unit-skill> for 3 turns.',
        new: 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns when damaging a debuffer or supporter.<br /><br />When damaging a debuffed enemy, this Unit gains <unit-skill>Tianchen Precision II</unit-skill> for 3 turns.',
        expects: 'buff|self|on-cast|Tianchao Precision II',
    },
    {
        ship: 'Yuyan',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns and <unit-skill>Tianchao Precision II</unit-skill> for 3 turns when applying a debuff.',
        new: "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns and <unit-skill>Tianchen Precision II</unit-skill> for 3 turns when applying a <unit-aid>debuff</unit-aid>.",
        expects: 'buff|self|on-debuff-inflicted|Tianchao Precision II',
    },
    {
        ship: 'Zosimos',
        slot: 'charged',
        old: 'This Unit inflicts <unit-skill>Reversed Repairs</unit-skill> for 1 turn and deals <unit-damage>300% damage</unit-damage>.',
        new: 'This Unit inflicts <unit-skill>Reverse Repairs</unit-skill> for 1 turn and deals <unit-damage>300% damage</unit-damage>.',
        expects: 'debuff|enemy|on-cast|Reversed Repairs',
    },
    {
        ship: 'Hemlock',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>175% damage</unit-damage> and inflicts <unit-skill>Toxic Overflow</unit-skill>.',
        new: 'This Unit deals <unit-damage>175% damage</unit-damage> and inflicts <unit-skill>Toxic Overflow I</unit-skill>.',
        expects: 'debuff|enemy|on-cast|Toxic Overflow',
    },
    {
        ship: 'Pestilence',
        slot: 'charged',
        old: 'This Unit grants <unit-skill>Binderburg Resilience II</unit-skill> for 2 turns to all allies, deals <unit-damage>190% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns.',
        new: 'This Unit grants all allies <unit-skill>Binderburg Resilience II</unit-skill> for 2 turns, deals <unit-damage>190% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns.',
        expects: 'buff|all-allies|on-cast|Binderburg Resilience II',
    },
];

describe('status and buff names — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });

    it('Anjian: the catalogue spelling builds the buff under the canonical engine name', () => {
        const ANJIAN_NEW = PAIRS[0].new;
        expect(sigs(parseSlot('passive', ANJIAN_NEW))).toContain(
            'buff|self|on-cast|Tianchao Precision I'
        );
    });
});

// Huanying cannot pair against our text: "This Unit inflicts a debuff and gains …" parses as an
// unconditional cast, while the catalogue's "When this Unit inflicts a debuff it gains …" names
// the reaction. Both grants ride on-debuff-inflicted, the way Yuyan's "when applying a debuff"
// already does, and the Tianchen spelling builds under the canonical name.
describe('status and buff names — Huanying passive on the catalogue text', () => {
    it.each([
        [
            'I',
            "This Unit's attack ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When this Unit inflicts a <unit-aid>debuff</unit-aid> it gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchen Precision I</unit-skill> for 2 turns.",
        ],
        [
            'II',
            "This Unit's attack ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When this Unit inflicts a <unit-aid>debuff</unit-aid> it gains <unit-skill>Stealth</unit-skill> and <unit-skill>Tianchen Precision II</unit-skill> for 2 turns.",
        ],
    ])('Tianchen Precision %s', (tier, text) => {
        expect(sigs(parseSlot('passive', text))).toEqual([
            'buff|self|on-debuff-inflicted|Stealth',
            `buff|self|on-debuff-inflicted|Tianchao Precision ${tier}`,
        ]);
    });
});

describe('status name aliases', () => {
    it('resolves each catalogue spelling to the name the engine keys on', () => {
        expect(canonicalStatusName('Tianchen Precision I')).toBe('Tianchao Precision I');
        expect(canonicalStatusName('Tianchen Precision II')).toBe('Tianchao Precision II');
        expect(canonicalStatusName('Reverse Repairs')).toBe('Reversed Repairs');
        expect(canonicalStatusName('Toxic Overflow I')).toBe('Toxic Overflow');
        expect(canonicalStatusName('Reversed Repairs')).toBe('Reversed Repairs');
        expect(canonicalStatusName('Stealth')).toBe('Stealth');
    });

    it('rewrites a whole tagged status name only, never the faction word or untagged prose', () => {
        const fuying =
            'All Tianchen allies with <unit-skill>Stealth</unit-skill> take 10% less damage and gain <unit-skill>Tianchen Precision I</unit-skill>. Tianchen Precision I.';
        expect(canonicaliseStatusNames(fuying)).toBe(
            'All Tianchen allies with <unit-skill>Stealth</unit-skill> take 10% less damage and gain <unit-skill>Tianchao Precision I</unit-skill>. Tianchen Precision I.'
        );
    });

    it('feeds the canonical name to parseSkillEffects consumers', () => {
        const effects = parseSkillEffects(
            'This Unit inflicts <unit-skill>Reverse Repairs</unit-skill> for 1 turn and deals <unit-damage>300% damage</unit-damage>.',
            'charge'
        );
        expect(effects.map((e) => e.buffName)).toEqual(['Reversed Repairs']);
    });

    it('resolves the tooltip description of a catalogue spelling', () => {
        expect(findBuffDescription('Tianchen Precision II')).toBe(
            findBuffDescription('Tianchao Precision II')
        );
        expect(findBuffDescription('Toxic Overflow I')).toBeDefined();
    });
});
