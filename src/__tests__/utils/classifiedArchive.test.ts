import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readUnlocked, writeUnlocked } from '../../constants/classifiedArchive';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('readUnlocked', () => {
    it('returns empty array when key is absent', () => {
        expect(readUnlocked()).toEqual([]);
    });

    it('returns stored fragment IDs', () => {
        writeUnlocked(['the-mechanisms', 'the-bludgeon']);
        expect(readUnlocked()).toEqual(['the-mechanisms', 'the-bludgeon']);
    });

    it('returns empty array when stored value is malformed JSON', () => {
        localStorage.setItem('classified_unlocked', 'not-json{{{');
        expect(readUnlocked()).toEqual([]);
    });

    it('returns empty array when stored value is not an array', () => {
        localStorage.setItem('classified_unlocked', JSON.stringify({ id: 'x' }));
        expect(readUnlocked()).toEqual([]);
    });

    it('filters out non-string entries', () => {
        localStorage.setItem(
            'classified_unlocked',
            JSON.stringify(['valid', 42, null, 'also-valid'])
        );
        expect(readUnlocked()).toEqual(['valid', 'also-valid']);
    });
});
