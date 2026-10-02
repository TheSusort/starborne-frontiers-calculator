import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { parseSkillEffects } from '../../skillTextParser';
import type { Ship } from '../../../types/ship';
import {
    parseSlot,
    sigs,
    canonical,
    type RewordPair,
    type SlotName,
} from './helpers/catalogueWording';

// Lingshe charged's extra number is the "reduced to 0 turns" sentence the catalogue drops.
const PAIRS: RewordPair[] = [
    {
        ship: 'Stalwart',
        slot: 'passive',
        old: 'When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.',
        new: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When this Unit is directly damaged as a primary target, it deals <unit-damage>30% damage</unit-damage> to the enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.',
        expects: 'counter|enemy|on-attacked|counter',
    },
    {
        ship: 'Stalwart',
        slot: 'passive',
        old: 'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.<br /><br />Additionally, when this Unit is adjacent to a Supporter, this Unit gains 20% Attack.',
        new: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to the enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.<br /><br />At the start of combat this Unit gains 20% attack if its adjacent to a supporter.',
        expects: 'counter|enemy|on-attacked|counter',
    },
    {
        ship: 'Orel',
        slot: 'passive',
        old: 'When directly damaged by an enemy effected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>, this unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> for 2 turns.',
        new: 'When directly damaged by an enemy effected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>, this Unit transforms the damage into a <unit-skill>damage over time effect</unit-skill> lasting 2 turns.',
        expects: 'transform-incoming-to-dot|self|on-attacked|transform-incoming-to-dot',
    },
    {
        ship: 'Orel',
        slot: 'passive',
        old: 'When directly damaged by an enemy effected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>, this unit transforms the damage into a <unit-skill>Damage over Time effect</unit-skill> for 3 turns.',
        new: 'When directly damaged by an enemy effected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>, this Unit transforms the damage into a <unit-skill>damage over time effect</unit-skill> lasting 3 turns.',
        expects: 'transform-incoming-to-dot|self|on-attacked|transform-incoming-to-dot',
    },
    {
        ship: 'Sefuba',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>200% damage</unit-damage> and <unit-aid>removes 2 charges</unit-aid> from the enemy.',
        new: 'This Unit deals <unit-damage>200% damage</unit-damage> and <unit-skill>removes 2 charges</unit-skill> from the enemies charged skill.',
        expects: 'charge|enemy|on-cast|charge',
    },
    {
        ship: 'Lingshe',
        slot: 'charged',
        old: 'This Unit reduces all <unit-skill>Bombs</unit-skill> on the enemy targets by 1 turn, <unit-skill>Bombs</unit-skill> reduced to 0 turns by this skill will detonate.<br />This reduction effect requires hacking.<br /><br />This Unit inflicts <unit-skill>Bomb III</unit-skill> for 3 turns.',
        new: 'This Unit reduces all <unit-skill>Bomb</unit-skill> on the enemy targets by 1 turn.<br />This reduction effect requires hacking.<br /><br />This Unit inflicts <unit-skill>Bomb III</unit-skill> for 3 turns.',
        expects: 'bomb-countdown-reduce|all-enemies|on-cast|bomb-countdown-reduce',
    },
];

// Rows whose catalogue sentence is the only wording the parser reads: the parse must carry
// `expects`.
const CATALOGUE_ROWS: { ship: string; slot: SlotName; text: string; expects: string }[] = [
    {
        ship: 'Akula',
        slot: 'passive',
        text: "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>, and also ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects. <br /><br />This Unit <unit-damage>increases outgoing direct damage</unit-damage> based on the enemies current HP, up to <unit-damage>30%</unit-damage> when the enemy is at full HP.",
        expects: 'modifier|self|on-cast|modifier',
    },
    {
        ship: 'Akula',
        slot: 'passive',
        text: "This Unit's attacks do not reduce <unit-skill>Stasis</unit-skill>, and also ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects. <br /><br />This Unit <unit-damage>increases outgoing direct damage</unit-damage> based on the enemies current HP, up to <unit-damage>30%</unit-damage> when the enemy is at full HP.<br /><br />This Unit starts combat <unit-skill>fully charged</unit-skill>.",
        expects: 'modifier|self|on-cast|modifier',
    },
    {
        ship: 'Panon',
        slot: 'passive',
        text: 'If this Unit is directly damaged and does not have <unit-skill>Barrier Recharging</unit-skill>, it gains <unit-skill>Barrier</unit-skill> for 1 turn and applies <unit-skill>Barrier Recharging</unit-skill> to itself for 3 turns.<br /><br />This Unit gains <unit-damage>20% damage reduction</unit-damage> from all sources when affected by <unit-skill>Barrier Recharging</unit-skill>.',
        expects: 'incoming-reduction|self|on-cast|incoming-reduction',
    },
    {
        ship: 'Malvex',
        slot: 'passive',
        text: 'When directly damaged as a primary target, this Unit gains <unit-damage>shield equal to 15%</unit-damage> of the damage dealt.<br /><br />When this Unit has an active shield, it gains <unit-damage>10% damage reduction</unit-damage>.',
        expects: 'incoming-reduction|self|on-cast|incoming-reduction',
    },
    {
        ship: 'Tormenter',
        slot: 'passive',
        text: "This Unit's attacks always critically hit and gains up to <unit-damage>30% damage reduction</unit-damage> as its health decreases.",
        expects: 'incoming-reduction|self|on-cast|incoming-reduction',
    },
    {
        ship: 'Rikra',
        slot: 'charged',
        text: 'This Unit gains <unit-skill>Defense Up II</unit-skill> for 2 turns and deals <unit-damage>180% damage</unit-damage> with an additional <unit-damage>80% damage</unit-damage> to enemies affected by <unit-skill>Taunt</unit-skill> or <unit-skill>Provoke</unit-skill>.',
        expects: 'damage|enemy|on-cast|damage',
    },
    {
        ship: 'Zeolite',
        slot: 'passive',
        text: 'When this Unit deals damage to a defender it <unit-skill>purges 1 buff</unit-skill> from that enemy.',
        expects: 'purge|enemy|on-deal-damage|purge',
    },
    {
        ship: 'Zeolite',
        slot: 'passive',
        text: 'When this Unit deals damage to a defender it <unit-skill>purges 1 buff</unit-skill> from that enemy.<br /><br />This Unit deals <unit-damage>30% more damage</unit-damage> when hitting a defender.',
        expects: 'purge|enemy|on-deal-damage|purge',
    },
    {
        ship: 'Demolisher',
        slot: 'passive',
        text: "When a <unit-skill>Bomb</unit-skill> explodes on an enemy, this Unit <unit-skill>removes 2 charges</unit-skill> from the enemy's charged skill and deals 100% of the <unit-skill>Bomb</unit-skill> damage to all adjacent enemies. This damage ignores defense and cannot critically hit.",
        expects: 'damage|adjacent-enemies|on-bomb-detonated|damage',
    },
    {
        ship: 'FrontLine',
        slot: 'passive',
        text: 'This ship has <unit-damage>20% shield penetration</unit-damage>.<br /><br />At the start of combat this Unit gains a <unit-damage>shield equal to 25%</unit-damage> of its max HP and while it has an active shield, it gains 2500 defense.<br /><br />When an enemy uses their charged skill, this Unit deals <unit-damage>80% damage</unit-damage> and gains a <unit-damage>shield equal to 30%</unit-damage> of the damage dealt, once per round.',
        expects: 'damage|enemy|on-enemy-charged-cast|damage',
    },
    {
        ship: 'Rhodium',
        slot: 'active',
        text: 'This Unit deals <unit-damage>140% damage</unit-damage> with an additional <unit-damage>25%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy. <br /><br />This Unit <unit-skill>adds charges</unit-skill> to its charged skill equal to the number of <unit-aid>buffs</unit-aid> on the enemy.',
        expects: 'charge|self|on-cast|charge',
    },
];

describe('damage, defence and charge clauses — catalogue wording parses like ours', () => {
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

const rowText = (ship: string): string => CATALOGUE_ROWS.filter((p) => p.ship === ship)[0].text;

// A percentage that names a damage REDUCTION, a damage share or an enemy-side condition is not an
// attack of its own.
describe('damage, defence and charge clauses — the catalogue sentence mints no extra ability', () => {
    it.each([
        { ship: 'Panon', slot: 'passive' as const },
        { ship: 'Malvex', slot: 'passive' as const },
        { ship: 'Tormenter', slot: 'passive' as const },
    ])('$ship: "damage reduction" is not an on-cast hit', ({ ship, slot }) => {
        expect(sigs(parseSlot(slot, rowText(ship)))).not.toContain('damage|enemy|on-cast|damage');
    });

    it('FrontLine R2: the enemy-charged-cast hit is not also an on-cast hit', () => {
        const s = sigs(parseSlot('passive', rowText('FrontLine')));
        expect(s).toContain('damage|enemy|on-enemy-charged-cast|damage');
        expect(s).not.toContain('damage|enemy|on-cast|damage');
    });

    it('Rikra charged: "enemies affected by Taunt or Provoke" grants Rikra neither', () => {
        const s = sigs(parseSlot('charged', rowText('Rikra')));
        expect(s).not.toContain('buff|self|on-cast|Taunt');
        expect(s).not.toContain('buff|self|on-cast|Provoke');
    });
});

describe('damage, defence and charge clauses — mixed rows', () => {
    // The Taunt half of this row is the start-of-combat family's; only the crit reduction and the
    // phantom hit are pinned here.
    it('Iridium passive R2: "35% damage reduction from critical hits" is the crit reduction', () => {
        const text =
            'When directly damaged, this Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy and inflicts <unit-skill>Speed Down II</unit-skill> for 1 turn.<br /><br />This Unit has <unit-damage>35% damage reduction</unit-damage> from critical hits.<br /><br />At the start of combat, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';
        const abilities = parseSlot('passive', text);
        expect(sigs(abilities)).not.toContain('damage|enemy|on-cast|damage');
        const reductions = abilities.filter((a) => a.config.type === 'incoming-reduction');
        expect(reductions.map((a) => a.config)).toEqual([
            {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'incoming-crit',
                pct: 35,
                critFamily: true,
            },
        ]);
    });

    it('Hermes passive R2: "when it critically repairs an ally" keeps the cleanse reactive', () => {
        const text =
            "When an ally critically hits an enemy, this Unit <unit-skill>adds 1 charge</unit-skill> to its own charged skill and grants <unit-skill>Everliving Regeneration III</unit-skill> for 2 turns to the ally.<br /><br />This Unit's defense is increased by 20% and when it critically repairs an ally, it <unit-skill>cleanses 1 debuff</unit-skill> from itself.";
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('cleanse|self|on-ally-critically-repaired|cleanse');
        expect(s).not.toContain('cleanse|self|on-cast|cleanse');
    });
});

describe('damage, defence and charge clauses — ruled readings of the catalogue text', () => {
    // Wusheng keeps Stealth when hit directly; Stealth only cuts the direct damage he takes.
    it.each([
        {
            refit: 'R0',
            text: 'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.<br /><br />This Unit takes <unit-damage>25% less direct damage</unit-damage> while <unit-skill>Stealth</unit-skill> is active.',
        },
        {
            refit: 'R2',
            text: 'This Unit gains <unit-skill>Stealth</unit-skill> for 1 turn after critically damaging an enemy.<br /><br />This Unit takes <unit-damage>25% less direct damage</unit-damage> while <unit-skill>Stealth</unit-skill> is active.<br /><br />This Unit starts combat <unit-skill>fully charged</unit-skill>.',
        },
    ])('Wusheng passive $refit: less direct damage in Stealth, Stealth kept', ({ text }) => {
        const abilities = parseSlot('passive', text);
        const s = sigs(abilities);
        expect(s).toContain('buff|self|on-crit|Stealth');
        expect(s.some((x) => x.startsWith('remove-self-buff|'))).toBe(false);
        expect(
            abilities.filter((a) => a.config.type === 'incoming-reduction').map((a) => a.config)
        ).toEqual([
            {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'self-stealth',
                pct: 25,
                critFamily: false,
            },
        ]);
    });

    // Provider's charged extends the DoTs on every enemy its pattern hits.
    it('Provider charged: every DoT on the enemies hit is extended by 1 turn', () => {
        const text =
            "This Unit deals <unit-damage>200% damage</unit-damage>, <unit-skill>removes 1 charge</unit-skill> from the enemy's charged skill and all <unit-skill>damage over time debuffs</unit-skill> are <unit-skill>extended by 1 turn</unit-skill>.";
        const abilities = parseSlot('charged', text);
        const s = sigs(abilities);
        expect(s).toContain('extend-dot|all-enemies|on-cast|extend-dot');
        expect(s.some((x) => x.startsWith('extend-status|'))).toBe(false);
        expect(s).toContain('charge|enemy|on-cast|charge');
        expect(abilities.find((a) => a.type === 'extend-dot')?.config).toEqual({
            type: 'extend-dot',
            turns: 1,
        });
    });

    const shipOf = (s: Pick<Ship, 'activeSkillText' | 'chargeSkillText'> & { passive: string }) =>
        ({
            refits: [],
            chargeSkillCharge: 4,
            activeSkillText: s.activeSkillText,
            chargeSkillText: s.chargeSkillText,
            firstPassiveSkillText: s.passive,
        }) as unknown as Ship;

    it('Rhodium: ignores Stealth on every skill', () => {
        const ship = shipOf({
            activeSkillText:
                'This Unit deals <unit-damage>140% damage</unit-damage> with an additional <unit-damage>25%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy. <br /><br />This Unit <unit-skill>adds charges</unit-skill> to its charged skill equal to the number of <unit-aid>buffs</unit-aid> on the enemy.',
            chargeSkillText:
                'This Unit deals <unit-damage>170% damage</unit-damage> with an additional <unit-damage>35%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy.',
            passive:
                'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />At the end of the round, this Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy with the most <unit-aid>buffs</unit-aid>.',
        });
        expect(buildShipAbilities(ship).ignoresStealth).toBe(true);
    });

    it('Selenite: ignores Stealth on every skill', () => {
        const ship = shipOf({
            activeSkillText:
                'This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of its max HP. If any target has <unit-skill>Stealth</unit-skill>, this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill.',
            chargeSkillText:
                'This Unit deals <unit-damage>300% damage</unit-damage> with additional damage equal to <unit-damage>17.5%</unit-damage> of its max HP.',
            passive:
                'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more direct damage</unit-damage> for every enemy with <unit-skill>Stealth</unit-skill>.',
        });
        expect(buildShipAbilities(ship).ignoresStealth).toBe(true);
    });

    it("Snakeroot: its attacks do not reduce an enemy's Stasis", () => {
        const ship = shipOf({
            activeSkillText:
                'This Unit deals <unit-damage>170% damage</unit-damage> and inflicts 2 stacks of <unit-skill>Corrosion I</unit-skill> for 2 turns.',
            chargeSkillText:
                'This Unit deals <unit-damage>210% damage</unit-damage> and inflicts 2 stacks of <unit-skill>Corrosion II</unit-skill> for 3 turns.',
            passive:
                'This Unit deals <unit-damage>90% damage</unit-damage> for every 7 stacks of <unit-skill>damage over time</unit-skill> inflicted onto a single enemy.<br />This attack does not reduce <unit-skill>Stasis</unit-skill>.',
        });
        expect(buildShipAbilities(ship).doesntBreakStasis).toBe(true);
    });
});

// A tag around a mechanic phrase ("cleanses 2 debuffs", "extends the newly inflicted") names no
// buff or debuff, so it is never read as a status grant.
describe('damage, defence and charge clauses — tagged mechanic phrases are not statuses', () => {
    it.each([
        {
            ship: 'AEGIS charged',
            source: 'charge' as const,
            text: 'This Unit grants a <unit-damage>shield equal to 30%</unit-damage> of its max HP and <unit-skill>cleanses 2 debuffs</unit-skill>.',
            phrase: 'cleanses 2 debuffs',
            // The tagged mechanic phrases are the only clauses, so nothing parses.
            expectedNames: [] as string[],
            // The same clause shape plus a real status proves the parser is live on it.
            control: {
                text: 'This Unit grants a <unit-damage>shield equal to 30%</unit-damage> of its max HP and <unit-skill>cleanses 2 debuffs</unit-skill> and inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
                name: 'Inferno II',
            },
        },
        // KNOWN GAP: 'Corrosion' is a phantom read of "extends the newly inflicted Corrosion",
        // which names the status being extended, not a second inflict; our text parses it too.
        {
            ship: 'Wisteria passive R2',
            source: 'passive2' as const,
            text: "When this Unit inflicts <unit-skill>Corrosion</unit-skill> with a critical hit, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns and <unit-skill>extends the newly inflicted</unit-skill> <unit-skill>Corrosion</unit-skill> by 1 turn with the extension chance equal to this Unit's crit power.",
            phrase: 'extends the newly inflicted',
            expectedNames: ['Inferno II', 'Corrosion'],
            control: undefined,
        },
    ])('$ship', ({ source, text, phrase, expectedNames, control }) => {
        const names = parseSkillEffects(text, source).map((e) => e.buffName);
        expect(names).not.toContain(phrase);
        expect(names).toEqual(expectedNames);
        if (control) {
            expect(parseSkillEffects(control.text, source).map((e) => e.buffName)).toContain(
                control.name
            );
        }
    });
});

// User ruling (2026-10-02): "This Unit has N% defense penetration" in passive text DESCRIBES the
// refit ascension stat (Judge's innate 20%, Ravager's refit-2 10%), which already reaches the
// ship's stats, so it never mints a modifier of its own. A skill-scoped "This skill has N% defense
// penetration" (Chakara's charged) is not a ship stat and still mints one.
describe('damage, defence and charge clauses — defense penetration describes the refit stat', () => {
    const defPen = (slot: 'active' | 'charged' | 'passive', text: string) =>
        parseSlot(slot, text).filter(
            (a) => a.config.type === 'modifier' && a.config.channel === 'defensePenetration'
        );

    it.each([
        {
            label: 'Judge passive R0, our text',
            text: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.',
        },
        {
            label: 'Judge passive R0, catalogue text',
            text: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage>.<br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.',
        },
        {
            label: 'Judge passive R2, our text',
            text: 'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.<br /><br />This Unit deals <unit-damage>20% more direct damage</unit-damage> for each destroyed enemy, up to max of 100%.',
        },
    ])('$label: no defense-penetration modifier; the round-start hit still parses', ({ text }) => {
        expect(defPen('passive', text)).toEqual([]);
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('damage|all-enemies|start-of-round|damage');
    });

    it('Judge passive R2: the per-destroyed-enemy damage modifier is the only modifier', () => {
        const text =
            'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects and has <unit-damage>20% defense penetration</unit-damage><br /><br />At the start of the round, this Unit deals <unit-damage>60% damage</unit-damage> to all enemies with less than 50% HP.<br /><br />This Unit deals <unit-damage>20% more direct damage</unit-damage> for each destroyed enemy, up to max of 100%.';
        const mods = parseSlot('passive', text).filter((a) => a.type === 'modifier');
        expect(mods.map((a) => a.config)).toEqual([
            expect.objectContaining({ type: 'modifier', channel: 'outgoingDamage' }),
        ]);
    });

    it('Ravager passive R2: the catalogue text carries its resist buff, with no modifier', () => {
        const text =
            "This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.<br /><br />If this Unit's debuff is resisted, it gains <unit-skill>Hacking Module Overdrive</unit-skill> for 1 turn. This Unit has <unit-damage>10% defense penetration</unit-damage>.";
        const s = sigs(parseSlot('passive', text));
        expect(s).toContain('buff|self|on-own-debuff-resisted|Hacking Module Overdrive');
        expect(defPen('passive', text)).toEqual([]);
        expect(s).not.toContain('modifier|self|on-cast|modifier');
    });

    it('Chakara charged: "This skill has 20% defense penetration" still mints the skill-scoped pen', () => {
        const old =
            'This Unit deals <unit-damage>220% damage</unit-damage> with an additional amount equal to <unit-damage>100%</unit-damage> of its Defense, bypassing 20% of the enemy Defense, and <unit-aid>purges 1</unit-aid> buff from the enemy.';
        const next =
            'This Unit deals <unit-damage>220% damage</unit-damage> with additional damage equal to <unit-damage>100%</unit-damage> of its defense and <unit-skill>purges 1 buff</unit-skill> from the enemy.<br /><br />This skill has <unit-damage>20% defense penetration</unit-damage>.';
        expect(defPen('charged', next).map((a) => a.config)).toEqual([
            { type: 'modifier', channel: 'defensePenetration', value: 20, isMultiplicative: false },
        ]);
        expect(canonical(parseSlot('charged', next))).toEqual(canonical(parseSlot('charged', old)));
    });
});
