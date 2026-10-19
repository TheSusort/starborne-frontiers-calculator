import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getSynthwaveMusic } from '../synthwaveMusic';
import { usePauseMusicOffTheme, usePauseMusicOnUnmountOffTheme } from '../usePauseMusicOffTheme';
import { useSynthwaveMusic } from '../useSynthwaveMusic';

class FakeAudio {
    src = '';
    volume = 1;
    preload = '';
    play = () => Promise.resolve();
    pause = () => {};
    addEventListener() {}
    removeEventListener() {}
}

const music = getSynthwaveMusic();

describe('pausing the shared player off the synthwave theme', () => {
    afterEach(() => music.pause());

    it('pauses when the theme leaves synthwave, and not while it stays', () => {
        (globalThis as { Audio: unknown }).Audio = FakeAudio;
        const { rerender } = renderHook(({ on }) => usePauseMusicOffTheme(on), {
            initialProps: { on: true },
        });
        music.play();
        rerender({ on: true });
        expect(music.getSnapshot().isPlaying).toBe(true);
        rerender({ on: false });
        expect(music.getSnapshot().isPlaying).toBe(false);
    });

    it('pauses on unmount off synthwave, and leaves it playing under synthwave', () => {
        (globalThis as { Audio: unknown }).Audio = FakeAudio;
        music.play();
        renderHook(() => usePauseMusicOnUnmountOffTheme(true)).unmount();
        expect(music.getSnapshot().isPlaying).toBe(true);
        renderHook(() => usePauseMusicOnUnmountOffTheme(false)).unmount();
        expect(music.getSnapshot().isPlaying).toBe(false);
    });

    it('keeps the control functions stable across renders', () => {
        const { result, rerender } = renderHook(() => useSynthwaveMusic());
        const first = result.current;
        music.play();
        rerender();
        expect(result.current.play).toBe(first.play);
        expect(result.current.pause).toBe(first.pause);
        expect(result.current.toggle).toBe(first.toggle);
        expect(result.current.next).toBe(first.next);
    });
});
