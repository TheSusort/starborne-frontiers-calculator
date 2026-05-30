import { describe, it, expect } from 'vitest';
import { parseBuffEffects, isStackable, hasDpsEffect } from '../buffParser';

describe('parseBuffEffects', () => {
    describe('attack', () => {
        it('parses bare Attack', () => {
            expect(parseBuffEffects('Attack Up I', '+15% Attack')).toEqual({ attack: 15 });
        });
        it('parses negative attack', () => {
            expect(parseBuffEffects('Attack Down II', '-30% Attack')).toEqual({ attack: -30 });
        });
        it('parses Outgoing Attack form', () => {
            expect(parseBuffEffects('Attack Up II', '+30% Outgoing Attack')).toEqual({
                attack: 30,
            });
        });
        it('parses Direct Attack form', () => {
            expect(parseBuffEffects('Attack Up II', '+30% Direct Attack')).toEqual({ attack: 30 });
        });
    });

    describe('crit rate', () => {
        it('parses bare Crit Rate', () => {
            expect(parseBuffEffects('Crit Rate Up I', '+10% Crit Rate')).toEqual({ crit: 10 });
        });
        it('parses negative Crit Rate', () => {
            expect(parseBuffEffects('Crit Rate Down II', '-20% Crit Rate')).toEqual({ crit: -20 });
        });
    });

    describe('crit power', () => {
        it('parses bare Crit Power', () => {
            expect(parseBuffEffects('Crit Power Up I', '+15% Crit Power')).toEqual({
                critDamage: 15,
            });
        });
        it('parses Outgoing Crit Power form', () => {
            expect(
                parseBuffEffects('Tianchao Precision II', '+30% Crit Power, +20 Hacking')
            ).toEqual({ critDamage: 30 });
        });
        it('parses negative Crit Power', () => {
            expect(parseBuffEffects('Crit Power Down I', '-15% Crit Power')).toEqual({
                critDamage: -15,
            });
        });
    });

    describe('outgoing damage', () => {
        it('parses Outgoing Direct Damage', () => {
            expect(parseBuffEffects('Out. Damage Up II', '+30% Outgoing Direct Damage')).toEqual({
                outgoingDamage: 30,
            });
        });
        it('parses negative Outgoing Direct Damage', () => {
            expect(parseBuffEffects('Out. Damage Down II', '-30% Outgoing Direct Damage')).toEqual({
                outgoingDamage: -30,
            });
        });
    });

    describe('outgoing heal', () => {
        it('parses negative Outgoing Repair (debuff)', () => {
            expect(parseBuffEffects('Out. Repair Down II', '-50% Outgoing Repair')).toEqual({
                outgoingHeal: -50,
            });
        });
        it('parses positive Outgoing Repair (buff)', () => {
            expect(parseBuffEffects('Out. Repair Up II', '+30% Outgoing Repair')).toEqual({
                outgoingHeal: 30,
            });
        });
        it('does NOT parse Incoming Repair as outgoingHeal', () => {
            const result = parseBuffEffects('Everliving Regeneration I', '+10% Incoming Repair');
            expect(result.outgoingHeal).toBeUndefined();
        });
    });

    describe('defense penetration', () => {
        it('parses Defense Penetration', () => {
            expect(parseBuffEffects('Charge Overdrive I', '+10% Defense Penetration')).toEqual({
                defensePenetration: 10,
            });
        });
        it('does NOT double-parse Defense Penetration as defense', () => {
            const result = parseBuffEffects('Charge Overdrive I', '+10% Defense Penetration');
            expect(result.defense).toBeUndefined();
        });
    });

    describe('Out. vs Inc. DoT distinction', () => {
        it('maps Out. DoT to dotDamage', () => {
            expect(parseBuffEffects('Out. DoT Damage Up II', '+20% DoT Damage')).toEqual({
                dotDamage: 20,
            });
        });
        it('maps Out. DoT Down to negative dotDamage', () => {
            expect(parseBuffEffects('Out. DoT Damage Down I', '-10% DoT Damage')).toEqual({
                dotDamage: -10,
            });
        });
        it('maps Inc. DoT to incomingDotDamage', () => {
            expect(parseBuffEffects('Inc. DoT Damage Up II', '+20% DoT Damage')).toEqual({
                incomingDotDamage: 20,
            });
        });
        it('maps Inc. DoT Down to negative incomingDotDamage', () => {
            expect(parseBuffEffects('Inc. DoT Damage Down I', '-10% DoT Damage')).toEqual({
                incomingDotDamage: -10,
            });
        });
    });

    describe('enemy-side fields', () => {
        it('parses Defense debuff', () => {
            expect(parseBuffEffects('Defense Down II', '-30% Defense')).toEqual({ defense: -30 });
        });
        it('parses Defense buff', () => {
            expect(parseBuffEffects('Defense Up II', '+30% Defense')).toEqual({ defense: 30 });
        });
        it('parses Incoming Direct Damage', () => {
            expect(parseBuffEffects('Inc. Damage Up II', '+30% Incoming Direct Damage')).toEqual({
                incomingDamage: 30,
            });
        });
        it('parses negative Incoming Direct Damage', () => {
            expect(parseBuffEffects('Inc. Damage Down I', '-15% Incoming Direct Damage')).toEqual({
                incomingDamage: -15,
            });
        });
    });

    describe('hp', () => {
        it('parses Max HP percentage', () => {
            expect(parseBuffEffects('Hull Up I', '+20% Max HP')).toEqual({ hp: 20 });
        });
        it('parses bare HP percentage', () => {
            expect(parseBuffEffects('Hull Up I', '+10% HP')).toEqual({ hp: 10 });
        });
    });

    describe('speed', () => {
        it('parses positive Speed', () => {
            expect(parseBuffEffects('Speed Up II', '+30% Speed')).toEqual({ speed: 30 });
        });
        it('parses negative Speed', () => {
            expect(parseBuffEffects('Speed Down II', '-30% Speed')).toEqual({ speed: -30 });
        });
        it('parses Speed in a combined buff', () => {
            const result = parseBuffEffects('Combined Buff', '+20% Speed, +10% Attack');
            expect(result.speed).toBe(20);
            expect(result.attack).toBe(10);
        });
        it('parses Speed when it appears after another stat', () => {
            const result = parseBuffEffects('Combined Buff', '+30 Hacking, +5% Speed');
            expect(result.speed).toBe(5);
        });
    });

    describe('multi-stat buffs', () => {
        it('parses Marauder Rage III with attack + crit power', () => {
            expect(parseBuffEffects('Marauder Rage III', '+30% Attack, +20% Crit Power')).toEqual({
                attack: 30,
                critDamage: 20,
            });
        });
        it('parses Supercharged I (attack + crit rate + crit power + defense)', () => {
            const result = parseBuffEffects(
                'Supercharged I',
                '+15% Attack, +10% Crit Rate, +10% Crit Power, -20% Defense'
            );
            expect(result.attack).toBe(15);
            expect(result.crit).toBe(10);
            expect(result.critDamage).toBe(10);
            expect(result.defense).toBe(-20);
        });
        it('parses Core Charge I (after normalization)', () => {
            const result = parseBuffEffects(
                'Core Charge I',
                '+4% Outgoing Direct Damage, +1% Defense Penetration. Stackable up to 10 times.'
            );
            expect(result.outgoingDamage).toBe(4);
            expect(result.defensePenetration).toBe(1);
        });
    });

    describe('no DPS effect', () => {
        it('returns empty object for hacking-only buff', () => {
            expect(parseBuffEffects('Hacking Up II', '+40 Hacking')).toEqual({});
        });
        it('silently drops DoT value when name has neither Out. nor Inc. prefix', () => {
            expect(parseBuffEffects('DoT Damage Up I', '+20% DoT Damage')).toEqual({});
        });
    });
});

describe('isStackable', () => {
    it('detects Stackable keyword (capital S)', () => {
        const result = isStackable(
            '+10% Outgoing Direct Damage, -10% Defense, Stackable up to 10 times'
        );
        expect(result.stackable).toBe(true);
        expect(result.maxStacks).toBe(10);
    });
    it('detects stackable keyword (lowercase s)', () => {
        const result = isStackable('-2% Defense. Stackable up to 20 times.');
        expect(result.stackable).toBe(true);
        expect(result.maxStacks).toBe(20);
    });
    it('returns false for non-stackable description', () => {
        const result = isStackable('+30% Attack');
        expect(result.stackable).toBe(false);
        expect(result.maxStacks).toBeUndefined();
    });
    it('handles "stackable" without a max count', () => {
        const result = isStackable(
            'Redirects 10% of incoming direct damage. This effect is stackable, unremovable.'
        );
        expect(result.stackable).toBe(true);
        expect(result.maxStacks).toBeUndefined();
    });
});

describe('hasDpsEffect', () => {
    it('returns true when any relevant stat is present', () => {
        expect(hasDpsEffect({ attack: 30 }, ['attack', 'crit'])).toBe(true);
    });
    it('returns false when no relevant stats are present', () => {
        expect(hasDpsEffect({}, ['attack', 'crit'])).toBe(false);
    });
    it('returns false when only non-relevant stats are present', () => {
        expect(hasDpsEffect({ defense: -30 }, ['attack', 'crit'])).toBe(false);
    });
    it('returns true for enemy picker with defense field', () => {
        expect(hasDpsEffect({ defense: -30 }, ['defense', 'incomingDamage'])).toBe(true);
    });
});
