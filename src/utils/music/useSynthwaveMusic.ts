import { useMemo, useSyncExternalStore } from 'react';
import { getSynthwaveMusic } from './synthwaveMusic';

/** Controls and state of the one shared synthwave player (Sidebar and Arcade). The control
 *  functions keep one identity for the life of the component. */
export function useSynthwaveMusic() {
    const music = getSynthwaveMusic();
    const { isPlaying, trackTitle } = useSyncExternalStore(music.subscribe, music.getSnapshot);
    const controls = useMemo(
        () => ({
            play: () => music.play(),
            pause: () => music.pause(),
            toggle: () => music.toggle(),
            next: () => music.next(),
        }),
        [music]
    );
    return { isPlaying, trackTitle, ...controls };
}
