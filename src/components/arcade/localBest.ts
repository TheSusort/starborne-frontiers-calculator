import type { RunResult } from '../../utils/arcade/types';

/** Deliberately not in `StorageKey`: that map feeds the data backup, and a game score is not player data. */
export const ARCADE_BEST_KEY = 'arcade_best';
/** JSON `{ score, distance, credits }` of the best-score run; written together with `ARCADE_BEST_KEY`. */
export const ARCADE_BEST_RUN_KEY = 'arcade_best_run';

export interface LocalBestRun {
    score: number;
    /** Null when the stored best has no run record (a score-only best, or an unreadable record). */
    distance: number | null;
    credits: number | null;
}

export function readLocalBest(): number {
    try {
        const n = Number(localStorage.getItem(ARCADE_BEST_KEY));
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
        return 0;
    }
}

const nonNegativeIntOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * The best-score run, or null when there is no best. The run record counts only while its score
 * is the stored best; otherwise (legacy storage, malformed JSON) the best reads score-only.
 */
export function readLocalBestRun(): LocalBestRun | null {
    const score = readLocalBest();
    if (score <= 0) return null;
    let distance: number | null = null;
    let credits: number | null = null;
    try {
        const raw = localStorage.getItem(ARCADE_BEST_RUN_KEY);
        const parsed: unknown = raw === null ? null : JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
            const rec = parsed as Record<string, unknown>;
            if (rec.score === score) {
                distance = nonNegativeIntOrNull(rec.distance);
                credits = nonNegativeIntOrNull(rec.credits);
            }
        }
    } catch {
        // storage unavailable or malformed JSON: the best stays score-only
    }
    return { score, distance, credits };
}

/** Stores the run when it beats the stored best and returns the best score; storage failures keep the best for this session only. */
export function writeLocalBest(run: RunResult): number {
    const previous = readLocalBest();
    const score = Number.isFinite(run.score) ? Math.floor(run.score) : 0;
    if (score <= previous) return previous;
    try {
        localStorage.setItem(ARCADE_BEST_KEY, String(score));
        localStorage.setItem(
            ARCADE_BEST_RUN_KEY,
            JSON.stringify({ score, distance: run.distance, credits: run.credits })
        );
    } catch {
        // storage unavailable (private mode, quota)
    }
    return score;
}
