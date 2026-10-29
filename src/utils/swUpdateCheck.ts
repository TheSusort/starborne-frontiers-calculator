/** Minimum time between two service-worker update checks from one tab. */
export const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Periodically asks the browser to re-fetch `/sw.js` so a long-lived tab picks up a new release.
 *
 * Every check is a network request for `/sw.js` (`registration.update()` bypasses the HTTP cache),
 * and that path runs a metered Netlify edge function (`netlify/edge-functions/sw-override.ts`). So
 * a check only runs while the tab is visible, at most once per interval; a tab that comes back
 * into view after the interval has passed checks straight away. Hidden tabs never check.
 *
 * Returns a function that removes the timer and listener.
 */
export function scheduleSwUpdateChecks(
    registration: { update: () => Promise<unknown> },
    intervalMs: number = SW_UPDATE_CHECK_INTERVAL_MS
): () => void {
    let lastCheck = Date.now();

    const checkIfDue = () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastCheck < intervalMs) return;
        lastCheck = Date.now();
        // update() rejects when offline; the next due check retries.
        registration.update().catch(() => {});
    };

    const timer = setInterval(checkIfDue, intervalMs);
    document.addEventListener('visibilitychange', checkIfDue);
    return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', checkIfDue);
    };
}
