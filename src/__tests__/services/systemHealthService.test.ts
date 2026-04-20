import { describe, it, expect, vi, beforeEach } from 'vitest';
// eslint-disable-next-line import/order
import { getSystemStats, refreshSystemSnapshot } from '../../services/systemHealthService';

vi.mock('../../config/supabase', () => ({
    supabase: {
        rpc: vi.fn(),
    },
}));

import { supabase } from '../../config/supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
});

const sampleStats = {
    total_ships: 11168,
    total_inventory: 503909,
    total_loadouts: 17,
    total_encounters: 53,
    total_users: 85,
    total_active_users: 72,
    avg_ships_per_user: 155.1,
    avg_gear_per_user: 6998.7,
    snapshot_date: '2026-04-20',
    updated_at: '2026-04-20T10:15:00.000Z',
};

describe('getSystemStats', () => {
    it('calls the get_system_stats RPC and returns the row', async () => {
        mockRpc.mockResolvedValue({ data: sampleStats, error: null });

        const result = await getSystemStats();

        expect(mockRpc).toHaveBeenCalledWith('get_system_stats');
        expect(result).toEqual(sampleStats);
    });

    it('returns null on RPC error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

        const result = await getSystemStats();

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

describe('refreshSystemSnapshot', () => {
    it('calls the refresh_system_snapshot RPC and returns the row', async () => {
        mockRpc.mockResolvedValue({ data: sampleStats, error: null });

        const result = await refreshSystemSnapshot();

        expect(mockRpc).toHaveBeenCalledWith('refresh_system_snapshot');
        expect(result).toEqual(sampleStats);
    });

    it('returns null on RPC error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });

        const result = await refreshSystemSnapshot();

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
