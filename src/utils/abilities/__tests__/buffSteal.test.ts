import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';

// PR10: buff steal. RAW skill text verbatim from docs/ship-skills.csv (Pallas/Thresh/Tithonus
// charged skills) — confirmed via `grep -iE "^(Pallas|Thresh|Tithonus)," docs/ship-skills.csv`
// (2026-07-04).

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilitiesOfType(abilities: Ability[], type: string): Ability[] {
    return abilities.filter((a) => a.type === type);
}

describe('buildShipAbilities — buff steal (PR10)', () => {
    it('Pallas charged: buff-steal(count:1) + damage(260) — steal does not cannibalize the damage ability', () => {
        const s = ship({
            chargeSkillText:
                'This Unit steals 1 buff from the primary target, then deals <unit-damage>260% damage</unit-damage>.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged');
        expect(charged).toBeDefined();

        const steal = abilitiesOfType(charged!.abilities, 'buff-steal');
        expect(steal).toHaveLength(1);
        expect(steal[0]).toMatchObject({
            type: 'buff-steal',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'buff-steal', count: 1 },
        });
        expect(steal[0].config).not.toHaveProperty('grantAdjacentAllies', true);

        const dmg = abilitiesOfType(charged!.abilities, 'damage');
        expect(dmg).toHaveLength(1);
        expect(dmg[0]).toMatchObject({ config: { type: 'damage', multiplier: 260 } });
    });

    it('Thresh charged: buff-steal(count:1) + damage(300) — independent of the trailing Defender-gated buff sentence', () => {
        const s = ship({
            chargeSkillText:
                'This Unit steals 1 buff from the primary target and deals <unit-damage>300% damage</unit-damage>. When targeting a Defender, this Unit gains <unit-skill>Crit Power Up II</unit-skill> for 1 turn.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged');
        expect(charged).toBeDefined();

        const steal = abilitiesOfType(charged!.abilities, 'buff-steal');
        expect(steal).toHaveLength(1);
        expect(steal[0]).toMatchObject({
            type: 'buff-steal',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'buff-steal', count: 1 },
        });

        const dmg = abilitiesOfType(charged!.abilities, 'damage');
        expect(dmg).toHaveLength(1);
        expect(dmg[0]).toMatchObject({ config: { type: 'damage', multiplier: 300 } });

        // The Defender-gated Crit Power Up II buff still parses (steal doesn't cannibalize it).
        const buffs = abilitiesOfType(charged!.abilities, 'buff');
        expect(
            buffs.some((b) => (b.config as { buffName?: string }).buffName === 'Crit Power Up II')
        ).toBe(true);
    });

    it('Tithonus charged: buff-steal(count:1, grantAdjacentAllies:true) + purge(count:2) + damage(190) — no cannibalization either way', () => {
        const s = ship({
            chargeSkillText:
                'This Unit <unit-aid>steals 1 buff</unit-aid> from the primary target, granting it to self and all adjacent allies, then <unit-aid>purges 2 buffs</unit-aid> from the enemy and deals <unit-damage>190% damage</unit-damage>.',
        });
        const charged = slot(buildShipAbilities(s).slots, 'charged');
        expect(charged).toBeDefined();

        const steal = abilitiesOfType(charged!.abilities, 'buff-steal');
        expect(steal).toHaveLength(1);
        expect(steal[0]).toMatchObject({
            type: 'buff-steal',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'buff-steal', count: 1, grantAdjacentAllies: true },
        });

        const purge = abilitiesOfType(charged!.abilities, 'purge');
        expect(purge).toHaveLength(1);
        expect(purge[0]).toMatchObject({
            type: 'purge',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'purge', count: 2 },
        });

        const dmg = abilitiesOfType(charged!.abilities, 'damage');
        expect(dmg).toHaveLength(1);
        expect(dmg[0]).toMatchObject({ config: { type: 'damage', multiplier: 190 } });
    });

    it('does NOT emit buff-steal from a PASSIVE slot (steal is on-cast/active-charged only, mirrors purge)', () => {
        const s = ship({
            firstPassiveSkillText:
                'This Unit steals 1 buff from the primary target, then deals <unit-damage>260% damage</unit-damage>.',
        });
        const passive = slot(buildShipAbilities(s).slots, 'passive');
        const steal = abilitiesOfType(passive?.abilities ?? [], 'buff-steal');
        expect(steal).toHaveLength(0);
    });

    it("does NOT emit buff-steal for Meatshield's named-buff-count steal (no 'N buff(s)' token)", () => {
        const s = ship({
            firstPassiveSkillText:
                'This Unit <unit-damage>repairs 1.5%</unit-damage> of its max HP for each <unit-aid>debuff</unit-aid> on itself.<br /><br />If this Unit has less than 3 stacks of <unit-skill>Protection</unit-skill>, it steals <unit-skill>Protection</unit-skill> until this Unit has 3 stacks of <unit-skill>Protection</unit-skill>.',
        });
        const { slots } = buildShipAbilities(s);
        const allAbilities = slots.flatMap((sk) => sk.abilities);
        expect(abilitiesOfType(allAbilities, 'buff-steal')).toHaveLength(0);
    });
});
