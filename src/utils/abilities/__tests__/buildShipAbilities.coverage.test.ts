import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, AbilityType, AbilityTarget, AbilityTrigger } from '../../../types/abilities';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

// Valid enum values for assertions
const VALID_TYPES: AbilityType[] = [
    'damage',
    'additional-damage',
    'modifier',
    'buff',
    'debuff',
    'dot',
    'charge',
    'heal',
    'shield',
    'cleanse',
    'purge',
    'control',
];

const VALID_TARGETS: AbilityTarget[] = ['self', 'ally', 'all-allies', 'enemy', 'all-enemies'];

const VALID_TRIGGERS: AbilityTrigger[] = [
    'on-cast',
    'start-of-round',
    'on-crit',
    'on-attacked',
    'on-ally-destroyed',
    'on-destroyed',
];

/**
 * Helper to validate an ability against the structural invariants.
 * Ensures it has required fields, valid enum values, and the discriminant invariant.
 */
function validateAbility(ability: Ability): void {
    // Must have a non-empty id
    expect(ability.id).toBeDefined();
    expect(typeof ability.id).toBe('string');
    expect(ability.id.length).toBeGreaterThan(0);

    // Must have a valid type
    expect(ability.type).toBeDefined();
    expect(VALID_TYPES).toContain(ability.type);

    // Must have a valid target
    expect(ability.target).toBeDefined();
    expect(VALID_TARGETS).toContain(ability.target);

    // Must have a valid trigger
    expect(ability.trigger).toBeDefined();
    expect(VALID_TRIGGERS).toContain(ability.trigger);

    // config must exist and be an object
    expect(ability.config).toBeDefined();
    expect(typeof ability.config).toBe('object');

    // CRUCIAL: The discriminant invariant — ability.config.type must match ability.type
    expect(ability.config.type).toBe(ability.type);

    // conditions should be an array (can be empty)
    expect(Array.isArray(ability.conditions)).toBe(true);
}

describe('buildShipAbilities.coverage', () => {
    it('Enforcer active: multi-hit damage (3 hits @ 50% each)', () => {
        const s = ship({
            activeSkillText:
                'This Unit attacks three times with each attack dealing <unit-damage>50% damage</unit-damage>.',
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Panguan active: conditional scaling + DoT + modifier passive', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>145% damage</unit-damage>, increasing by <unit-damage>30%</unit-damage> for each Unit adjacent to the enemy, and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
            secondPassiveSkillText:
                'Friendly <unit-aid>Stealthed</unit-aid> units deal 40% more direct damage.<br /><br />This Unit Gains <unit-skill>Stealth</unit-skill> for 2 turns when directly damaged.',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            refits: [{}, {}] as any, // Only 2 refits to trigger Passive R2
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Selenite active: damage + additional-damage(hp) + charge(Stealth condition)', () => {
        const s = ship({
            activeSkillText:
                "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Lodolite active: damage + additional-damage(hp) + modifier (Concentrate Fire)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>240% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of its max HP. When targeting non-Defenders, apply <unit-skill>Concentrate Fire</unit-skill> for 2 turns.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.',
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Rhodium active: damage with conditional scaling (per buff on enemy) + charge', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>140% damage</unit-damage> with an additional <unit-damage>25%</unit-damage> for each buff on the enemy. Unit adds charges to the <unit-aid>Charged Skill</unit-aid> equal to the number of <unit-aid>Buffs</unit-aid> on the target.',
            chargeSkillCharge: 6,
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Incinerator active: damage + DoT (Inferno III)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>185% damage</unit-damage> and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Belladonna active: damage + DoT (Corrosion I)', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>140% damage</unit-damage> and inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns.',
            chargeSkillCharge: 3,
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });

    it('Chakara active: damage + additional-damage(defense) + charge with derivable condition', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.',
            chargeSkillCharge: 2,
        });

        const { slots } = buildShipAbilities(s);
        expect(slots.length).toBeGreaterThanOrEqual(1);

        for (const skill of slots) {
            expect(skill.abilities.length).toBeGreaterThanOrEqual(1);
            for (const ability of skill.abilities) {
                validateAbility(ability);
            }
        }
    });
});
