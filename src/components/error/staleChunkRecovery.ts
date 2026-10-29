import {
    applyServiceWorkerUpdate,
    getNeedRefresh,
    subscribeNeedRefresh,
} from '../../utils/serviceWorkerUpdate';
import { isChunkLoadError, markReload, reloadedRecently } from './chunkLoadError';

let held = false;
let pending = false;
let started = false;
let unsubscribe: (() => void) | null = null;

/**
 * Recovers a page whose lazy chunk failed to load because a deploy removed it: reloads once onto
 * the latest build. Other errors are ignored, and so is a failure within `CHUNK_RELOAD_WINDOW_MS`
 * of an earlier automatic reload, so a chunk that stays missing never loops. While
 * `holdChunkReload(true)` is in effect the reload waits for the release.
 *
 * A plain reload is not enough under a service worker: the old worker would serve the old shell,
 * which asks for the same missing chunk. So under a worker the reload waits, however long it
 * takes, until the new one is waiting and then activates it (see `applyServiceWorkerUpdate`); a
 * page no worker controls reloads plainly. If no new worker ever arrives, nothing reloads.
 */
export function reportChunkLoadError(error: unknown): void {
    if (started || pending || !isChunkLoadError(error) || reloadedRecently()) return;
    pending = true;
    try {
        void navigator.serviceWorker
            ?.getRegistration()
            .then((registration) => registration?.update())
            .catch(() => {});
    } catch {
        // No service worker to update; the reload goes ahead without one.
    }
    flush();
}

/** Holds a pending reload while `hold` is true; releasing it reloads if one is pending. */
export function holdChunkReload(hold: boolean): void {
    held = hold;
    flush();
}

function flush(): void {
    if (!pending || held || started) return;
    const underWorker = !!navigator.serviceWorker?.controller;
    if (underWorker && !getNeedRefresh()) {
        unsubscribe ??= subscribeNeedRefresh(flush);
        return;
    }
    unsubscribe?.();
    unsubscribe = null;
    pending = false;
    started = true;
    markReload();
    if (underWorker) applyServiceWorkerUpdate();
    else window.location.reload();
}
