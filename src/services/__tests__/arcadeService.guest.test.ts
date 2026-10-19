import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitArcadeScore, GuestNameTakenError, GuestNameRequiredError } from '../arcadeService';

const rpc = vi.fn();
vi.mock('../../config/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const run = { score: 100, credits: 5, distance: 50 } as never;

describe('submitArcadeScore guest name', () => {
    beforeEach(() => rpc.mockReset());

    it('sends p_guest_name when given', async () => {
        rpc.mockResolvedValue({ data: [{ best: 100, player_rank: 3 }], error: null });
        await submitArcadeScore(run, null, 'Ace');
        expect(rpc).toHaveBeenCalledWith('submit_arcade_score', {
            p_score: 100,
            p_credits: 5,
            p_distance: 50,
            p_guest_name: 'Ace',
        });
    });

    it('maps 23505 to GuestNameTakenError', async () => {
        rpc.mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'guest_name_taken' },
        });
        await expect(submitArcadeScore(run, null, 'Ace')).rejects.toBeInstanceOf(
            GuestNameTakenError
        );
    });

    it('maps guest_name_required to GuestNameRequiredError', async () => {
        rpc.mockResolvedValue({
            data: null,
            error: { code: 'P0001', message: 'guest_name_required' },
        });
        await expect(submitArcadeScore(run)).rejects.toBeInstanceOf(GuestNameRequiredError);
    });
});
