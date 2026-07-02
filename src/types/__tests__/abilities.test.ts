import { describe, it, expect } from 'vitest';
import { Ability } from '../abilities';
import { SELENITE, LODOLITE, LIONHEART } from '../../utils/abilities/abilityFixtures';
import { buildShipAbilities } from '../../utils/abilities/buildShipAbilities';
import { Ship } from '../ship';

describe('ability model shape', () => {
    it('Selenite has a conditional self charge ability gated on enemy Stealth', () => {
        const active = SELENITE.slots.find((s) => s.slot === 'active')!;
        const charge = active.abilities.find((a) => a.type === 'charge')!;
        expect(charge.target).toBe('self');
        expect(charge.conditions[0].buffName).toBe('Stealth');
        expect(charge.config).toEqual({ type: 'charge', amount: 1 });
    });

    it('Lodolite damage scales by an OR-group with a cap', () => {
        const dmg = LODOLITE.slots[0].abilities[0];
        expect(dmg.conditions.every((c) => c.anyOf)).toBe(true);
        expect(dmg.scaling).toEqual({ conditionIndex: 0, perUnit: 10, cap: 30 });
    });

    it('Lionheart fixture equals the parser output for the real passive text (PR F4)', () => {
        const ship = {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            refits: [],
            firstPassiveSkillText:
                'At the start of combat, this Unit grants all adjacent allies 10% of its HP.',
        } as Ship;
        const passive = buildShipAbilities(ship).slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        // Generated ids differ per run — compare everything else.
        const stripIds = (abilities: Ability[]) => abilities.map(({ id: _id, ...rest }) => rest);
        expect(stripIds(passive!.abilities)).toEqual(stripIds(LIONHEART.slots[0].abilities));
    });

    it('buff ability wraps a game-buff payload', () => {
        const buffAbility: Ability = {
            id: 'b',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Attack Up II',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
            },
        };
        expect(buffAbility.config).toMatchObject({
            type: 'buff',
            buffName: 'Attack Up II',
            stacks: 1,
        });
    });

    it('debuff ability carries application + game-buff payload', () => {
        const debuffAbility: Ability = {
            id: 'd',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Defense Down II',
                parsedEffects: { defense: -30 },
                stacks: 1,
                isStackable: false,
                application: 'inflict',
            },
        };
        expect(debuffAbility.config).toMatchObject({
            type: 'debuff',
            application: 'inflict',
            buffName: 'Defense Down II',
        });
    });
});
