import { describe, it, expect } from 'vitest';
import { SelectedGameBuff, ParsedBuffEffects } from '../../../types/calculator';
import { selectedBuffToAbility } from '../buffAbilityConverters';

const effects: ParsedBuffEffects = { attack: 30 };

const gameBuff = (overrides: Partial<SelectedGameBuff> = {}): SelectedGameBuff => ({
    id: 'gb1',
    buffName: 'Power Up',
    stacks: 2,
    parsedEffects: effects,
    isStackable: true,
    ...overrides,
});

describe('selectedBuffToAbility', () => {
    it('produces a buff ability for a self target', () => {
        const ab = selectedBuffToAbility(gameBuff(), 'self');
        expect(ab.type).toBe('buff');
        expect(ab.target).toBe('self');
        expect(ab.config.type).toBe('buff');
        if (ab.config.type === 'buff') {
            expect(ab.config.buffName).toBe('Power Up');
            expect(ab.config.stacks).toBe(2);
            expect(ab.config.parsedEffects).toEqual(effects);
        }
    });

    it('carries skillDuration into config.duration', () => {
        const ab = selectedBuffToAbility(gameBuff({ skillDuration: 3 }), 'self');
        if (ab.config.type === 'buff') {
            expect(ab.config.duration).toBe(3);
        }
    });

    it('defaults a debuff ability to the resistible application inflict when the buff has none', () => {
        const ab = selectedBuffToAbility(gameBuff({ buffName: 'Weaken' }), 'enemy');
        expect(ab.type).toBe('debuff');
        expect(ab.target).toBe('enemy');
        expect(ab.config.type).toBe('debuff');
        if (ab.config.type === 'debuff') {
            expect(ab.config.buffName).toBe('Weaken');
            expect(ab.config.application).toBe('inflict');
        }
    });

    it("carries the buff's parsed application onto the debuff config", () => {
        const ab = selectedBuffToAbility(
            gameBuff({ buffName: 'Defense Down II', application: 'inflict' }),
            'enemy'
        );
        if (ab.config.type === 'debuff') {
            expect(ab.config.application).toBe('inflict');
        }
    });
});
