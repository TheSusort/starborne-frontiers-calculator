import { useEffect, useRef } from 'react';
import { useSynthwaveMusic } from './useSynthwaveMusic';

/** Pauses the shared player whenever the site theme is not synthwave, because the player's
 *  toggle only exists under that theme. */
export function usePauseMusicOffTheme(isSynthwave: boolean): void {
    const { pause } = useSynthwaveMusic();
    useEffect(() => {
        if (!isSynthwave) pause();
    }, [isSynthwave, pause]);
}

/** Pauses the shared player when the calling component unmounts under a non-synthwave theme,
 *  where nothing else offers a way to stop it. */
export function usePauseMusicOnUnmountOffTheme(isSynthwave: boolean): void {
    const { pause } = useSynthwaveMusic();
    const synthwaveRef = useRef(isSynthwave);
    synthwaveRef.current = isSynthwave;
    useEffect(
        () => () => {
            if (!synthwaveRef.current) pause();
        },
        [pause]
    );
}
