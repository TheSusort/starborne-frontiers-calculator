import { describe, it, expect } from 'vitest';
import { makeDefaultAbility } from '../abilityDefaults';
import { AbilityType } from '../../../types/abilities';

const ALL_TYPES: AbilityType[] = [
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

describe('makeDefaultAbility', () => {
    it('produces a config whose type matches the requested type', () => {
        for (const type of ALL_TYPES) {
            const ability = makeDefaultAbility(type);
            expect(ability.type).toBe(type);
            expect(ability.config.type).toBe(type);
        }
    });

    it('includes isMultiplicative for the modifier config', () => {
        const ability = makeDefaultAbility('modifier');
        expect(ability.config).toMatchObject({
            type: 'modifier',
            channel: 'outgoingDamage',
            value: 10,
            isMultiplicative: true,
        });
    });

    it('sets sensible defaults per type', () => {
        expect(makeDefaultAbility('damage').config).toMatchObject({ multiplier: 100 });
        expect(makeDefaultAbility('additional-damage').config).toMatchObject({
            stat: 'hp',
            pct: 10,
        });
        expect(makeDefaultAbility('debuff').config).toMatchObject({ application: 'inflict' });
        expect(makeDefaultAbility('dot').config).toMatchObject({
            dotType: 'corrosion',
            tier: 3,
            stacks: 1,
            duration: 2,
        });
        expect(makeDefaultAbility('charge').config).toMatchObject({ amount: 1 });
        expect(makeDefaultAbility('heal').config).toMatchObject({ pct: 10, basis: 'hp' });
        expect(makeDefaultAbility('control').config).toMatchObject({ effect: 'provoke' });
    });

    it('targets enemies for offensive types and self for modifier/buff/charge', () => {
        expect(makeDefaultAbility('damage').target).toBe('enemy');
        expect(makeDefaultAbility('additional-damage').target).toBe('enemy');
        expect(makeDefaultAbility('debuff').target).toBe('enemy');
        expect(makeDefaultAbility('dot').target).toBe('enemy');
        expect(makeDefaultAbility('modifier').target).toBe('self');
        expect(makeDefaultAbility('buff').target).toBe('self');
        expect(makeDefaultAbility('charge').target).toBe('self');
    });

    it('defaults trigger to on-cast with no conditions', () => {
        const ability = makeDefaultAbility('damage');
        expect(ability.trigger).toBe('on-cast');
        expect(ability.conditions).toEqual([]);
    });

    it('honours a passed-in id and generates unique ids otherwise', () => {
        expect(makeDefaultAbility('damage', 'fixed-id').id).toBe('fixed-id');
        const a = makeDefaultAbility('damage');
        const b = makeDefaultAbility('damage');
        expect(a.id).not.toBe(b.id);
    });

    it('returns fresh config objects per call (no shared references)', () => {
        const a = makeDefaultAbility('damage');
        const b = makeDefaultAbility('damage');
        expect(a.config).not.toBe(b.config);
    });
});
