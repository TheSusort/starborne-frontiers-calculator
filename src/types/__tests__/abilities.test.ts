import { describe, it, expect } from 'vitest';
import { SELENITE, LODOLITE, LIONHEART } from '../../utils/abilities/abilityFixtures';

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

    it('Lionheart is an unconditional all-allies HP modifier', () => {
        const mod = LIONHEART.slots[0].abilities[0];
        expect(mod.target).toBe('all-allies');
        expect(mod.config).toEqual({
            type: 'modifier',
            channel: 'hp',
            value: 10,
            isMultiplicative: true,
        });
    });
});
