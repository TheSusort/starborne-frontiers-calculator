import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SW_UPDATE_CHECK_INTERVAL_MS, scheduleSwUpdateChecks } from '../swUpdateCheck';

const HOUR = SW_UPDATE_CHECK_INTERVAL_MS;

describe('scheduleSwUpdateChecks', () => {
    let visibility: DocumentVisibilityState;
    let update: Mock<() => Promise<unknown>>;
    let stop: () => void;

    const setVisibility = (v: DocumentVisibilityState) => {
        visibility = v;
        document.dispatchEvent(new Event('visibilitychange'));
    };

    beforeEach(() => {
        vi.useFakeTimers();
        visibility = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        update = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
        stop = scheduleSwUpdateChecks({ update });
    });

    afterEach(() => {
        stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('checks once per interval while visible', () => {
        vi.advanceTimersByTime(HOUR - 1);
        expect(update).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(update).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(HOUR);
        expect(update).toHaveBeenCalledTimes(2);
    });

    it('never checks while hidden', () => {
        setVisibility('hidden');
        vi.advanceTimersByTime(5 * HOUR);
        expect(update).not.toHaveBeenCalled();
    });

    it('checks on becoming visible once the interval has passed', () => {
        setVisibility('hidden');
        vi.advanceTimersByTime(3 * HOUR);
        setVisibility('visible');
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('does not check on becoming visible within the interval', () => {
        vi.advanceTimersByTime(HOUR / 2);
        setVisibility('hidden');
        setVisibility('visible');
        expect(update).not.toHaveBeenCalled();
    });

    it('swallows an offline update rejection', async () => {
        update.mockRejectedValueOnce(new Error('offline'));
        vi.advanceTimersByTime(HOUR);
        await Promise.resolve();
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('stops checking after cleanup', () => {
        stop();
        vi.advanceTimersByTime(5 * HOUR);
        setVisibility('visible');
        expect(update).not.toHaveBeenCalled();
    });
});
