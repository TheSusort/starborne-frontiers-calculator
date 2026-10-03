import { describe, it, expect } from 'vitest';
import {
    parseSlot,
    sigs,
    canonical,
    type RewordPair,
    type SlotName,
} from './helpers/catalogueWording';

// Sentinel R2 is a number row whose numbers did not change: old and new carry the same 5% repair
// and 60% hit, only reordered.
const PAIRS: RewordPair[] = [
    {
        ship: 'Sentinel',
        slot: 'passive',
        old: 'When an ally critically hits an enemy, this Unit deals <unit-damage>40% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.',
        new: 'When another ally critically hits an enemy, this Unit deals <unit-damage>40% damage</unit-damage> to that enemy that cannot critically hit.',
        expects: 'damage|enemy|on-ally-crit|damage',
    },
    {
        ship: 'Sentinel',
        slot: 'passive',
        old: "When an ally critically hits an enemy, this Unit <unit-damage>repairs the ally for 5%</unit-damage> of this Unit's Max HP and deals <unit-damage>60% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.",
        new: 'When another ally critically hits an enemy, this Unit deals <unit-damage>60% damage</unit-damage> to that enemy that cannot critically hit and <unit-damage>repairs the ally for 5%</unit-damage> of this Units max HP.',
        expects: 'heal|ally|on-ally-crit|heal',
    },
    {
        ship: 'Lodolite',
        slot: 'passive',
        old: 'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders, all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill>.',
        new: 'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more critical damage</unit-damage> to defenders and all allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Concentrate Fire</unit-skill>.',
        expects: 'modifier|self|on-cast|modifier',
    },
    // "grants X to them" and "grants them X" both point back at the "all allies" named earlier.
    {
        ship: 'Chimei',
        slot: 'active',
        old: 'This Unit <unit-damage>repairs 9%</unit-damage> of its Max HP to all allies and grants <unit-skill>Out. Detonation Damage Up III</unit-skill> and <unit-skill>Attack Up III</unit-skill> to them for 1 turn.',
        new: 'This Unit <unit-damage>repairs 9%</unit-damage> of its max HP to all allies and grants them <unit-skill>Out. Detonation Damage Up III</unit-skill> and <unit-skill>Attack Up III</unit-skill> for 1 turn.',
        expects: 'buff|all-allies|on-cast|Attack Up III',
    },
];

// Rows whose catalogue sentence is the only wording the parser reads: the parse must carry
// `expects`.
const CATALOGUE_ROWS: { ship: string; slot: SlotName; text: string; expects: string }[] = [
    {
        ship: 'Asphyxiator',
        slot: 'active',
        text: 'This Unit inflicts <unit-skill>Defense Down III</unit-skill> for 1 turn and deals <unit-damage>175% damage</unit-damage>, then inflicts <unit-skill>Inferno III</unit-skill> for 3 turns on the targeted enemy and all adjacent enemies.',
        expects: 'dot|target-and-adjacent-enemies|on-cast|dot',
    },
    {
        ship: 'Asphyxiator',
        slot: 'charged',
        text: 'This Unit inflicts <unit-skill>Inc. DoT Damage Up III</unit-skill> for 2 turns, deals <unit-damage>215% damage</unit-damage>, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns. If the targeted enemy or adjacent enemies have 3 or more <unit-aid>debuffs</unit-aid>, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn on the targeted enemy and all adjacent enemies.',
        expects: 'control|target-and-adjacent-enemies|on-cast|control',
    },
    {
        ship: 'Volk',
        slot: 'passive',
        text: 'At the start of its turn, this Unit <unit-damage>repairs 30%</unit-damage> of its max HP to the ally with the most missing HP.',
        expects: 'heal|lowest-hp-ally|on-cast|heal',
    },
    {
        ship: 'Volk',
        slot: 'passive',
        text: 'At the start of its turn, this Unit <unit-damage>repairs 30%</unit-damage> of its max HP to the ally with the most missing HP.<br /><br />At the end of its turn, it <unit-damage>repairs itself for 30%</unit-damage> of its max HP.',
        expects: 'heal|lowest-hp-ally|on-cast|heal',
    },
    {
        ship: 'Valkyrie',
        slot: 'passive',
        text: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and at the start of the round, this Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn. <br /><br />When an <unit-skill>Echoing Burst</unit-skill> explodes on an enemy, the Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of the damage dealt.',
        expects: 'heal|self|on-own-echoing-burst-detonated|heal',
    },
    {
        ship: 'Valkyrie',
        slot: 'passive',
        text: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and at the start of the round, this Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn. <br /><br />When an <unit-skill>Echoing Burst</unit-skill> explodes on an enemy, the Unit and the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of the damage dealt.<br /><br />This Unit starts combat <unit-skill>fully charged</unit-skill>.',
        expects: 'heal|self|on-own-echoing-burst-detonated|heal',
    },
];

describe('target and scope phrases — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });

    it.each(CATALOGUE_ROWS)(
        '$ship $slot: the catalogue sentence carries its parse',
        ({ slot, text, expects }) => {
            expect(sigs(parseSlot(slot, text))).toContain(expects);
        }
    );
});

// A ship that GAINS Taunt takes it itself. Taunt draws fire to the ship carrying it, so a
// receiver-less "grants Taunt" in our text names the same self grant.
describe('target and scope phrases — Taunt goes on the taunting ship', () => {
    const cases: { ship: string; slot: 'active' | 'charged'; text: string }[] = [
        {
            ship: 'Madax active (catalogue)',
            slot: 'active',
            text: 'This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn and deals <unit-damage>70% damage</unit-damage> with additional damage equal to <unit-damage>60%</unit-damage> of its defense.',
        },
        {
            ship: 'Madax active (ours)',
            slot: 'active',
            text: 'This Unit grants <unit-skill>Taunt</unit-skill> for 1 turn and deals <unit-damage>Damage equal to 70%</unit-damage> plus an additional <unit-damage>60%</unit-damage> of its Defense.',
        },
        {
            ship: 'Orel charged (catalogue)',
            slot: 'charged',
            text: 'This Unit deals <unit-damage>210% damage</unit-damage> and gains <unit-skill>Taunt</unit-skill> for 1 turn.',
        },
        {
            ship: 'Orel charged (ours)',
            slot: 'charged',
            text: 'This Unit deals <unit-damage>210% damage</unit-damage> and grants <unit-skill>Taunt</unit-skill> for 1 turn.',
        },
        {
            ship: 'Sansi charged (catalogue)',
            slot: 'charged',
            text: 'This Unit deals <unit-damage>230% damage</unit-damage> and gains <unit-skill>Taunt</unit-skill> for 1 turn and <unit-skill>Barrier</unit-skill> for 1 hit.',
        },
        {
            ship: 'Sansi charged (ours)',
            slot: 'charged',
            text: 'This Unit deals <unit-damage>230% Damage</unit-damage> and grants <unit-skill>Taunt</unit-skill> for 1 turn and <unit-skill>Barrier</unit-skill> for 1 hit.',
        },
    ];
    it.each(cases)('$ship', ({ slot, text }) => {
        const s = sigs(parseSlot(slot, text));
        expect(s).toContain('buff|self|on-cast|Taunt');
        expect(s).toContain('control|self|on-cast|control');
        expect(s).not.toContain('buff|all-allies|on-cast|Taunt');
    });

    it('Sansi charged (catalogue): "gains Taunt … and Barrier" puts Barrier on Sansi too', () => {
        const text =
            'This Unit deals <unit-damage>230% damage</unit-damage> and gains <unit-skill>Taunt</unit-skill> for 1 turn and <unit-skill>Barrier</unit-skill> for 1 hit.';
        expect(sigs(parseSlot('charged', text))).toContain('buff|self|on-cast|Barrier');
    });
});

// "grants a shield" with no named receiver on a support cast reaches every ally in the skill's
// pattern, the caster included; "gains a shield" stays on the caster.
describe('target and scope phrases — a granted shield reaches all allies', () => {
    it.each([
        {
            ship: 'AEGIS charged (catalogue)',
            text: 'This Unit grants a <unit-damage>shield equal to 30%</unit-damage> of its max HP and <unit-skill>cleanses 2 debuffs</unit-skill>.',
        },
        {
            ship: 'AEGIS charged (ours)',
            text: 'This Unit grants a <unit-damage>Shield equal to 30%</unit-damage> of its Max HP and <unit-aid>cleanses 2</unit-aid> debuffs.',
        },
        {
            ship: 'Nyxen charged (catalogue)',
            text: 'This Unit <unit-skill>cleanses 2</unit-skill> <unit-skill>damage over time debuffs</unit-skill>, grants a <unit-damage>shield equal to 19%</unit-damage> of its max HP and grants <unit-skill>Inc. Damage Down II</unit-skill> for 1 turn.',
        },
        {
            ship: 'Nyxen charged (ours)',
            text: 'This Unit <unit-aid>Cleanses 2 damage over time debuffs</unit-aid> and Grants a <unit-damage>Shield equal to 19%</unit-damage> of its Max HP. It also Grants <unit-skill>Inc. Damage Down II</unit-skill> for 1 turn.',
        },
        {
            ship: 'a bare granted shield',
            text: 'This Unit grants a <unit-damage>shield equal to 30%</unit-damage> of its max HP.',
        },
    ])('$ship', ({ text }) => {
        const s = sigs(parseSlot('charged', text));
        expect(s).toContain('shield|all-allies|on-cast|shield');
        expect(s).not.toContain('shield|self|on-cast|shield');
    });

    it('a gained shield stays on the caster', () => {
        const text =
            'This Unit gains a <unit-damage>shield equal to 30%</unit-damage> of its max HP.';
        expect(sigs(parseSlot('charged', text))).toContain('shield|self|on-cast|shield');
    });
});

describe('target and scope phrases — ruled recipients on the catalogue text', () => {
    it("Chimei charged: the repair and Rogue's Liberty both reach all allies", () => {
        const text =
            "This Unit <unit-damage>repairs 12%</unit-damage> of its max HP to all allies and grants them <unit-skill>Rogue's Liberty</unit-skill> for 2 turns.";
        const s = sigs(parseSlot('charged', text));
        expect(s).toContain('heal|all-allies|on-cast|heal');
        expect(s).toContain("buff|all-allies|on-cast|Rogue's Liberty");
        expect(s).not.toContain("buff|ally|on-cast|Rogue's Liberty");
    });

    it.each([
        {
            refit: 'R0',
            text: "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>. All allies deal <unit-damage>10% more direct damage</unit-damage> to enemies with <unit-skill>Stasis</unit-skill> or <unit-skill>Disable</unit-skill>.",
        },
        {
            refit: 'R2',
            text: "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>. All allies deal <unit-damage>15% more direct damage</unit-damage> to enemies with <unit-skill>Stasis</unit-skill> or <unit-skill>Disable</unit-skill>.<br /><br />After damaging an enemy affected by <unit-skill>Stasis</unit-skill>, once per round, this Unit <unit-skill>gains one extra action</unit-skill>.",
        },
        {
            refit: 'R4',
            text: "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>. All allies deal <unit-damage>30% more direct damage</unit-damage> to enemies with <unit-skill>Stasis</unit-skill> or <unit-skill>Disable</unit-skill>.<br /><br />After damaging an enemy affected by <unit-skill>Stasis</unit-skill>, once per round, this Unit <unit-skill>gains one extra action</unit-skill>.",
        },
    ])('Tygr passive $refit: the Stasis/Disable damage bonus is a team modifier', ({ text }) => {
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('modifier|all-allies|on-cast|modifier');
        expect(s).not.toContain('modifier|self|on-cast|modifier');
    });

    it('Panon active: Taunted or Provoked, he grants Terran Guard III to every ally', () => {
        const text =
            'This Unit grants all allies <unit-skill>Terran Guard II</unit-skill> for 2 turns and deals <unit-damage>80% damage</unit-damage> with additional damage equal to <unit-damage>70%</unit-damage> of its defense. <br /><br />If this Unit is affected by <unit-skill>Provoke</unit-skill> or <unit-skill>Taunt</unit-skill>, it instead grants all allies <unit-skill>Terran Guard III</unit-skill> for 2 turns and deals <unit-damage>120% damage</unit-damage> with additional damage equal to <unit-damage>90%</unit-damage> of its defense.';
        const abilities = parseSlot('active', text);
        const s = sigs(abilities);
        expect(s).toContain('buff|all-allies|on-cast|Terran Guard III');
        expect(s).not.toContain('buff|self|on-cast|Terran Guard III');
        const tg3 = abilities.find(
            (a) => a.config.type === 'buff' && a.config.buffName === 'Terran Guard III'
        );
        expect(tg3?.conditions?.map((c) => c.buffName).sort()).toEqual(['Provoke', 'Taunt']);
    });

    // The on-ally-crit listener stamps the critting ally as the event's ally, so an 'ally'-target
    // reaction lands on the ally who crit.
    it('Hermes passive R2: Everliving Regeneration III goes to the ally who crit', () => {
        const text =
            "When an ally critically hits an enemy, this Unit <unit-skill>adds 1 charge</unit-skill> to its own charged skill and grants <unit-skill>Everliving Regeneration III</unit-skill> for 2 turns to the ally.<br /><br />This Unit's defense is increased by 20% and when it critically repairs an ally, it <unit-skill>cleanses 1 debuff</unit-skill> from itself.";
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('buff|ally|on-ally-crit|Everliving Regeneration III');
        expect(s).toContain('charge|self|on-ally-crit|charge');
        expect(s).not.toContain('buff|self|on-ally-crit|Everliving Regeneration III');
    });
});
