import { describe, it, expect } from 'vitest';
import { splitAuthUser } from '../splitAuthUser';

const base = { id: 'u1', email: null, displayName: null, photoURL: null };

describe('splitAuthUser', () => {
    it('keeps an account as the user', () => {
        expect(splitAuthUser({ ...base, email: 'a@b.c' })).toEqual({
            user: { ...base, email: 'a@b.c' },
            guestUserId: null,
        });
    });
    it('moves an anonymous session to guestUserId and leaves user null', () => {
        expect(splitAuthUser({ ...base, isAnonymous: true })).toEqual({
            user: null,
            guestUserId: 'u1',
        });
    });
    it('maps no session to neither', () => {
        expect(splitAuthUser(null)).toEqual({ user: null, guestUserId: null });
    });
});
