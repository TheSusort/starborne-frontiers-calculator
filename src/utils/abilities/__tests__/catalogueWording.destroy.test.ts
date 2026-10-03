import { describe, it, expect } from 'vitest';
import { parseSlot, sigs, type SlotName } from './helpers/catalogueWording';

// Each row's catalogue sentence is the only wording the parser reads: the parse must carry
// `expects`.
const ROWS: { ship: string; slot: SlotName; text: string; expects: string }[] = [
    {
        ship: 'Gallant',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline I</unit-skill> for 3 turns.',
        expects: 'buff|self|on-enemy-destroyed|Legion Discipline I',
    },
    {
        ship: 'Gallant',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it gains <unit-skill>Legion Discipline II</unit-skill> for 4 turns.',
        expects: 'buff|self|on-enemy-destroyed|Legion Discipline II',
    },
    {
        ship: 'Mangler',
        slot: 'passive',
        text: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>. Additionally, it gains <unit-skill>Marauder Rage I</unit-skill> for 2 turns upon destroying an enemy.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Mangler',
        slot: 'passive',
        text: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>. Additionally, it gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns upon destroying an enemy.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Medved',
        slot: 'passive',
        text: 'This Unit has <unit-aid>20% shield penetration</unit-aid>.<br /><br />When this Unit destroys an enemy, it gains <unit-skill>XAOC Swiftness I</unit-skill> for 2 turns.',
        expects: 'buff|self|on-enemy-destroyed|XAOC Swiftness I',
    },
    {
        ship: 'Medved',
        slot: 'passive',
        text: 'This Unit has <unit-aid>20% shield penetration</unit-aid>.<br /><br />When this Unit destroys an enemy, it gains <unit-skill>XAOC Swiftness II</unit-skill> for 3 turns.',
        expects: 'buff|self|on-enemy-destroyed|XAOC Swiftness II',
    },
    {
        ship: 'Obsidian',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Obsidian',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.<br /><br />At the start of each round, this Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Valiant',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it <unit-skill>adds 1 charge</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Valiant',
        slot: 'passive',
        text: 'When this Unit destroys an enemy it <unit-skill>adds 2 charges</unit-skill> to its charged skill.',
        expects: 'charge|self|on-enemy-destroyed|charge',
    },
    {
        ship: 'Liberator',
        slot: 'passive',
        text: 'This Unit has <unit-damage>40% shield penetration</unit-damage>.<br /><br />When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills.',
        expects: 'charge|all-allies|on-enemy-destroyed|charge',
    },
    {
        ship: 'Liberator',
        slot: 'passive',
        text: 'This Unit has <unit-damage>40% shield penetration</unit-damage>.<br /><br />When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills and once per round, this unit <unit-skill>gains 1 extra action</unit-skill>.',
        expects: 'charge|all-allies|on-enemy-destroyed|charge',
    },
    {
        ship: 'Butcher',
        slot: 'passive',
        text: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Butcher',
        slot: 'passive',
        text: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill>.<br /><br />On inflicting a <unit-aid>debuff</unit-aid>, this Unit gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Asphyxiator',
        slot: 'passive',
        text: 'At the start of the round, if there are any enemies with 3 or more <unit-aid>debuffs</unit-aid>, this Unit gains 1 stack of <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage II</unit-skill> for 3 turns. Upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Ruiner',
        slot: 'passive',
        text: 'This Unit inflicts <unit-skill>Bomb II</unit-skill> for 2 turns on any enemy performing a <unit-aid>repair</unit-aid>, once per round per enemy.<br /><br />This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy preforms a <unit-aid>repair</unit-aid>, upon destroying an enemy, this Unit removes <unit-skill>Overload</unit-skill>.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Ravager',
        slot: 'passive',
        text: 'This Unit gains 1 stack of <unit-skill>Overload</unit-skill> every turn and, upon destroying an enemy, removes <unit-skill>Overload</unit-skill> and gains <unit-skill>Marauder Rage III</unit-skill> for 3 turns.',
        expects: 'remove-self-buff|self|on-enemy-destroyed|Overload',
    },
    {
        ship: 'Rikra',
        slot: 'passive',
        text: 'This Unit <unit-damage>repairs 30%</unit-damage> of its max HP for each enemy destroyed by this Unit.',
        expects: 'heal|self|on-enemy-destroyed|heal',
    },
    {
        ship: 'Rikra',
        slot: 'passive',
        text: 'This Unit <unit-damage>repairs 60%</unit-damage> of its max HP for each enemy destroyed by this Unit.',
        expects: 'heal|self|on-enemy-destroyed|heal',
    },
    {
        ship: 'Faust',
        slot: 'passive',
        text: 'This Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy when destroyed by direct damage.',
        expects: 'purge|enemy|on-destroyed|purge',
    },
    {
        ship: 'Faust',
        slot: 'passive',
        text: 'This Unit <unit-skill>purges 3 buffs</unit-skill> from the enemy when destroyed by direct damage.',
        expects: 'purge|enemy|on-destroyed|purge',
    },
    {
        ship: 'Paracelsus',
        slot: 'passive',
        text: 'Upon being destroyed by direct damage, this Unit deals <unit-damage>damage equal to 50%</unit-damage> of its max HP.',
        expects: 'damage|enemy|on-destroyed|damage',
    },
    {
        ship: 'Paracelsus',
        slot: 'passive',
        text: 'Upon being destroyed by direct damage, this Unit deals <unit-damage>damage equal to 50%</unit-damage> of its max HP and grants all allies <unit-skill>Everliving Regeneration II</unit-skill> for 4 turns.',
        expects: 'damage|enemy|on-destroyed|damage',
    },
    {
        ship: 'Meiying',
        slot: 'passive',
        text: "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.",
        expects: 'debuff|adjacent-enemies|on-enemy-destroyed|Stasis',
    },
    {
        ship: 'Meiying',
        slot: 'passive',
        text: "This Unit's attacks ignore <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects.<br /><br />Upon destroying an enemy with a <unit-aid>debuff</unit-aid>, this Unit inflicts <unit-skill>Stasis</unit-skill> on all adjacent enemies for 1 turn.<br /><br />At the start of combat and every turn, this Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.",
        expects: 'debuff|adjacent-enemies|on-enemy-destroyed|Stasis',
    },
];

describe('kill/destroy vocabulary — the catalogue sentence carries its parse', () => {
    it.each(ROWS)('$ship $slot', ({ slot, text, expects }) => {
        expect(sigs(parseSlot(slot, text))).toContain(expects);
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

// User ruling (2026-10-02): the WORDING decides an extra action's queue slot, not its trigger. A
// plain "extra action" is inserted into the turn queue at the ship's current speed (Liberator's
// model); an "extra end of round action" is a full turn appended to the end of the round.
describe("kill/destroy vocabulary — the wording decides the extra action's queue slot", () => {
    const NEW =
        'This Unit gains 1 stack of <unit-skill>Blast</unit-skill> every turn.<br /><br />When an enemy is destroyed, once per round, this Unit <unit-skill>gains 1 extra action</unit-skill>.';
    const LIBERATOR_R2 =
        'This Unit has <unit-damage>40% shield penetration</unit-damage>.<br /><br />When an enemy is destroyed, all allies <unit-skill>add 1 charge</unit-skill> to their charged skills and once per round, this unit <unit-skill>gains 1 extra action</unit-skill>.';
    const extraAction = (text: string) =>
        parseSlot('passive', text).find((a) => a.type === 'extra-action')!;

    it('Sokol passive R2, catalogue text: "1 extra action" is queued at speed, like Liberator\'s', () => {
        expect(extraAction(NEW)).toMatchObject({
            target: 'self',
            trigger: 'on-enemy-destroyed',
            conditions: [],
            config: { type: 'extra-action', oncePerRound: true, endOfRound: false },
        });
        expect(extraAction(LIBERATOR_R2).config).toEqual(extraAction(NEW).config);
    });

    it('Harvester keeps its end-of-round action (an ally death, not a kill)', () => {
        const harvester = extraAction(
            'When an ally is destroyed, this Unit <unit-skill>gains 1 extra end of round action</unit-skill>.'
        );
        expect(harvester.trigger).toBe('on-ally-destroyed');
        expect(harvester.config).toMatchObject({ endOfRound: true });
    });
});
