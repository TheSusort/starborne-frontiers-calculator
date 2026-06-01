import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, Skill } from '../../../types/abilities';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

function abilityOfType(abilities: Ability[], type: string): Ability | undefined {
    return abilities.find((a) => a.type === type);
}

describe('buildShipAbilities', () => {
    it('Selenite active: damage + additional-damage(hp) + charge(enemy-buff/Stealth)', () => {
        const s = ship({
            activeSkillText:
                "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
            chargeSkillCharge: 4,
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dmg = abilityOfType(active!.abilities, 'damage');
        expect(dmg).toMatchObject({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 200 },
            autoFilled: true,
        });

        const add = abilityOfType(active!.abilities, 'additional-damage');
        expect(add).toMatchObject({
            type: 'additional-damage',
            target: 'enemy',
            config: { type: 'additional-damage', stat: 'hp', pct: 10 },
            autoFilled: true,
        });

        const charge = abilityOfType(active!.abilities, 'charge');
        expect(charge).toMatchObject({
            type: 'charge',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'charge', amount: 1 },
            autoFilled: true,
        });
        expect(charge!.conditions[0]).toMatchObject({
            subject: 'enemy-buff',
            derivable: false,
            buffName: 'Stealth',
        });
    });

    it('Chakara active: damage(180) + additional-damage(defense, 80) + charge', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.',
            chargeSkillCharge: 2,
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        expect(abilityOfType(active!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 180 },
        });
        expect(abilityOfType(active!.abilities, 'additional-damage')).toMatchObject({
            config: { type: 'additional-damage', stat: 'defense', pct: 80 },
        });

        const charge = abilityOfType(active!.abilities, 'charge');
        expect(charge).toBeDefined();
        expect(charge!.config).toMatchObject({ type: 'charge', amount: 1 });
        // Speed condition is classified 'always'/derivable by parseChargeGain.
        expect(charge!.conditions[0]).toMatchObject({ subject: 'always', derivable: true });
    });

    it('Panguan active: damage(145) with conditional scaling (perUnit 30) attached to base', () => {
        const s = ship({
            activeSkillText:
                'This Unit deals <unit-damage>145% damage</unit-damage>, increasing by <unit-damage>30%</unit-damage> for each Unit adjacent to the enemy, and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
        });

        const { slots } = buildShipAbilities(s);
        const active = slot(slots, 'active');
        expect(active).toBeDefined();

        const dmg = abilityOfType(active!.abilities, 'damage');
        expect(dmg).toMatchObject({ config: { type: 'damage', multiplier: 145 } });
        expect(dmg!.scaling).toMatchObject({ conditionIndex: 0, perUnit: 30 });
        expect(dmg!.scaling!.cap).toBeUndefined();
        expect(dmg!.conditions).toHaveLength(1);
        expect(dmg!.conditions[0]).toMatchObject({ subject: 'enemy-adjacent', derivable: false });

        // No dot ability emitted in this task.
        expect(abilityOfType(active!.abilities, 'dot')).toBeUndefined();
    });

    it('charged slot: damage ability with multiplier 300', () => {
        const s = ship({
            activeSkillText: 'deals <unit-damage>100% damage</unit-damage>',
            chargeSkillText: 'deals <unit-damage>300% damage</unit-damage>',
            chargeSkillCharge: 3,
        });

        const { slots } = buildShipAbilities(s);
        const charged = slot(slots, 'charged');
        expect(charged).toBeDefined();
        expect(abilityOfType(charged!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 300 },
        });

        const active = slot(slots, 'active');
        expect(abilityOfType(active!.abilities, 'damage')).toMatchObject({
            config: { type: 'damage', multiplier: 100 },
        });
    });
});
