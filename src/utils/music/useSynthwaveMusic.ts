import { useSyncExternalStore } from 'react';
import { getSynthwaveMusic } from './synthwaveMusic';

/** Controls and state of the one shared synthwave player (Sidebar and Arcade). */
export function useSynthwaveMusic() {
    const music = getSynthwaveMusic();
    const { isPlaying, trackTitle } = useSyncExternalStore(music.subscribe, music.getSnapshot);
    return {
        isPlaying,
        trackTitle,
        play: () => music.play(),
        pause: () => music.pause(),
        toggle: () => music.toggle(),
        next: () => music.next(),
    };
}
