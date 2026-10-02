import { describe, it, expect } from 'vitest';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

const PAIRS: RewordPair[] = [
    {
        ship: 'Gallant',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns on kill.',
        new: 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.',
        expects: 'buff|self|on-enemy-destroyed|Legion Discipline I',
    },
    {
        ship: 'Gallant',
        slot: 'passive',
        old: 'This Unit gains <unit-skill>Legion Discipline II</unit-skill> for 4 turns on kill.',
        new: 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline II</unit-skill> for 4 turns.',
        expects: 'buff|self|on-enemy-destroyed|Legion Discipline II',
    },
    {
        ship: 'Mangler',
        slot: 'passive',
        old: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> on kill. Additionally, it gains <unit-skill>Marauder Rage I</unit-skill> for 2 turns upon killing an opponent.',
        new: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>. Additionally, it gains <unit-skill>Marauder Rage I</unit-skill> for 2 turns upon destroying an enemy.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Mangler',
        slot: 'passive',
        old: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> on kill. Additionally, it gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns upon killing an opponent.',
        new: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>. Additionally, it gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns upon destroying an enemy.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Medved',
        slot: 'passive',
        old: 'This Unit has 20% Shield Penetration. On kill, it gains <unit-skill>XAOC Swiftness I</unit-skill> for 2 turns.',
        new: 'This Unit has <unit-aid>20% shield penetration</unit-aid>.<br /><br />When this Unit destroys an enemy, it gains <unit-skill>XAOC Swiftness I</unit-skill> for 2 turns.',
        expects: 'buff|self|on-enemy-destroyed|XAOC Swiftness I',
    },
    {
        ship: 'Medved',
        slot: 'passive',
        old: 'This Unit has 20% Shield Penetration. On kill, it gains <unit-skill>XAOC Swiftness II</unit-skill> for 3 turns.',
        new: 'This Unit has <unit-aid>20% shield penetration</unit-aid>.<br /><br />When this Unit destroys an enemy, it gains <unit-skill>XAOC Swiftness II</unit-skill> for 3 turns.',
        expects: 'buff|self|on-enemy-destroyed|XAOC Swiftness II',
    },
    {
        ship: 'Obsidian',
        slot: 'passive',
        old: 'This Unit <unit-aid>adds 2 charges</unit-aid> to its Charged Skill upon killing an enemy.',
        new: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Obsidian',
        slot: 'passive',
        old: 'This Unit <unit-aid>adds 2 charges</unit-aid> to its Charged Skill upon killing an enemy.<br />At the start of each round, it gains <unit-skill>Attack Up III</unit-skill> for 1 turn.',
        new: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.<br /><br />At the start of each round, this Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Valiant',
        slot: 'passive',
        old: 'This Unit <unit-aid>gains 1 charge</unit-aid> for its Charged Skill upon killing an enemy.',
        new: 'When this Unit destroys an enemy it <unit-skill>adds 1 charge</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Valiant',
        slot: 'passive',
        old: 'This Unit <unit-aid>gains 2 charges</unit-aid> for its Charged Skill upon killing an enemy.',
        new: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Liberator',
        slot: 'passive',
        old: 'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills.',
        new: 'This Unit has <unit-damage>40% shield penetration</unit-damage>.<br /><br />When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills.',
        expects: 'charge|all-allies|on-enemy-destroyed|charge',
    },
    {
        ship: 'Liberator',
        slot: 'passive',
        old: 'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.',
        new: 'This Unit has <unit-damage>40% shield penetration</unit-damage>.<br /><br />When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills and once per round, this unit <unit-skill>gains 1 extra action</unit-skill>.',
        expects: 'charge|all-allies|on-enemy-destroyed|charge',
    },
    {
        ship: 'Butcher',
        slot: 'passive',
        old: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and loses <unit-skill>Overload</unit-skill> upon killing an enemy.',
        new: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Butcher',
        slot: 'passive',
        old: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn. On kill, <unit-skill>Overload</unit-skill> is lost. On inflicting a debuff, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.',
        new: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>.<br /><br />On inflicting a <unit-aid>debuff</unit-aid>, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Asphyxiator',
        slot: 'passive',
        old: 'At the start of the round, if there are any enemies with 3 or more debuffs, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>.',
        new: 'At the start of the round, if there are any enemies with 3 or more <unit-aid>debuffs</unit-aid>, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Ruiner',
        slot: 'passive',
        old: 'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.<br /><br />This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy performs a <unit-aid>repair</unit-aid>, upon killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
        new: 'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.<br /><br />This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy preforms a <unit-aid>repair</unit-aid>, upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Ravager',
        slot: 'passive',
        old: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon killing an enemy, loses <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.',
        new: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Rikra',
        slot: 'passive',
        old: 'This Unit <unit-damage>repairs 30%</unit-damage> of its Max HP for each enemy Unit destroyed by the attack upon killing them.',
        new: 'This Unit <unit-damage>repairs 30%</unit-damage> of its max HP for each enemy destroyed by this Unit.',
        expects: 'heal|self|on-enemy-destroyed|heal',
    },
    {
        ship: 'Rikra',
        slot: 'passive',
        old: 'This Unit <unit-damage>repairs 60%</unit-damage> of its Max HP for each enemy Unit destroyed by the attack upon killing them.',
        new: 'This Unit <unit-damage>repairs 60%</unit-damage> of its max HP for each enemy destroyed by this Unit.',
        expects: 'heal|self|on-enemy-destroyed|heal',
    },
    {
        ship: 'Faust',
        slot: 'passive',
        old: 'This Unit <unit-aid>purges 2</unit-aid> buffs from the enemy when killed by direct Damage.',
        new: 'This Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy when destroyed by direct damage.',
        expects: 'purge|enemy|on-destroyed|purge',
    },
    {
        ship: 'Faust',
        slot: 'passive',
        old: 'This Unit <unit-aid>purges 3</unit-aid> buffs from the enemy when killed by direct Damage.',
        new: 'This Unit <unit-skill>purges 3 buffs</unit-skill> from the enemy when destroyed by direct damage.',
        expects: 'purge|enemy|on-destroyed|purge',
    },
    {
        ship: 'Paracelsus',
        slot: 'passive',
        old: 'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP.',
        new: 'Upon being destroyed by direct damage, this Unit deals <unit-damage>damage equal to 50%</unit-damage> of its max HP.',
        expects: 'damage|enemy|on-destroyed|damage',
    },
    {
        ship: 'Paracelsus',
        slot: 'passive',
        old: 'Upon being killed by direct Damage, this Unit deals <unit-damage>Damage equal to 50%</unit-damage> of its max HP and grants allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.',
        new: 'Upon being destroyed by direct damage, this Unit deals <unit-damage>damage equal to 50%</unit-damage> of its max HP and grants all allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.',
        expects: 'damage|enemy|on-destroyed|damage',
    },
    {
        ship: 'Meiying',
        slot: 'passive',
        old: 'Upon killing an enemy with a Debuff, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.',
        new: "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.",
        expects: 'debuff|adjacent-enemies|on-enemy-destroyed|Stasis',
    },
    {
        ship: 'Meiying',
        slot: 'passive',
        old: 'Upon killing an enemy with a Debuff, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.<br /><br />At the start of combat and every turn, this Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.',
        new: "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.<br /><br />At the start of combat and every turn, this Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.",
        expects: 'debuff|adjacent-enemies|on-enemy-destroyed|Stasis',
    },
];

describe('kill/destroy vocabulary — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });
});

// User ruling (2026-10-01): Sokol's once-per-round extra action fires on ANY enemy death, not only
// Sokol's own kill. `on-enemy-destroyed` is that trigger — its listener (triggers.ts) enqueues on every
// opposing ship-destroyed event with no killer gate.
describe('kill/destroy vocabulary — ruled rows', () => {
    it('Sokol passive R2: "When an enemy is destroyed" grants the extra action on any enemy death', () => {
        const text =
            'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn.<br /><br />When an enemy is destroyed, once per round, this Unit <unit-skill>gains 1 extra action</unit-skill>.';
        const abilities = parseSlot('passive', text);
        const s = sigs(abilities);
        expect(s).toContain('extra-action|self|on-enemy-destroyed|extra-action');
        expect(s).not.toContain('extra-action|self|on-cast|extra-action');
        expect(abilities.find((a) => a.type === 'extra-action')?.config).toEqual({
            type: 'extra-action',
            oncePerRound: true,
            endOfRound: false,
        });
        // The every-turn Blast stack in the same row keeps accruing per round, not per kill.
        expect(s).toContain('buff|self|on-cast|Blast');
        expect(abilities.find((a) => a.type === 'buff')?.config).toMatchObject({
            buffName: 'Blast',
            stackTrigger: 'per-round',
        });
    });
});

// User ruling C (2026-10-02): Sokol's extra action is inserted into the turn queue as a full
// action at his CURRENT speed, exactly like Liberator's — not an end-of-round action. Our text
// says "one extra end of round action upon a kill"; it parses like the catalogue's.
describe("kill/destroy vocabulary — Sokol's extra action is queued at his speed", () => {
    const OLD =
        'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn and grants one extra end of round action upon a kill, once per round.';
    const NEW =
        'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn.<br /><br />When an enemy is destroyed, once per round, this Unit <unit-skill>gains 1 extra action</unit-skill>.';
    const LIBERATOR_R2 =
        'This Unit has 40% Shield Penetration. When an enemy dies, all allies <unit-aid>add 1 charge</unit-aid> to their Charged Skills, and once per round, this unit gains 1 extra action.';
    const extraAction = (text: string) =>
        parseSlot('passive', text).find((a) => a.type === 'extra-action')!;

    it('Sokol passive R2, our text: a once-per-round extra action on an enemy death, at speed', () => {
        expect(extraAction(OLD)).toMatchObject({
            target: 'self',
            trigger: 'on-enemy-destroyed',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: true, endOfRound: false },
        });
    });

    it("Sokol passive R2: both texts give the same extra action as Liberator's", () => {
        expect(extraAction(LIBERATOR_R2).config).toEqual(extraAction(OLD).config);
        expect(canonical(parseSlot('passive', NEW))).toEqual(canonical(parseSlot('passive', OLD)));
    });

    it('Harvester keeps its end-of-round action (an ally death, not a kill)', () => {
        const harvester = extraAction(
            'When an allied Unit is destroyed, this Unit gains 1 extra end of round action.'
        );
        expect(harvester.trigger).toBe('on-ally-destroyed');
        expect(harvester.config).toMatchObject({ endOfRound: true });
    });
});
