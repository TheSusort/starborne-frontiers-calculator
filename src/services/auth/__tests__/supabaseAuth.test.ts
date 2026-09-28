import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../../config/supabase';
import { SupabaseAuthService } from '../supabaseAuth';

vi.mock('../../../config/supabase', () => ({
    supabase: { auth: { signInWithOAuth: vi.fn() } },
}));

const signInWithOAuth = supabase.auth.signInWithOAuth as unknown as ReturnType<typeof vi.fn>;

describe('SupabaseAuthService.signInWithGoogle', () => {
    beforeEach(() => {
        signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
    });

    it('returns to the site root by default', async () => {
        await new SupabaseAuthService().signInWithGoogle();

        expect(signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: window.location.origin },
        });
    });

    it('returns to the given URL, query string included', async () => {
        const consent = 'https://starborneplanner.com/oauth/consent?authorization_id=abc';

        await new SupabaseAuthService().signInWithGoogle(consent);

        expect(signInWithOAuth).toHaveBeenCalledWith({
            provider: 'google',
            options: { redirectTo: consent },
        });
    });

    it('throws the Supabase error', async () => {
        signInWithOAuth.mockResolvedValue({ data: {}, error: new Error('denied') });

        await expect(new SupabaseAuthService().signInWithGoogle()).rejects.toThrow('denied');
    });
});
