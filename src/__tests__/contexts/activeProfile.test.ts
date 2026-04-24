import { describe, it, expect } from 'vitest';
import { resolveActiveProfileId } from '../../contexts/ActiveProfileProvider';
import type { ProfileRow } from '../../services/altAccountService';

const main: ProfileRow = {
    id: 'auth-id',
    username: 'me',
    is_public: true,
    owner_auth_user_id: null,
    in_game_id: null,
    email: 'x@y',
    is_admin: false,
    created_at: '',
    updated_at: '',
};
const alt: ProfileRow = {
    id: 'alt-1',
    username: 'alt',
    is_public: false,
    owner_auth_user_id: 'auth-id',
    in_game_id: null,
    email: null,
    is_admin: false,
    created_at: '',
    updated_at: '',
};

describe('resolveActiveProfileId', () => {
    it('returns auth.uid() when no stored id', () => {
        expect(resolveActiveProfileId('auth-id', null, [main])).toBe('auth-id');
    });

    it('returns the stored id when it appears in the list', () => {
        expect(resolveActiveProfileId('auth-id', 'alt-1', [main, alt])).toBe('alt-1');
    });

    it('falls back to auth.uid() when stored id is missing from the list', () => {
        expect(resolveActiveProfileId('auth-id', 'alt-deleted', [main])).toBe('auth-id');
    });

    it('falls back to auth.uid() when stored id equals auth.uid()', () => {
        expect(resolveActiveProfileId('auth-id', 'auth-id', [main])).toBe('auth-id');
    });

    it('returns null when no auth user', () => {
        expect(resolveActiveProfileId(null, 'whatever', [])).toBeNull();
    });
});
