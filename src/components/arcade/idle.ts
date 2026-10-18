/** Time left in an idle period, as `requestIdleCallback` reports it. */
export interface IdleDeadline {
    timeRemaining(): number;
}

/** Idle time the fallback reports for its period: half a 60 Hz frame. */
export const FALLBACK_SLICE_MS = 8;

/**
 * Resolves with the next idle period's deadline, or after `timeoutMs` at the latest so a busy
 * page still gets there (its deadline then reports no time left). Without
 * `requestIdleCallback` (Safari), the period starts just after the next frame is painted, and
 * reports `FALLBACK_SLICE_MS`; the timeout also covers a hidden tab, where frames never come.
 */
export function whenIdle(timeoutMs = 1000): Promise<IdleDeadline> {
    return new Promise((resolve) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback((deadline) => resolve(deadline), { timeout: timeoutMs });
            return;
        }
        let started = false;
        const start = () => {
            if (started) return;
            started = true;
            window.clearTimeout(cap);
            const t0 = performance.now();
            resolve({
                timeRemaining: () => Math.max(0, FALLBACK_SLICE_MS - (performance.now() - t0)),
            });
        };
        const cap = window.setTimeout(start, timeoutMs);
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => window.setTimeout(start, 0));
        }
    });
}

/** Idle time a unit of work is assumed to need unless its task says otherwise. */
export const DEFAULT_UNIT_MS = 4;

/** A queued task's view of the idle time it runs in. */
export interface IdleSlice {
    /**
     * Call before every unit of work after the first. Resolves at once while the current idle
     * period has `budgetMs` left, else in the next idle period; rejects with an `AbortError`
     * once the task's signal has aborted.
     */
    next(budgetMs?: number): Promise<void>;
}

export interface IdleTaskOptions {
    /** Aborting drops the task if it is still queued and stops it at its next `slice.next()`. */
    signal?: AbortSignal;
    /** A task for which this returns true waits while the queue is held. */
    heavy?: () => boolean;
}

export interface IdleQueue {
    <T>(task: (slice: IdleSlice) => T | Promise<T>, options?: IdleTaskOptions): Promise<T>;
    /** While held, heavy tasks wait and the lighter tasks queued behind them run first. */
    hold(held: boolean): void;
}

export const abortError = (): Error =>
    Object.assign(new Error('Idle task cancelled'), { name: 'AbortError' });
/** True for the queue's cancellation error and for a DOM `AbortError`. */
export const isAbortError = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/**
 * A queue of heavy work for idle time. Tasks run one at a time, in order, each starting in an
 * idle period and splitting itself into units with `slice.next()`. A unit runs while the idle
 * period has time left for it, and the first unit of every period runs regardless, so a page
 * that is never idle (whose periods arrive through the timeout with no time left) still gets
 * one unit per period. A task that throws rejects its own promise only; the queue carries on.
 */
export function createIdleQueue(timeoutMs?: number): IdleQueue {
    interface Job {
        task: (slice: IdleSlice) => unknown;
        signal?: AbortSignal;
        heavy?: () => boolean;
        resolve: (value: unknown) => void;
        reject: (error: unknown) => void;
        onAbort: () => void;
    }
    const jobs: Job[] = [];
    let held = false;
    let pumping = false;
    let wake: (() => void) | null = null;
    let deadline: IdleDeadline | null = null;
    let unitsInPeriod = 0;

    const hasTime = (budgetMs: number) =>
        deadline !== null && (unitsInPeriod === 0 || deadline.timeRemaining() >= budgetMs);
    const waitForTime = async (budgetMs: number) => {
        if (hasTime(budgetMs)) return;
        deadline = await whenIdle(timeoutMs);
        unitsInPeriod = 0;
    };
    const runnable = () => jobs.findIndex((j) => !(held && j.heavy?.()));

    const sliceFor = (signal?: AbortSignal): IdleSlice => ({
        next: async (budgetMs = DEFAULT_UNIT_MS) => {
            if (signal?.aborted) throw abortError();
            await waitForTime(budgetMs);
            if (signal?.aborted) throw abortError();
            unitsInPeriod++;
        },
    });

    async function pump() {
        if (pumping) return;
        pumping = true;
        try {
            while (jobs.length > 0) {
                if (runnable() < 0) {
                    deadline = null;
                    await new Promise<void>((resolve) => (wake = resolve));
                    wake = null;
                    continue;
                }
                await waitForTime(DEFAULT_UNIT_MS);
                const i = runnable();
                if (i < 0) continue;
                const [job] = jobs.splice(i, 1);
                job.signal?.removeEventListener('abort', job.onAbort);
                unitsInPeriod++;
                try {
                    job.resolve(await job.task(sliceFor(job.signal)));
                } catch (e) {
                    job.reject(e);
                }
            }
        } finally {
            pumping = false;
            deadline = null;
        }
    }

    const queue = (<T>(
        task: (slice: IdleSlice) => T | Promise<T>,
        { signal, heavy }: IdleTaskOptions = {}
    ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            if (signal?.aborted) {
                reject(abortError());
                return;
            }
            const job: Job = {
                task,
                signal,
                heavy,
                resolve: resolve as (value: unknown) => void,
                reject,
                onAbort: () => {
                    const at = jobs.indexOf(job);
                    if (at < 0) return;
                    jobs.splice(at, 1);
                    reject(abortError());
                    wake?.();
                },
            };
            signal?.addEventListener('abort', job.onAbort, { once: true });
            jobs.push(job);
            wake?.();
            void pump();
        })) as IdleQueue;
    queue.hold = (h: boolean) => {
        held = h;
        if (!h) wake?.();
    };
    return queue;
}

/** The page-wide idle queue the ship model parses and sprite renders share. */
export const runWhenIdle = createIdleQueue();
