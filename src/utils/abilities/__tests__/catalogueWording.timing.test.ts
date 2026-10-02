import { describe, it, expect } from 'vitest';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

const PAIRS: RewordPair[] = [
    {
        ship: 'Cobalt',
        slot: 'passive',
        old: 'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill at the start of the turn if it is at full HP.',
        new: 'Every turn this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill if it is at full HP.',
        expects: 'charge|self|start-of-turn|charge',
    },
    {
        ship: 'Cobalt',
        slot: 'passive',
        old: 'This Unit <unit-aid>adds 1 charge</unit-aid> to its charged skill and gains <unit-skill>Out. Damage Up II</unit-skill> for 1 turn at the start of the turn if it is at full HP.',
        new: 'Every turn this Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill and gains <unit-skill>Out. Damage Up II</unit-skill> for 1 turn if it is at full HP.',
        expects: 'charge|self|start-of-turn|charge',
    },
    {
        ship: 'Xcellence',
        slot: 'passive',
        old: "This Unit has 20% Shield Penetration.<br /><br />At the start of each turn this Unit gains <unit-damage>Shield equal to 20%</unit-damage> of its Max HP.<br /><br />When an enemy resists a debuff infliction, this Unit deals damage equal to <unit-damage>115%</unit-damage> of this Unit's current shield..",
        new: "This Unit has <unit-damage>20% shield penetration</unit-damage>.<br /><br />Every turn this Unit gains a <unit-damage>shield equal to 20%</unit-damage> of its max HP.<br /><br />When an enemy resists a <unit-aid>debuff</unit-aid> infliction, this Unit deals damage equal to <unit-damage>115%</unit-damage> of this Unit's current shield.",
        expects: 'shield|self|start-of-turn|shield',
    },
    {
        ship: 'Chakara',
        slot: 'passive',
        old: 'This Unit starts each round with <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn if it has the lowest speed among all Allies. Then, deals <unit-damage>60% damage</unit-damage> to the highest Speed Enemy.',
        new: 'At the start of the round, if this Unit has the lowest speed among all allies, it gains <unit-skill>Attack Up II</unit-skill> and <unit-skill>Defense Up II</unit-skill> for 1 turn. Then deals <unit-damage>60% damage</unit-damage> to the enemy with the highest speed.',
        expects: 'damage|enemy-highest-speed|start-of-round|damage',
    },
    {
        ship: 'Selenite',
        slot: 'passive',
        old: 'This Unit deals 10% more direct damage for every enemy with <unit-skill>Stealth</unit-skill>.<br /><br />At the start of the round, the highest attack enemy is applied with <unit-skill>Concentrate Fire</unit-skill> for 1 turn.',
        new: 'This Unit ignores <unit-skill>Stealth</unit-skill> effects.<br /><br />This Unit deals <unit-damage>10% more direct damage</unit-damage> for every enemy with <unit-skill>Stealth</unit-skill>.<br /><br />At the start of each round, this Unit applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn to the enemy with the highest attack.',
        expects: 'debuff|enemy-highest-attack|start-of-round|Concentrate Fire',
    },
    // Crucialis, FrontLine and Defiant: no numbers substituted — old and new carry the same
    // values in a different order.
    {
        ship: 'Crucialis',
        slot: 'passive',
        old: 'At the start of combat, this Unit gains a <unit-damage>Shield equal to 20%</unit-damage> of its Max HP and gains <unit-skill>Atlas Coordination I</unit-skill> for 6 turns.<br />This Unit has 20% Shield Penetration.',
        new: 'This Unit has <unit-damage>20% shield penetration</unit-damage>.<br /><br />At the start of combat, this Unit gains a <unit-damage>shield equal to 20%</unit-damage> of its max HP and gains <unit-skill>Atlas Coordination I</unit-skill> for 6 turns.',
        expects: 'shield|self|pre-combat|shield',
    },
    {
        ship: 'FrontLine',
        slot: 'passive',
        old: 'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.',
        new: 'This ship has <unit-damage>20% shield penetration</unit-damage>.<br /><br />At the start of combat this Unit gains a <unit-damage>shield equal to 25%</unit-damage> of its max HP and while it has an active shield, it gains 2500 defense.',
        expects: 'conditional-stat|self|on-cast|conditional-stat',
    },
    {
        ship: 'Defiant',
        slot: 'passive',
        old: 'When adjacent to a Supporter, this Unit gains 20% HP. This Unit gains <unit-damage>Shield equal to 30%</unit-damage> of its Max HP when applying Stasis.',
        new: 'This Unit gains a <unit-damage>shield equal to 30%</unit-damage> of its max HP after it inflicts <unit-skill>Stasis</unit-skill>.<br /><br />At the start of combat this Unit gains 20% HP if its adjacent to a supporter.',
        expects: 'pre-combat-stat|self|pre-combat|pre-combat-stat',
    },
];

describe('timing phrases — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });
});

// Rows where only one half is a timing phrase: the timing half is pinned here; the other half's
// rewording (the "deals 70% damage to the enemy" counter clause and the "deals 80% damage"
// enemy-charged-cast damage clause) is not asserted either way.
describe('timing phrases — the timing half of a mixed row', () => {
    it('Stalwart passive R2: "gains 20% attack if its adjacent to a supporter" is the pre-combat grant', () => {
        const text =
            'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to the enemy and gains <unit-skill>Legion Discipline II</unit-skill> for 3 turns.<br /><br />At the start of combat this Unit gains 20% attack if its adjacent to a supporter.';
        const grant = parseSlot('passive', text).find((a) => a.type === 'pre-combat-stat');
        expect(grant).toMatchObject({
            trigger: 'pre-combat',
            config: {
                stat: 'attack',
                value: 20,
                valueKind: 'percent-of-own',
                requiresAdjacentRole: 'SUPPORTER',
            },
        });
    });

    it('FrontLine passive R2: "while it has an active shield, it gains 2500 defense" is the self-shield stat', () => {
        const text =
            'This ship has <unit-damage>20% shield penetration</unit-damage>.<br /><br />At the start of combat this Unit gains a <unit-damage>shield equal to 25%</unit-damage> of its max HP and while it has an active shield, it gains 2500 defense.<br /><br />When an enemy uses their charged skill, this Unit deals <unit-damage>80% damage</unit-damage> and gains a <unit-damage>shield equal to 30%</unit-damage> of the damage dealt, once per round.';
        const abilities = parseSlot('passive', text);
        expect(abilities.find((a) => a.type === 'conditional-stat')?.config).toEqual({
            type: 'conditional-stat',
            stat: 'defence',
            flat: 2500,
            condition: 'self-shield',
        });
        expect(sigs(abilities)).toContain('shield|self|pre-combat|shield');
    });
});

// User ruling (2026-10-02): "Start of combat, This Unit gains Taunt" is the same one-time
// pre-combat grant as "At the start of combat, this Unit gains Taunt".
describe('timing phrases — a bare "Start of combat" is the pre-combat grant', () => {
    const OLD =
        'This Unit takes 35% less damage from Critical hits, and this effect does not stack with similar effects.<br /><br />When directly damaged, This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy and inflicts <unit-skill>Speed Down II</unit-skill> for 1 turn.<br /><br />Start of combat, This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';
    const NEW =
        'When directly damaged, this Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy and inflicts <unit-skill>Speed Down II</unit-skill> for 1 turn.<br /><br />This Unit has <unit-damage>35% damage reduction</unit-damage> from critical hits.<br /><br />At the start of combat, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

    it('Iridium passive R2: our Taunt grant is the pre-combat grant, with no cast-time twin', () => {
        const abilities = parseSlot('passive', OLD);
        const s = sigs(abilities);
        expect(s).toContain('buff|self|pre-combat|Taunt');
        expect(s).not.toContain('buff|self|on-cast|Taunt');
        expect(s).not.toContain('control|self|on-cast|control');
        expect(
            abilities.find((a) => a.type === 'buff' && a.trigger === 'pre-combat')?.config
        ).toEqual({
            type: 'buff',
            buffName: 'Taunt',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 1,
        });
    });

    it('Iridium passive R2: the catalogue wording parses like ours', () => {
        const before = parseSlot('passive', OLD);
        expect(sigs(before)).toContain('buff|self|pre-combat|Taunt');
        expect(canonical(parseSlot('passive', NEW))).toEqual(canonical(before));
    });
});

// User ruling R8 (2026-10-01): Nuqtu cleanses a debuff from herself every turn, at most once per
// round; separately, each time an enemy gains a buff she gains Terran Bolster III (and, at refit 2,
// a stack of Core Charge I).
describe('timing phrases — ruled rows', () => {
    it('Nuqtu passive R0: every-turn once-per-round cleanse; Terran Bolster on an enemy buff', () => {
        const text =
            'Every turn this Unit <unit-skill>cleanses 1 debuff</unit-skill>, once per round, and when an enemy gains a <unit-aid>buff</unit-aid> this Unit gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn.';
        const abilities = parseSlot('passive', text);
        const s = sigs(abilities);
        expect(s).toContain('cleanse|self|start-of-turn|cleanse');
        expect(s).toContain('buff|self|on-enemy-buffed|Terran Bolster III');
        expect(s).not.toContain('cleanse|self|on-enemy-buffed|cleanse');
        expect(s).not.toContain('buff|self|start-of-turn|Terran Bolster III');
        expect(abilities.find((a) => a.type === 'cleanse')?.oncePerRound).toBe(true);
    });

    it('Nuqtu passive R2: the Core Charge stack also rides the enemy-buffed reaction', () => {
        const text =
            'Every turn this Unit <unit-skill>cleanses 1 debuff</unit-skill>, once per round, and when an enemy gains a <unit-aid>buff</unit-aid> this Unit gains <unit-skill>Terran Bolster III</unit-skill> for 1 turn and gains 1 stack of <unit-skill>Core Charge I</unit-skill>.';
        const abilities = parseSlot('passive', text);
        const s = sigs(abilities);
        expect(s).toContain('cleanse|self|start-of-turn|cleanse');
        expect(s).toContain('buff|self|on-enemy-buffed|Terran Bolster III');
        expect(s).toContain('buff|self|on-enemy-buffed|Core Charge I');
        expect(s).not.toContain('buff|self|on-cast|Core Charge I');
        expect(s).not.toContain('buff|self|start-of-turn|Terran Bolster III');
        expect(abilities.find((a) => a.type === 'cleanse')?.oncePerRound).toBe(true);
    });
});

// An "every turn" Overload stack stays a per-round accumulator on on-cast; the Cobalt every-turn
// charge branch in parseChargeGain relies on detectReactiveTrigger not turning it into a
// start-of-turn trigger.
describe('timing phrases — per-round stacking is kept', () => {
    it('Butcher passive R0: the every-turn Overload buff stacks per round on on-cast', () => {
        const text =
            'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>.';
        const buff = parseSlot('passive', text).find((a) => a.type === 'buff');
        expect(buff).toMatchObject({
            trigger: 'on-cast',
            config: { buffName: 'Overload', stackTrigger: 'per-round' },
        });
    });
});
