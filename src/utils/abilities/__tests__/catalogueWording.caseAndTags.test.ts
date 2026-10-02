import { describe, it, expect } from 'vitest';
import { parseSlot, sigs, canonical, type RewordPair } from './helpers/catalogueWording';

const PAIRS: RewordPair[] = [
    {
        ship: 'Lev',
        slot: 'active',
        old: 'This Unit <unit-aid>cleanses 1</unit-aid> debuff and deals <unit-damage>180% damage</unit-damage> with an additional <unit-damage>15%</unit-damage> for each debuff on the enemy.',
        new: 'This Unit <unit-skill>cleanses 1 debuff</unit-skill> and deals <unit-damage>180% damage</unit-damage> with an additional <unit-damage>15%</unit-damage> for each <unit-aid>debuff</unit-aid> on the enemy.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 15,
    },
    {
        ship: 'Vindicator',
        slot: 'passive',
        old: "This Unit has 20% Shield Penetration. At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a debuff infliction from an enemy, it deals <unit-damage>damage equal to 30%</unit-damage> of this Unit's max HP to that enemy.",
        new: "This Unit has <unit-damage>20% shield penetration</unit-damage>.<br /><br />At the start of combat, this Unit gains <unit-skill>Magnetized Shielding</unit-skill>.<br /><br />When this Unit resists a <unit-aid>debuff</unit-aid> infliction from an enemy, it deals damage equal to <unit-damage>30%</unit-damage> of this Unit's max HP to that enemy.",
        expects: 'damage|enemy|on-debuff-resisted|damage',
    },
    {
        ship: 'Anemone',
        slot: 'passive',
        old: "This Unit takes 25% less direct damage from enemies debuffed with a Damage over Time effect.<br /><br />When an enemy takes damage from a Damage over Time effect, <unit-damage>repair 5%</unit-damage> of this Unit's Max HP.",
        new: 'This Unit takes <unit-damage>25% less direct damage</unit-damage> from enemies debuffed with a <unit-skill>damage over time effect</unit-skill>.<br /><br />When an enemy takes damage from a <unit-skill>damage over time effect</unit-skill>, this Unit <unit-damage>repairs 5%</unit-damage> of its max HP.',
        expects: 'heal|self|on-enemy-dot-damage|heal',
    },
    {
        ship: 'Butcher',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>150% damage</unit-damage>, with an additional <unit-damage>35%</unit-damage> for each buff on the enemy, inflicts <unit-skill>Inferno III</unit-skill> for 3 turns, and inflicts <unit-skill>Block Buff</unit-skill> for 1 turn.',
        new: 'This Unit deals <unit-damage>150% damage</unit-damage> with an additional <unit-damage>35%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy, inflicts <unit-skill>Inferno III</unit-skill> for 3 turns, and inflicts <unit-skill>Block Buff</unit-skill> for 1 turn.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 35,
    },
    {
        ship: 'Nuqtu',
        slot: 'active',
        old: 'This Unit Deals <unit-damage>140% damage</unit-damage>, with additional damage equal to <unit-damage>80%</unit-damage> of its Defense plus an extra 30% for each buff on the enemy. If the target has 3 or more buffs, the Unit <unit-aid>gains 2 charges</unit-aid> to its Charged Skill.',
        new: 'This Unit Deals <unit-damage>140% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its defense and an additional <unit-damage>30%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy. If the target has 3 or more <unit-aid>buffs</unit-aid>, this Unit <unit-skill>adds 2 charges</unit-skill> to its charged skill.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 30,
    },
    {
        ship: 'Nuqtu',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>200% damage</unit-damage>, including additional Damage equal to <unit-damage>80%</unit-damage> of its Defense, and an extra 40% for each buff on the enemy. If the target has 3 or more buffs, this Unit grants itself 1 extra End Of Round Action.',
        new: 'This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its defense and an additional <unit-damage>40%</unit-damage> for each <unit-aid>buff</unit-aid> on the enemy. If the target has 3 or more <unit-aid>buffs</unit-aid>, this Unit <unit-skill>gains 1 extra end of round action</unit-skill>.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 40,
    },
    {
        ship: 'Ravager',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>190% damage</unit-damage>, increasing by <unit-damage>25%</unit-damage> for each debuff on the enemy, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
        new: 'This Unit deals <unit-damage>190% damage</unit-damage> with an additional <unit-damage>25%</unit-damage> damage for each <unit-aid>debuff</unit-aid> on the enemy, and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 25,
    },
    {
        ship: 'Sustainer',
        slot: 'active',
        old: 'This Unit <unit-aid>Cleanses 2</unit-aid> debuffs from itself and Deals <unit-damage>145% damage</unit-damage>, increasing by an additional <unit-damage>25%</unit-damage> for each buff on this Unit.',
        new: 'This Unit <unit-skill>cleanses 2 debuffs</unit-skill>, deals <unit-damage>145% damage</unit-damage> with an additional <unit-damage>25%</unit-damage> for each <unit-aid>buff</unit-aid> on itself.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 25,
    },
    {
        ship: 'Sustainer',
        slot: 'charged',
        old: 'This Unit deals <unit-damage>205% damage</unit-damage> with an additional <unit-damage>30%</unit-damage> for each buff on it. If this Unit has no debuffs, it gains one extra action.',
        new: 'This Unit deals <unit-damage>205% damage</unit-damage> with an additional <unit-damage>30%</unit-damage> for each <unit-aid>buff</unit-aid> on itself. If this Unit has no <unit-aid>debuffs</unit-aid>, it <unit-skill>gains one extra action</unit-skill>.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 30,
    },
    {
        ship: 'Valiant',
        slot: 'charged',
        old: 'This Unit gains <unit-skill>Legion Discipline II</unit-skill> for 2 turns and deals <unit-damage>145% Damage</unit-damage>, increased by <unit-damage>22.5%</unit-damage> for each buff on itself.',
        new: 'This Unit gains <unit-skill>Legion Discipline II</unit-skill> for 2 turns and deals <unit-damage>145% damage</unit-damage> with an additional <unit-damage>22.5%</unit-damage> for each <unit-aid>buff</unit-aid> on itself.',
        expects: 'damage|enemy|on-cast|damage',
        scalingPerUnit: 22.5,
    },
];

describe('case and tag scheme — catalogue wording parses like ours', () => {
    it.each(PAIRS)('$ship $slot', ({ slot, old, new: next, expects, scalingPerUnit }) => {
        const before = parseSlot(slot, old);
        expect(sigs(before)).toContain(expects); // the reference parse is not vacuous
        if (scalingPerUnit !== undefined) {
            const scaled = before.filter((a) => a.type === 'damage' && a.scaling);
            expect(scaled.map((a) => a.scaling?.perUnit)).toEqual([scalingPerUnit]);
        }
        expect(canonical(parseSlot(slot, next))).toEqual(canonical(before));
    });
});
