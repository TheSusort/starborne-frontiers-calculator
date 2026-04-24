import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    listProfiles,
    createAlt,
    renameAlt,
    setAltPublic,
    deleteAlt,
} from '../../services/altAccountService';
import { supabase } from '../../config/supabase';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

describe('altAccountService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('listProfiles fetches main + owned alts for an auth user', async () => {
        const rows = [
            { id: 'auth-id', username: 'main', owner_auth_user_id: null, is_public: true },
            { id: 'alt-1', username: 'alt-one', owner_auth_user_id: 'auth-id', is_public: false },
        ];
        const orFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const select = vi.fn().mockReturnValue({ or: orFn });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ select });

        const profiles = await listProfiles('auth-id');

        expect(supabase.from).toHaveBeenCalledWith('users');
        expect(select).toHaveBeenCalled();
        expect(orFn).toHaveBeenCalledWith('id.eq.auth-id,owner_auth_user_id.eq.auth-id');
        expect(profiles).toEqual(rows);
    });

    it('createAlt inserts a row with owner_auth_user_id and omits id', async () => {
        const inserted = {
            id: 'new-uuid',
            username: 'newalt',
            owner_auth_user_id: 'auth-id',
            is_public: false,
        };
        const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const profile = await createAlt('auth-id', 'newalt');

        expect(insert).toHaveBeenCalledWith({
            owner_auth_user_id: 'auth-id',
            username: 'newalt',
            is_public: false,
        });
        expect(profile).toEqual(inserted);
    });

    it('renameAlt updates username only on the alt row', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const update = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update });

        await renameAlt('alt-1', 'auth-id', 'newname');

        expect(update).toHaveBeenCalledWith({ username: 'newname' });
        expect(eq1).toHaveBeenCalledWith('id', 'alt-1');
        expect(eq2).toHaveBeenCalledWith('owner_auth_user_id', 'auth-id');
    });

    it('setAltPublic flips is_public on an alt the user owns', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const update = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update });

        await setAltPublic('alt-1', 'auth-id', true);

        expect(update).toHaveBeenCalledWith({ is_public: true });
        expect(eq1).toHaveBeenCalledWith('id', 'alt-1');
        expect(eq2).toHaveBeenCalledWith('owner_auth_user_id', 'auth-id');
    });

    it('deleteAlt removes only an owned alt row', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const del = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ delete: del });

        await deleteAlt('alt-1', 'auth-id');

        expect(del).toHaveBeenCalled();
        expect(eq1).toHaveBeenCalledWith('id', 'alt-1');
        expect(eq2).toHaveBeenCalledWith('owner_auth_user_id', 'auth-id');
    });
});
