import { describe, it, expect, vi } from 'vitest';
import { averageDailyVisitors, formatDuration, getTrafficSummary } from '../trafficService';
import { supabase } from '../../config/supabase';

vi.mock('../../config/supabase', () => ({ supabase: { rpc: vi.fn() } }));

describe('formatDuration', () => {
    it.each([
        [0, '0s'],
        [45_000, '45s'],
        [185_000, '3m 05s'],
        [3_720_000, '1h 02m'],
    ])('%i ms → %s', (ms, expected) => {
        expect(formatDuration(ms)).toBe(expected);
    });
});

describe('getTrafficSummary', () => {
    it('passes the day range and returns the payload', async () => {
        const payload = {
            daily: [],
            pages: [],
            referrers: [],
            devices: { mobile: 0, tablet: 0, desktop: 0 },
            clicks: [],
            errors: [],
        };
        vi.mocked(supabase.rpc).mockResolvedValue({ data: payload, error: null } as never);
        await expect(getTrafficSummary(30)).resolves.toEqual(payload);
        expect(supabase.rpc).toHaveBeenCalledWith('get_traffic_summary', { p_days: 30 });
    });

    it('returns null on error', async () => {
        vi.mocked(supabase.rpc).mockResolvedValue({
            data: null,
            error: { message: 'x' },
        } as never);
        await expect(getTrafficSummary(7)).resolves.toBeNull();
    });
});

describe('averageDailyVisitors', () => {
    const today = new Date('2026-10-20T12:00:00Z');
    const day = (date: string, visitors: number) => ({
        day: date,
        views: 0,
        visitors,
        sessions: 0,
    });

    it('counts days without rows as zero', () => {
        const daily = [day('2026-10-14', 70), day('2026-10-20', 0)];
        expect(averageDailyVisitors(daily, 7, today)).toBe(10);
    });

    it('does not count days before the first tracked day', () => {
        expect(
            averageDailyVisitors([day('2026-10-19', 30), day('2026-10-20', 10)], 30, today)
        ).toBe(20);
    });

    it('is 0 with no data', () => {
        expect(averageDailyVisitors([], 30, today)).toBe(0);
    });
});
