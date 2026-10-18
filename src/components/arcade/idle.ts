/**
 * Resolves when the browser next reports idle time, or after `timeoutMs` at the latest so a
 * busy page (or a browser without `requestIdleCallback`) still gets there.
 */
export function whenIdle(timeoutMs = 1000): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
        } else {
            window.setTimeout(resolve, 0);
        }
    });
}
