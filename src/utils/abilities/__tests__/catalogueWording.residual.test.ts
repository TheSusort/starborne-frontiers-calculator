import { describe, it, expect } from 'vitest';
import type { Ability } from '../../../types/abilities';
import { abilitySignature } from '../../../../scripts/lib/skillParseDiff';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

/** A pair whose meaning rides a condition or config value a signature cannot see: the OLD parse
 *  must carry `carries` on an ability with signature `expects`, so a pair where BOTH texts lost
 *  the condition cannot pass. */
interface ResidualPair extends RewordPair {
    carries: Record<string, unknown>;
}

type ResidualRow = Omit<ResidualPair, 'old' | 'new'> & { text: string };

// Tygr active is a number row (Security Down II -> III); `old` carries the catalogue's tier.
const PAIRS: ResidualPair[] = [
    {
        ship: 'Centurion',
        slot: 'passive',
        old: 'At the start of combat, this Unit gains 750 attack per adjacent ally.\n<br /><br />\nWhen this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50%</unit-damage>.',
        new: 'At the start of combat, this Unit gains 750 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>50% damage</unit-damage>.',
        expects: 'counter|enemy|on-attacked|counter',
        carries: { config: expect.objectContaining({ multiplier: 50 }) },
    },
    {
        ship: 'Centurion',
        slot: 'passive',
        old: 'At the start of combat, this Unit gains 1000 attack per adjacent ally.\n<br /><br />\nWhen this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>100%</unit-damage>.',
        new: 'At the start of combat, this Unit gains 1000 attack per adjacent ally.<br /><br />When this Unit or an adjacent ally is directly damaged, this Unit retaliates dealing <unit-damage>100% damage</unit-damage>.',
        expects: 'counter|enemy|on-ally-attacked|counter',
        carries: { config: expect.objectContaining({ multiplier: 100 }) },
    },
    {
        ship: 'Makoli',
        slot: 'active',
        old: 'This Unit <unit-aid>cleanses 1</unit-aid> debuff, <unit-damage>repairs 5%</unit-damage> of its Max HP with an additional repair equal to 100% of its Defense, and grants <unit-skill>Inc. Damage Down II</unit-skill> for 2 turns.',
        new: 'This Unit <unit-skill>cleanses 1 debuff</unit-skill>, <unit-damage>repairs 5%</unit-damage> of its max HP with additional repair equal to <unit-damage>100%</unit-damage> of its defense and grants <unit-skill>Inc. Damage Down II</unit-skill> for 2 turns.',
        expects: 'heal|all-allies|on-cast|heal',
        carries: { config: expect.objectContaining({ basis: 'defense', pct: 100 }) },
    },
    {
        ship: 'Makoli',
        slot: 'charged',
        old: 'This Unit <unit-damage>repairs 7%</unit-damage> of its Max HP and an additional amount equal to <unit-damage>120%</unit-damage> of its Defense, grants <unit-skill>Defense Up II</unit-skill> for 2 turns, and grants <unit-skill>Terran Guard II</unit-skill> for 2 turns.',
        new: 'This Unit <unit-damage>repairs 7%</unit-damage> of its max HP with additional repair equal to <unit-damage>120%</unit-damage> of its defense, grants <unit-skill>Defense Up II</unit-skill> and <unit-skill>Terran Guard II</unit-skill> for 2 turns.',
        expects: 'heal|all-allies|on-cast|heal',
        carries: { config: expect.objectContaining({ basis: 'defense', pct: 120 }) },
    },
    {
        ship: 'Nayra',
        slot: 'charged',
        old: 'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns, dealing <unit-damage>210% damage</unit-damage> and additional <unit-damage>damage equal to 30%</unit-damage> of its defense.<br />If the target was repaired this round, inflict <unit-skill>Exposed</unit-skill> for 1 turn and purge all buffs from the enemy.',
        new: 'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down III</unit-skill> for 2 turns, deals <unit-damage>210% damage</unit-damage> with additional damage equal to <unit-damage>30%</unit-damage> of its defense. If the target was repaired this round, inflict 1 stack of <unit-skill>Exposed</unit-skill> and <unit-skill>purge all buffs</unit-skill> from the enemy.',
        expects: 'debuff|enemy|on-cast|Exposed',
        carries: { config: expect.objectContaining({ duration: 1, stacks: 1 }) },
    },
    {
        ship: 'Tygr',
        slot: 'active',
        old: 'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down III</unit-skill> for 2 turns. If it damages 2 or more enemies, it adds <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.',
        new: 'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Security Down III</unit-skill> for 2 turns.<br /><br />If this Unit damages 2 or more enemies, it <unit-skill>adds 1 charge</unit-skill> to its charged skill.',
        expects: 'debuff|enemy|on-cast|Security Down III',
        carries: { config: expect.objectContaining({ parsedEffects: { security: -60 } }) },
    },
];

// Rows whose catalogue sentence is the only wording the parser reads: the parse must carry
// `carries` on an ability with signature `expects`.
const CATALOGUE_ROWS: ResidualRow[] = [
    {
        ship: 'APEX',
        slot: 'charged',
        text: 'This Unit deals <unit-damage>220% damage</unit-damage> and inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Out. Damage Down II</unit-skill> for 2 turns. If this Unit has an active shield, the primary target is inflicted with <unit-skill>Disable</unit-skill> for 2 turns.',
        expects: 'debuff|enemy|on-cast|Disable',
        carries: { conditions: [expect.objectContaining({ subject: 'self-shield' })] },
    },
    {
        ship: 'Isha',
        slot: 'passive',
        text: 'At the start of the round this Unit gains <unit-skill>Offensive Affinity Override</unit-skill>. If Nayra is on the same team, it also gains <unit-skill>Defensive Affinity Override</unit-skill>.<br /><br />When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP, but when critcally hit, it instead <unit-damage>repairs 6%</unit-damage> of its max HP.',
        expects: 'heal|self|on-attacked|heal',
        carries: { triggerCritFilter: 'crit', config: expect.objectContaining({ pct: 6 }) },
    },
    {
        ship: 'Lodolite',
        slot: 'active',
        text: 'This Unit deals <unit-damage>240% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of its max HP.<br /><br />When this attack targets non-defenders, it also applies <unit-skill>Concentrate Fire</unit-skill> for 2 turns.',
        expects: 'debuff|enemy|on-cast|Concentrate Fire',
        carries: {
            conditions: [
                expect.objectContaining({
                    subject: 'enemy-type',
                    requiredEnemyType: 'Defender',
                    negate: true,
                }),
            ],
        },
    },
    {
        ship: 'Quixilver',
        slot: 'passive',
        text: 'This Unit gains a <unit-damage>shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having a shield.',
        expects: 'shield|self|on-cast|shield',
        carries: { config: expect.objectContaining({ requiresHpDamage: true }) },
    },
    {
        ship: 'Quixilver',
        slot: 'passive',
        text: "This Unit gains a <unit-damage>shield equal to 25%</unit-damage> of the damage taken when taking HP damage and still having a shield.<br /><br />At the end of this Unit's turn if it has shield equal to 100% of its max HP, this Unit grants all allies <unit-skill>Barrier</unit-skill> for 1 hit and applies <unit-skill>Barrier Recharging</unit-skill> for 3 turns.",
        expects: 'shield|self|on-cast|shield',
        carries: { config: expect.objectContaining({ requiresHpDamage: true }) },
    },
    {
        ship: 'Yin Jian',
        slot: 'active',
        text: 'This Unit deals <unit-damage>95% damage</unit-damage> and if it has <unit-skill>Stealth</unit-skill> it deals an additional <unit-damage>50% damage</unit-damage>.',
        expects: 'damage|enemy|on-cast|damage',
        carries: {
            conditions: [expect.objectContaining({ subject: 'self-buff', buffName: 'Stealth' })],
            scaling: { conditionIndex: 0, perUnit: 50 },
        },
    },
];

const withSig = (abilities: Ability[], sig: string): Ability[] =>
    abilities.filter((a) => abilitySignature(a) === sig);

describe('residual — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects, carries }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(withSig(before, expects)).toEqual(
            expect.arrayContaining([expect.objectContaining(carries)])
        );
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });

    it.each(CATALOGUE_ROWS)(
        '$ship $slot: the catalogue sentence carries its parse',
        ({ slot, text, expects, carries }) => {
            const abilities = parseSlot(slot, text);
            expect(sigs(abilities)).toContain(expects);
            expect(withSig(abilities, expects)).toEqual(
                expect.arrayContaining([expect.objectContaining(carries)])
            );
        }
    );

    it('Centurion: "retaliates dealing 50% damage" is one self + one adjacent-ally counter, grouped', () => {
        const abilities = parseSlot('passive', PAIRS.find((p) => p.ship === 'Centurion')!.new);
        const counters = abilities.filter((a) => a.type === 'counter');
        expect(counters.map((a) => a.trigger).sort()).toEqual(['on-ally-attacked', 'on-attacked']);
        const groups = counters.map(
            (a) => (a.config as { counterGroupId?: string }).counterGroupId
        );
        expect(groups[0]).toBeDefined();
        expect(groups[1]).toBe(groups[0]);
        // The retaliation is the whole damage clause: no on-cast attack rides beside it.
        expect(abilities.some((a) => a.type === 'damage')).toBe(false);
    });
});

// User ruling K (2026-10-02): Hermes' charged gives a charge to every ally within his skill
// pattern, himself included; any ally in the pattern below 40% HP gets Cheat Death.
describe('residual — Hermes charged (ruled)', () => {
    const text =
        'This Unit <unit-damage>repairs 37%</unit-damage> of its max HP and <unit-skill>adds 1 charge</unit-skill> to the charged skill of allies.<br /><br />If an ally has less than 40% HP, it grants that ally <unit-skill>Cheat Death</unit-skill>.';

    it('the charge goes to every ally in the pattern, not to Hermes alone', () => {
        const abilities = parseSlot('charged', text);
        expect(sigs(abilities)).toEqual([
            'buff|all-allies|on-cast|Cheat Death',
            'charge|all-allies|on-cast|charge',
            'heal|all-allies|on-cast|heal',
        ]);
        const charge = abilities.find((a) => a.type === 'charge')!;
        expect(charge.config).toEqual({ type: 'charge', amount: 1 });
        expect(charge.conditions).toEqual([]);
    });

    // The HP test is asked of EACH recipient (`recipientFilter`), read after the cast's repair
    // (clause order). Engine behaviour: hermesCheatDeathPerRecipient.integration.test.ts.
    it('Cheat Death reaches every ally in the pattern, each gated on its own HP below 40%', () => {
        const cheatDeath = parseSlot('charged', text).find((a) => a.type === 'buff')!;
        expect(cheatDeath).toMatchObject({
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            recipientFilter: { hpBelowPct: 40 },
            config: { type: 'buff', buffName: 'Cheat Death' },
        });
    });
});
