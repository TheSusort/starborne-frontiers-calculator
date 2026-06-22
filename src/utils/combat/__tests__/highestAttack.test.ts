import { describe, it, expect } from 'vitest';
import { highestAttackAmong } from '../highestAttack';

describe('highestAttackAmong', () => {
    const attackOf = (id: string) => ({ a: 100, b: 250, c: 250, d: 50 })[id] ?? 0;
    const living = (dead: string[]) => (id: string) => !dead.includes(id);

    it('returns the id with the greatest attack', () => {
        expect(highestAttackAmong(['a', 'b', 'd'], attackOf, living([]))).toBe('b');
    });

    it('breaks ties by roster order (first wins)', () => {
        expect(highestAttackAmong(['a', 'b', 'c'], attackOf, living([]))).toBe('b');
    });

    it('skips dead actors', () => {
        expect(highestAttackAmong(['b', 'c'], attackOf, living(['b']))).toBe('c');
    });

    it('returns undefined when no living candidate', () => {
        expect(highestAttackAmong(['a', 'b'], attackOf, living(['a', 'b']))).toBeUndefined();
        expect(highestAttackAmong([], attackOf, living([]))).toBeUndefined();
    });
});
