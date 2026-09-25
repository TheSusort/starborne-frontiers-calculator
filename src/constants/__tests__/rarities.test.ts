import { describe, it, expect } from 'vitest';
import { getRarity, isRarityName, toRarityName } from '../rarities';

describe('rarity guards', () => {
    it('isRarityName accepts only the lowercase keys', () => {
        expect(isRarityName('legendary')).toBe(true);
        expect(isRarityName('Legendary')).toBe(false);
        expect(isRarityName('mythic')).toBe(false);
    });

    it('toRarityName normalises game casing and falls back to common', () => {
        expect(toRarityName('Legendary')).toBe('legendary');
        expect(toRarityName('EPIC')).toBe('epic');
        expect(toRarityName('mythic')).toBe('common');
    });

    it('getRarity returns undefined outside the union', () => {
        expect(getRarity('rare')?.value).toBe('rare');
        expect(getRarity('Rare')).toBeUndefined();
        expect(getRarity(undefined)).toBeUndefined();
    });
});
