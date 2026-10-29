import { registerSW } from 'virtual:pwa-register';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

let needRefresh = false;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

let reloading = false;
function reloadOnce(): void {
    if (reloading) return;
    reloading = true;
    window.location.reload();
}

/**
 * Registers the service worker once, at app start. A new version waits (`registerType: 'prompt'`
 * in `vite.config.ts`) until `applyServiceWorkerUpdate` is called, so an update never reloads the
 * page mid-task. `UpdatePrompt` subscribes to `needRefresh` and offers the reload.
 */
export function registerServiceWorker(): void {
    applyUpdate = registerSW({
        immediate: true,
        onNeedReload: reloadOnce,
        onNeedRefresh() {
            needRefresh = true;
            listeners.forEach((listener) => listener());
        },
        onRegisteredSW(_swScriptUrl, registration) {
            if (!registration) return;
            setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
        },
    });
}

export function subscribeNeedRefresh(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getNeedRefresh(): boolean {
    return needRefresh;
}

/**
 * Activates the waiting service worker; the page reloads once it takes control. The reload is
 * wired to `controllerchange` here because workbox-window only reloads when a worker already
 * controlled the page at registration, which a first-visit page left open never has.
 */
export function applyServiceWorkerUpdate(): void {
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true });
    void applyUpdate?.(true);
}
