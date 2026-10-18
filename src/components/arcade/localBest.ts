/** Deliberately not in `StorageKey`: that map feeds the data backup, and a game score is not player data. */
export const ARCADE_BEST_KEY = 'arcade_best';

export function readLocalBest(): number {
    try {
        const n = Number(localStorage.getItem(ARCADE_BEST_KEY));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
        return 0;
    }
}

/** Stores max(previous, score) and returns it; storage failures keep the best for this session only. */
export function writeLocalBest(score: number): number {
    const best = Math.max(readLocalBest(), Number.isFinite(score) ? Math.floor(score) : 0);
    try {
        localStorage.setItem(ARCADE_BEST_KEY, String(best));
    } catch {
        // storage unavailable (private mode, quota)
    }
    return best;
}
