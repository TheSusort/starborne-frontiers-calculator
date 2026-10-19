import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARCADE_MUSIC_KEY, readMusicPref, resumeArcadeMusic, writeMusicPref } from '../musicPref';

describe('music preference', () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('defaults to on and round-trips', () => {
        expect(readMusicPref()).toBe(true);
        writeMusicPref(false);
        expect(localStorage.getItem(ARCADE_MUSIC_KEY)).toBe('0');
        expect(readMusicPref()).toBe(false);
        writeMusicPref(true);
        expect(readMusicPref()).toBe(true);
    });

    it('survives unavailable storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(readMusicPref()).toBe(true);
        expect(() => writeMusicPref(true)).not.toThrow();
    });

    it('resumes playback unless the player left music off', () => {
        const controller = { play: vi.fn() };
        resumeArcadeMusic(controller);
        expect(controller.play).toHaveBeenCalledTimes(1);
        writeMusicPref(false);
        resumeArcadeMusic(controller);
        expect(controller.play).toHaveBeenCalledTimes(1);
        writeMusicPref(true);
        resumeArcadeMusic(controller);
        expect(controller.play).toHaveBeenCalledTimes(2);
    });
});
