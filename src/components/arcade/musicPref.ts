/** Deliberately not in `StorageKey`: that map feeds the data backup, and a game setting is not player data. */
export const ARCADE_MUSIC_KEY = 'arcade_music';

/** Music is on unless the player turned it off. */
export function readMusicPref(): boolean {
    try {
        return localStorage.getItem(ARCADE_MUSIC_KEY) !== '0';
    } catch {
        return true;
    }
}

export function writeMusicPref(on: boolean): void {
    try {
        localStorage.setItem(ARCADE_MUSIC_KEY, on ? '1' : '0');
    } catch {
        // storage unavailable (private mode, quota)
    }
}

/** Starts the player unless the player turned music off in an earlier session. */
export function resumeArcadeMusic(controller: { play(): void }): void {
    if (readMusicPref()) controller.play();
}
