import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_KEY } from '../chunkLoadError';

const sw = vi.hoisted(() => ({
    needRefresh: false,
    listeners: new Set<() => void>(),
    apply: vi.fn(),
}));

vi.mock('../../../utils/serviceWorkerUpdate', () => ({
    getNeedRefresh: () => sw.needRefresh,
    subscribeNeedRefresh: (listener: () => void) => {
        sw.listeners.add(listener);
        return () => sw.listeners.delete(listener);
    },
    applyServiceWorkerUpdate: sw.apply,
}));

const reload = vi.fn();
const update = vi.fn(() => Promise.resolve());
const originalLocation = window.location;
const chunkError = () =>
    new TypeError('Failed to fetch dynamically imported module: /assets/ShipModelView-abc.js');

/** A fresh copy of the module, so its pending/started state does not leak between tests. */
const load = () => import('../staleChunkRecovery');

function setController(controlled: boolean) {
    Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
            controller: controlled ? {} : null,
            getRegistration: () => Promise.resolve({ update }),
        },
    });
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    sessionStorage.clear();
    sw.needRefresh = false;
    sw.listeners.clear();
    setController(false);
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, reload },
    });
});

afterEach(() => {
    vi.useRealTimers();
    reload.mockReset();
    update.mockClear();
    sw.apply.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('reportChunkLoadError', () => {
    it('reloads once on a chunk-load error and asks the service worker to update', async () => {
        const { reportChunkLoadError } = await load();
        reportChunkLoadError(chunkError());
        reportChunkLoadError(chunkError());
        await vi.runAllTimersAsync();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    });

    it('does not reload within the window of an earlier automatic reload', async () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        const { reportChunkLoadError } = await load();
        reportChunkLoadError(chunkError());
        await vi.runAllTimersAsync();
        expect(reload).not.toHaveBeenCalled();
        expect(sw.apply).not.toHaveBeenCalled();
    });

    it.each([new Error('ship models disabled'), new Error('WebGL context lost'), 'boom', null])(
        'ignores %s',
        async (error) => {
            const { reportChunkLoadError } = await load();
            reportChunkLoadError(error);
            await vi.runAllTimersAsync();
            expect(reload).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        }
    );

    it('waits while held and reloads on release', async () => {
        const { holdChunkReload, reportChunkLoadError } = await load();
        holdChunkReload(true);
        reportChunkLoadError(chunkError());
        holdChunkReload(true);
        await vi.runAllTimersAsync();
        expect(reload).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
        holdChunkReload(false);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('releasing with nothing pending does not reload', async () => {
        const { holdChunkReload } = await load();
        holdChunkReload(true);
        holdChunkReload(false);
        await vi.runAllTimersAsync();
        expect(reload).not.toHaveBeenCalled();
    });

    it('activates a waiting service worker rather than reloading under the old one', async () => {
        sw.needRefresh = true;
        setController(true);
        const { reportChunkLoadError } = await load();
        reportChunkLoadError(chunkError());
        expect(sw.apply).toHaveBeenCalledTimes(1);
        expect(reload).not.toHaveBeenCalled();
    });

    it('under a service worker, activates the new one once it is waiting', async () => {
        setController(true);
        const { reportChunkLoadError } = await load();
        reportChunkLoadError(chunkError());
        expect(sw.apply).not.toHaveBeenCalled();
        sw.needRefresh = true;
        sw.listeners.forEach((listener) => listener());
        await vi.runAllTimersAsync();
        expect(sw.apply).toHaveBeenCalledTimes(1);
        expect(reload).not.toHaveBeenCalled();
    });

    it('under a service worker, reloads plainly if no new one arrives in time', async () => {
        setController(true);
        const { reportChunkLoadError, SW_UPDATE_WAIT_MS } = await load();
        reportChunkLoadError(chunkError());
        vi.advanceTimersByTime(SW_UPDATE_WAIT_MS - 1);
        expect(reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sw.apply).not.toHaveBeenCalled();
    });
});
