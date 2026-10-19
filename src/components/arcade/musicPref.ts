/** Deliberately not in `StorageKey`: that map feeds the data backup, and a game setting is not player data. */
export const ARCADE_MUSIC_KEY = 'arcade_music';

export function readMusicPref(): boolean {
    try {
        return localStorage.getItem(ARCADE_MUSIC_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeMusicPref(on: boolean): void {
    try {
        localStorage.setItem(ARCADE_MUSIC_KEY, on ? '1' : '0');
    } catch {
        // storage unavailable (private mode, quota)
    }
}
