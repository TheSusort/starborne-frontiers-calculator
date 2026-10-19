import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCADE_MUSIC_KEY, readMusicPref, writeMusicPref } from './musicPref';

describe('music preference', () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('defaults to off and round-trips', () => {
        expect(readMusicPref()).toBe(false);
        writeMusicPref(true);
        expect(localStorage.getItem(ARCADE_MUSIC_KEY)).toBe('1');
        expect(readMusicPref()).toBe(true);
        writeMusicPref(false);
        expect(readMusicPref()).toBe(false);
    });

    it('survives unavailable storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readMusicPref()).toBe(false);
        expect(() => writeMusicPref(true)).not.toThrow();
    });
});
