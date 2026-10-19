import { describe, expect, it, vi } from 'vitest';
import {
    createMusicController,
    getSynthwaveMusic,
    SYNTHWAVE_TRACKS,
    trackTitleOf,
    type AudioLike,
} from '../synthwaveMusic';

function fakeAudio() {
    const handlers: Array<() => void> = [];
    const audio = {
        src: '',
        volume: 1,
        preload: '',
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        addEventListener: (_t: 'ended', l: () => void) => handlers.push(l),
        removeEventListener: vi.fn(),
    } satisfies AudioLike;
    return { audio, end: () => handlers.forEach((h) => h()) };
}

const inOrder = () => 0.999999; // shuffle swaps nothing relevant: deterministic
const make = () => {
    const f = fakeAudio();
    return { ...f, c: createMusicController(() => f.audio, inOrder) };
};

describe('synthwave music controller', () => {
    it('plays a shuffle of exactly the four tracks, preloading nothing until played', () => {
        const { c, audio } = make();
        expect(audio.src).toBe('');
        c.play();
        expect(audio.preload).toBe('none');
        expect(audio.volume).toBe(0.3);
        expect([...SYNTHWAVE_TRACKS]).toContain(audio.src);
        const seen = new Set([audio.src]);
        for (let i = 0; i < 3; i++) {
            c.next();
            seen.add(audio.src);
        }
        expect(seen.size).toBe(4);
    });

    it('next wraps around the playlist', () => {
        const { c, audio } = make();
        c.play();
        const first = audio.src;
        for (let i = 0; i < 4; i++) c.next();
        expect(audio.src).toBe(first);
    });

    it('toggle plays then pauses and reports state', () => {
        const { c, audio } = make();
        c.toggle();
        expect(c.getSnapshot().isPlaying).toBe(true);
        expect(audio.play).toHaveBeenCalledTimes(1);
        c.toggle();
        expect(c.getSnapshot().isPlaying).toBe(false);
        expect(audio.pause).toHaveBeenCalledTimes(1);
    });

    it('next while paused changes the title without starting playback', () => {
        const { c, audio } = make();
        const before = c.getSnapshot().trackTitle;
        c.next();
        expect(c.getSnapshot().trackTitle).not.toBe(before);
        expect(audio.play).not.toHaveBeenCalled();
    });

    it('a finished track advances and keeps playing', () => {
        const { c, audio, end } = make();
        c.play();
        const first = audio.src;
        end();
        expect(audio.src).not.toBe(first);
        expect(audio.play).toHaveBeenCalledTimes(2);
    });

    it('makes one Audio and registers one ended handler across play, pause, play and next', () => {
        const f = fakeAudio();
        const addSpy = vi.spyOn(f.audio, 'addEventListener');
        const makeAudio = vi.fn(() => f.audio);
        const c = createMusicController(makeAudio, inOrder);
        c.play();
        c.pause();
        c.play();
        c.next();
        expect(makeAudio).toHaveBeenCalledTimes(1);
        expect(addSpy).toHaveBeenCalledTimes(1);
    });

    it('a refused play reverts to paused', async () => {
        const f = fakeAudio();
        f.audio.play.mockReturnValueOnce(Promise.reject(new Error('NotAllowedError')));
        const c = createMusicController(() => f.audio, inOrder);
        c.play();
        await Promise.resolve();
        await Promise.resolve();
        expect(c.getSnapshot().isPlaying).toBe(false);
    });

    it('notifies subscribers until they unsubscribe', () => {
        const { c } = make();
        const l = vi.fn();
        const off = c.subscribe(l);
        c.play();
        expect(l).toHaveBeenCalled();
        off();
        l.mockClear();
        c.pause();
        expect(l).not.toHaveBeenCalled();
    });

    it('two consumers of the shared instance see one player', () => {
        expect(getSynthwaveMusic()).toBe(getSynthwaveMusic());
    });

    it('titles derive from the file name', () => {
        expect(trackTitleOf('/audio/disco.mp3')).toBe('Disco');
        expect(trackTitleOf('/audio/disco3.mp3')).toBe('Disco 3');
    });
});
