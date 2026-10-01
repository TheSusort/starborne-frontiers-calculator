import { describe, it, expect } from 'vitest';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

const PAIRS: RewordPair[] = [
    {
        ship: 'APEX',
        slot: 'passive',
        old: 'This Unit gains a <unit-damage>Shield equal to 3%</unit-damage> of their Max HP when an enemy gets debuffed.',
        new: 'This Unit gains a <unit-damage>shield equal to 3%</unit-damage> of their max HP when an enemy gets inflicted with a <unit-aid>debuff</unit-aid>.',
        expects: 'shield|self|on-debuff-inflicted|shield',
    },
    {
        ship: 'APEX',
        slot: 'passive',
        old: 'This Unit gains a <unit-damage>Shield equal to 3%</unit-damage> of their Max HP when an enemy gets debuffed.<br /><br />If that enemy has 3 or more debuffs, Inflict <unit-skill>Block Shield</unit-skill> for 1 turn.',
        new: 'This Unit gains a <unit-damage>shield equal to 3%</unit-damage> of their max HP when an enemy gets inflicted with a <unit-aid>debuff</unit-aid>.<br /><br />If that enemy has 3 or more <unit-aid>debuffs</unit-aid> on a <unit-aid>debuff</unit-aid> infliction, this Unit inflicts <unit-skill>Block Shield</unit-skill> for 1 turn.',
        expects: 'shield|self|on-debuff-inflicted|shield',
    },
    {
        ship: 'Defiant',
        slot: 'passive',
        old: 'This Unit gains <unit-damage>Shield equal to 30%</unit-damage> of its Max HP when applying Stasis.',
        new: 'This Unit gains a <unit-damage>shield equal to 30%</unit-damage> of its max HP after it inflicts <unit-skill>Stasis</unit-skill>.',
        expects: 'shield|self|on-stasis-applied|shield',
    },
    {
        ship: 'Wisteria',
        slot: 'passive',
        old: 'This Unit, after applying <unit-skill>Corrosion</unit-skill> with a Critical hit, inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
        new: 'When this Unit inflicts <unit-skill>Corrosion</unit-skill> with a critical hit, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
        expects: 'dot|enemy|on-self-crit-dot|dot',
    },
    {
        ship: 'Wisteria',
        slot: 'passive',
        old: 'This Unit inflicts <unit-skill>Inferno II</unit-skill> for 2 turns after applying <unit-skill>Corrosion</unit-skill> with a Critical hit and extends the newly applied <unit-skill>Corrosion</unit-skill> by 1 turn with a chance to hit equal to Crit Power.',
        new: "When this Unit inflicts <unit-skill>Corrosion</unit-skill> with a critical hit, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns and <unit-skill>extends the newly inflicted</unit-skill> <unit-skill>Corrosion</unit-skill> by 1 turn with the extension chance equal to this Unit's crit power.",
        expects: 'dot|enemy|on-self-crit-dot|dot',
    },
    {
        ship: 'Asphyxiator',
        slot: 'passive',
        old: 'At the start of the round, if there are any enemies with 3 or more debuffs, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>. After this Unit applies a Debuff with a Critical hit the newly applied Debuff is extended by 1 turn.',
        new: 'At the start of the round, if there are any enemies with 3 or more <unit-aid>debuffs</unit-aid>, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>. <br /><br />After this Unit inflicts a <unit-aid>debuff</unit-aid> with a critical hit, the newly inflicted <unit-aid>debuff</unit-aid> is <unit-skill>extended by 1 turn</unit-skill>.',
        expects: 'extend-status|all-enemies|on-cast|extend-status',
    },
    {
        ship: 'Belladonna',
        slot: 'passive',
        old: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.',
        new: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit converts the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.',
        expects: 'convert-dot|enemy|on-ally-debuff-inflicted|Acidic Decay',
    },
    {
        ship: 'Belladonna',
        slot: 'passive',
        old: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit has a chance to convert the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit extends the newly applied <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance to equal to its crit power.',
        new: 'When an ally inflicts <unit-skill>Corrosion</unit-skill>, this Unit converts the <unit-skill>Corrosion</unit-skill> into <unit-skill>Acidic Decay</unit-skill> of the same level, with the chance scaling at 1% per 10 Hacking.<br /><br />Upon converting <unit-skill>Corrosion</unit-skill>, this Unit <unit-skill>extends the newly inflicted</unit-skill> <unit-skill>Acidic Decay</unit-skill> status for 1 turn, with the chance equal to its crit power.',
        expects: 'convert-dot|enemy|on-ally-debuff-inflicted|Acidic Decay',
    },
    {
        ship: 'Pestilence',
        slot: 'passive',
        old: 'On debuff infliction this Unit reduces the duration of active Debuffs on all allies by 1 turn.',
        new: 'When this Unit inflicts a <unit-aid>debuff</unit-aid>, it <unit-skill>reduces the duration of all active</unit-skill> <unit-aid>debuffs</unit-aid> on all allies by 1 turn.',
        expects: 'cleanse|all-allies|on-debuff-inflicted|cleanse',
    },
    {
        ship: 'Pestilence',
        slot: 'passive',
        old: 'On debuff infliction this Unit reduces the duration of active <unit-aid>Debuffs</unit-aid> on all allies by 1 turn.<br />When an enemy <unit-aid>cleanses a Debuff</unit-aid> this unit inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns on all cleansed enemies.',
        new: 'When this Unit inflicts a <unit-aid>debuff</unit-aid>, it <unit-skill>reduces the duration of all active</unit-skill> <unit-aid>debuffs</unit-aid> on all allies by 1 turn.<br /><br />When an enemy <unit-skill>cleanses a debuff</unit-skill>, this Unit inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns',
        expects: 'cleanse|all-allies|on-debuff-inflicted|cleanse',
    },
    {
        ship: 'Hayyan',
        slot: 'passive',
        old: "When <unit-aid>cleansing a</unit-aid> Debuff from an Ally, this Unit <unit-damage>repairs the ally for 4%</unit-damage> of this Unit's Max HP.<br /><br />When a debuff is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's Max HP.",
        new: "When this Unit <unit-skill>cleanses a debuff</unit-skill> from an ally, it also <unit-damage>repairs the ally 4%</unit-damage> of this Unit's max HP. <br /><br />When a <unit-aid>debuff</unit-aid> is inflicted on an ally, this Unit <unit-damage>repairs the ally for 6%</unit-damage> of this Unit's max HP.",
        expects: 'heal|ally|on-ally-debuffed|heal',
    },
];

describe('inflict/apply vocabulary — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });
});

// Ravager R2's catalogue row also rewords its defense-penetration clause ("This Unit has 10%
// defense penetration" mints a modifier the old "ignores 10% of Defense" does not), so the slot
// cannot pair. Its resist reaction is pinned directly.
describe('inflict/apply vocabulary — resist reaction', () => {
    it('Ravager passive R2: "If this Unit\'s debuff is resisted" grants Hacking Module Overdrive on that resist', () => {
        const text =
            "This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.<br /><br />If this Unit's debuff is resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn. This Unit has <unit-damage>10% defense penetration</unit-damage>.";
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('buff|self|on-own-debuff-resisted|Hacking Module Overdrive');
        expect(s).not.toContain('buff|self|on-cast|Hacking Module Overdrive');
    });
});
