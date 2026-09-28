import { describe, it, expect } from 'vitest';
import { listProfiles } from '../tools/profiles';
import { ALT_PROFILE, AUTH_USER, STRANGER, call, ctxOver } from './fixtures';

const users = [
    { id: ALT_PROFILE, username: 'alt', in_game_id: '2', owner_auth_user_id: AUTH_USER },
    { id: STRANGER, username: 'other', in_game_id: '3', owner_auth_user_id: null },
    { id: AUTH_USER, username: 'main', in_game_id: '1', owner_auth_user_id: null },
];

describe('list_profiles', () => {
    it('lists the main account first, then its alts, and nobody else', async () => {
        const { ctx } = ctxOver({ users });

        expect(await call(listProfiles, {}, ctx)).toEqual({
            profiles: [
                { id: AUTH_USER, username: 'main', in_game_id: '1', is_main: true },
                { id: ALT_PROFILE, username: 'alt', in_game_id: '2', is_main: false },
            ],
        });
    });

    it('uses the altAccountService predicate', async () => {
        const { ctx, calls } = ctxOver({ users });

        await call(listProfiles, {}, ctx);

        expect(calls).toContainEqual({
            table: 'users',
            method: 'or',
            args: [`id.eq.${AUTH_USER},owner_auth_user_id.eq.${AUTH_USER}`],
        });
    });
});
