import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunityRecommendationService } from '../../services/communityRecommendations';
import { supabase } from '../../config/supabase';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
        auth: { getUser: vi.fn() },
    },
}));

const asSession = (user: { id: string; is_anonymous?: boolean } | null) =>
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { user } });

describe('community votes under an anonymous (arcade guest) session', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not vote, read a vote or remove a vote for a guest', async () => {
        asSession({ id: 'guest-1', is_anonymous: true });

        expect(await CommunityRecommendationService.voteOnRecommendation('r1', 'upvote')).toBe(
            false
        );
        expect(await CommunityRecommendationService.getUserVote('r1')).toBeNull();
        expect(await CommunityRecommendationService.removeVote('r1')).toBe(false);
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('still votes for an account', async () => {
        asSession({ id: 'acct-1', is_anonymous: false });
        const upsert = vi.fn().mockResolvedValue({ error: null });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ upsert });

        expect(await CommunityRecommendationService.voteOnRecommendation('r1', 'upvote')).toBe(
            true
        );
        expect(upsert).toHaveBeenCalled();
    });
});
