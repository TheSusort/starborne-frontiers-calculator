/** sessionStorage key holding the time of the last automatic reload. */
export const CHUNK_RELOAD_KEY = 'chunkErrorReloadAt';
/** A chunk that still fails within this long of an automatic reload is not fixed by reloading,
 *  so no further automatic reload happens inside it. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR_PATTERNS = [
    'Loading chunk',
    'ChunkLoadError',
    'Loading CSS chunk',
    // Chrome
    'Failed to fetch dynamically imported module',
    // Safari
    'Importing a module script failed',
    // Firefox
    'error loading dynamically imported module',
];

/** True for the error a lazy `import()` rejects with when its file cannot be loaded, which is
 *  what a page still running a replaced build gets for the chunks the new deploy removed. */
export function isChunkLoadError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { message, name } = error as { message?: unknown; name?: unknown };
    const text = [message, name].filter((s): s is string => typeof s === 'string');
    return CHUNK_ERROR_PATTERNS.some((pattern) => text.some((s) => s.includes(pattern)));
}

/** Reads the last automatic reload time; storage that throws counts as "just reloaded", so a
 *  browser that blocks storage never loops. */
export function reloadedRecently(): boolean {
    try {
        const at = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
        return at > 0 && Date.now() - at < CHUNK_RELOAD_WINDOW_MS;
    } catch {
        return true;
    }
}

export function markReload(): void {
    try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
        // Storage that throws here also throws in reloadedRecently(), which blocks the reload.
    }
}
