import {
    applyServiceWorkerUpdate,
    getNeedRefresh,
    subscribeNeedRefresh,
} from '../../utils/serviceWorkerUpdate';
import { isChunkLoadError, markReload, reloadedRecently } from './chunkLoadError';

/** How long the reload waits for the new service worker to finish installing before reloading
 *  without it. */
export const SW_UPDATE_WAIT_MS = 10_000;

let held = false;
let pending = false;
let started = false;

/**
 * Recovers a page whose lazy chunk failed to load because a deploy removed it: reloads once onto
 * the latest build. Other errors are ignored, and so is a failure within `CHUNK_RELOAD_WINDOW_MS`
 * of an earlier automatic reload, so a chunk that stays missing never loops. While
 * `holdChunkReload(true)` is in effect the reload waits for the release.
 *
 * A plain reload is not enough under a service worker: the old worker would serve the old shell,
 * which asks for the same missing chunk. So the reload activates the new worker once it is
 * waiting (see `applyServiceWorkerUpdate`), and falls back to a plain reload after
 * `SW_UPDATE_WAIT_MS` or when no worker controls the page.
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
    pending = false;
    started = true;
    markReload();
    if (getNeedRefresh()) {
        applyServiceWorkerUpdate();
        return;
    }
    if (!navigator.serviceWorker?.controller) {
        window.location.reload();
        return;
    }
    let settled = false;
    const go = (activate: boolean) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        window.clearTimeout(timer);
        if (activate) applyServiceWorkerUpdate();
        else window.location.reload();
    };
    const unsubscribe = subscribeNeedRefresh(() => go(true));
    const timer = window.setTimeout(() => go(false), SW_UPDATE_WAIT_MS);
}
