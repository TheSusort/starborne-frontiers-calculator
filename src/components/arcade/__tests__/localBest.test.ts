import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readLocalBest, writeLocalBest, ARCADE_BEST_KEY } from '../localBest';

beforeEach(() => localStorage.clear());

describe('localBest', () => {
    it('is 0 when nothing is stored or the value is junk', () => {
        expect(readLocalBest()).toBe(0);
        localStorage.setItem(ARCADE_BEST_KEY, 'banana');
        expect(readLocalBest()).toBe(0);
    });
    it('keeps the maximum', () => {
        expect(writeLocalBest(500)).toBe(500);
        expect(writeLocalBest(200)).toBe(500);
        expect(readLocalBest()).toBe(500);
    });
    it('survives storage that throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(writeLocalBest(300)).toBe(300);
        spy.mockRestore();
    });
});
