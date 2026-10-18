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

/**
 * A queue of heavy tasks for idle time. Each task waits for every task queued before it to
 * settle, then for a fresh `whenIdle`, so at most one runs per idle period however the browser
 * batches idle callbacks or fires their timeouts. A task that throws rejects its own promise
 * only; the queue carries on.
 */
export function createIdleQueue(timeoutMs?: number) {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(task: () => T | Promise<T>): Promise<T> => {
        const run = tail.then(() => whenIdle(timeoutMs)).then(task);
        tail = run.catch(() => undefined);
        return run;
    };
}

/** The page-wide idle queue the ship sprite renders share. */
export const runWhenIdle = createIdleQueue();
