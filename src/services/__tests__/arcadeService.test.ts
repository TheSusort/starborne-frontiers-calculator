import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitArcadeScore } from '../arcadeService';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../config/supabase', () => ({ supabase: { rpc } }));

const run = { score: 1200, credits: 30, distance: 450 };

describe('submitArcadeScore', () => {
    beforeEach(() => {
        rpc.mockReset();
        rpc.mockResolvedValue({ data: [{ best: 1200, player_rank: 4 }], error: null });
    });

    it('sends the flown ship as p_ship', async () => {
        await expect(submitArcadeScore(run, 'Nayra')).resolves.toEqual({
            bestScore: 1200,
            rank: 4,
        });
        expect(rpc).toHaveBeenCalledWith('submit_arcade_score', {
            p_score: 1200,
            p_credits: 30,
            p_distance: 450,
            p_ship: 'Nayra',
        });
    });

    it('omits p_ship for the neon fighter', async () => {
        await submitArcadeScore(run, null);
        await submitArcadeScore(run);
        for (const call of rpc.mock.calls) {
            expect(call[1]).toEqual({ p_score: 1200, p_credits: 30, p_distance: 450 });
        }
    });

    it('omits a ship name the table would reject', async () => {
        await submitArcadeScore(run, '');
        await submitArcadeScore(run, 'x'.repeat(65));
        for (const call of rpc.mock.calls) {
            expect(call[1]).not.toHaveProperty('p_ship');
        }
    });

    it('throws the RPC error', async () => {
        rpc.mockResolvedValue({ data: null, error: new Error('boom') });
        await expect(submitArcadeScore(run, 'Nayra')).rejects.toThrow('boom');
    });
});
