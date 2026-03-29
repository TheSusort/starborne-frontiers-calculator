import { describe, it, expect, vi, beforeEach } from 'vitest';
// eslint-disable-next-line import/order
import {
    getSnapshotList,
    getSnapshot,
    createSnapshot,
} from '../../services/statisticsSnapshotService';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

import { supabase } from '../../config/supabase';

const mockFrom = supabase.from as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
});

// ─── getSnapshotList ───────────────────────────────────────────────────────────

describe('getSnapshotList', () => {
    it('fetches list and maps snake_case to camelCase', async () => {
        const rows = [
            { id: 'abc', snapshot_month: '2026-03' },
            { id: 'def', snapshot_month: '2026-02' },
        ];

        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: rows, error: null }),
        };
        mockFrom.mockReturnValue(chain);

        const result = await getSnapshotList('user-1');

        expect(mockFrom).toHaveBeenCalledWith('statistics_snapshots');
        expect(chain.select).toHaveBeenCalledWith('id, snapshot_month');
        expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
        expect(chain.order).toHaveBeenCalledWith('snapshot_month', { ascending: false });

        expect(result).toEqual([
            { id: 'abc', snapshotMonth: '2026-03' },
            { id: 'def', snapshotMonth: '2026-02' },
        ]);
    });

    it('returns empty array on error', async () => {
        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        };
        mockFrom.mockReturnValue(chain);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await getSnapshotList('user-1');

        expect(result).toEqual([]);
        expect(consoleSpy).toHaveBeenCalledWith(
            'Failed to fetch snapshot list:',
            expect.anything()
        );

        consoleSpy.mockRestore();
    });

    it('returns empty array when data is null but no error', async () => {
        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        mockFrom.mockReturnValue(chain);

        const result = await getSnapshotList('user-1');

        expect(result).toEqual([]);
    });
});

// ─── getSnapshot ──────────────────────────────────────────────────────────────

describe('getSnapshot', () => {
    const dbRow = {
        id: 'snap-1',
        user_id: 'user-1',
        snapshot_month: '2026-03',
        ships_stats: { total: 10 },
        gear_stats: { total: 50 },
        implants_stats: { total: 5 },
        engineering_stats: { totalPoints: 100 },
        created_at: '2026-03-01T00:00:00Z',
    };

    it('fetches full snapshot and maps all fields', async () => {
        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: dbRow, error: null }),
        };
        mockFrom.mockReturnValue(chain);

        const result = await getSnapshot('user-1', '2026-03');

        expect(mockFrom).toHaveBeenCalledWith('statistics_snapshots');
        expect(chain.select).toHaveBeenCalledWith('*');
        expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
        expect(chain.eq).toHaveBeenCalledWith('snapshot_month', '2026-03');

        expect(result).toEqual({
            id: 'snap-1',
            userId: 'user-1',
            snapshotMonth: '2026-03',
            shipsStats: { total: 10 },
            gearStats: { total: 50 },
            implantsStats: { total: 5 },
            engineeringStats: { totalPoints: 100 },
            createdAt: '2026-03-01T00:00:00Z',
        });
    });

    it('returns null when row not found', async () => {
        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        mockFrom.mockReturnValue(chain);

        const result = await getSnapshot('user-1', '2026-01');

        expect(result).toBeNull();
    });

    it('returns null and logs error on failure', async () => {
        const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        };
        mockFrom.mockReturnValue(chain);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await getSnapshot('user-1', '2026-03');

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch snapshot:', expect.anything());

        consoleSpy.mockRestore();
    });
});

// ─── createSnapshot ───────────────────────────────────────────────────────────

describe('createSnapshot', () => {
    const snapshotData = {
        shipsStats: { total: 10 } as never,
        gearStats: { total: 50 } as never,
        implantsStats: { total: 5 } as never,
        engineeringStats: { totalPoints: 100 } as never,
    };

    it('calls upsert with correct params and ignoreDuplicates', async () => {
        const chain = {
            upsert: vi.fn().mockResolvedValue({ error: null }),
        };
        mockFrom.mockReturnValue(chain);

        await createSnapshot('user-1', '2026-03', snapshotData);

        expect(mockFrom).toHaveBeenCalledWith('statistics_snapshots');
        expect(chain.upsert).toHaveBeenCalledWith(
            {
                user_id: 'user-1',
                snapshot_month: '2026-03',
                ships_stats: snapshotData.shipsStats,
                gear_stats: snapshotData.gearStats,
                implants_stats: snapshotData.implantsStats,
                engineering_stats: snapshotData.engineeringStats,
            },
            { onConflict: 'user_id,snapshot_month', ignoreDuplicates: true }
        );
    });

    it('logs error when upsert fails', async () => {
        const chain = {
            upsert: vi.fn().mockResolvedValue({ error: { message: 'Conflict' } }),
        };
        mockFrom.mockReturnValue(chain);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await createSnapshot('user-1', '2026-03', snapshotData);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to create snapshot:', expect.anything());

        consoleSpy.mockRestore();
    });

    it('handles null stats gracefully', async () => {
        const chain = {
            upsert: vi.fn().mockResolvedValue({ error: null }),
        };
        mockFrom.mockReturnValue(chain);

        await createSnapshot('user-1', '2026-03', {
            shipsStats: null,
            gearStats: null,
            implantsStats: null,
            engineeringStats: null,
        });

        expect(chain.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                ships_stats: null,
                gear_stats: null,
                implants_stats: null,
                engineering_stats: null,
            }),
            expect.anything()
        );
    });
});
