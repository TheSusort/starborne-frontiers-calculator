import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    submitArcadeScore,
    getOwnGuestName,
    GuestNameTakenError,
    GuestNameRequiredError,
} from '../arcadeService';

const rpc = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('../../config/supabase', () => ({
    supabase: {
        rpc: (...a: unknown[]) => rpc(...a),
        from: (...a: unknown[]) => from(...(a as [])),
    },
}));

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

    it('rethrows a 23505 raw when no guest name was sent', async () => {
        const error = { code: '23505', message: 'duplicate key' };
        rpc.mockResolvedValue({ data: null, error });
        const outcome = submitArcadeScore(run, null);
        await expect(outcome).rejects.toBe(error);
    });

    it('maps guest_name_required to GuestNameRequiredError', async () => {
        rpc.mockResolvedValue({
            data: null,
            error: { code: 'P0001', message: 'guest_name_required' },
        });
        await expect(submitArcadeScore(run)).rejects.toBeInstanceOf(GuestNameRequiredError);
    });
});

describe('getOwnGuestName', () => {
    beforeEach(() => {
        maybeSingle.mockReset();
        from.mockClear();
        select.mockClear();
        eq.mockClear();
    });

    it("returns the caller's own guest name", async () => {
        maybeSingle.mockResolvedValue({ data: { name: 'Ace' }, error: null });
        await expect(getOwnGuestName('g1')).resolves.toBe('Ace');
        expect(from).toHaveBeenCalledWith('arcade_guest_names');
        expect(select).toHaveBeenCalledWith('name');
        expect(eq).toHaveBeenCalledWith('user_id', 'g1');
    });

    it('returns null when the guest has no name', async () => {
        maybeSingle.mockResolvedValue({ data: null, error: null });
        await expect(getOwnGuestName('g1')).resolves.toBeNull();
    });
});
