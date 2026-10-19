import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { AuthUser } from '../../services/auth/types';
import { StorageKey } from '../../constants/storage';
import { AuthProvider, useAuth } from '../AuthProvider';

let emit: (u: AuthUser | null) => void = () => {};
const signInAnonymously = vi.fn();
vi.mock('../../services/auth/supabaseAuth', () => ({
    SupabaseAuthService: class {
        onAuthStateChanged(cb: (u: AuthUser | null) => void) {
            emit = cb;
            return () => {};
        }
        signInAnonymously = (...a: unknown[]) => signInAnonymously(...a);
    },
}));
const usersSelect = vi.fn();
const getSession = vi.fn();
vi.mock('../../config/supabase', () => ({
    supabase: {
        from: () => ({ select: () => ({ eq: () => ({ single: usersSelect }) }) }),
        auth: { getSession: () => getSession() },
    },
}));
const heartbeat = vi.fn();
vi.mock('../../services/heartbeatService', () => ({
    updateHeartbeatUser: (id: string | null) => heartbeat(id),
}));
const migrate = vi.fn();
vi.mock('../../utils/migratePlayerData', () => ({
    migratePlayerData: (...a: unknown[]) => migrate(...a),
    syncMigratedDataToSupabase: vi.fn(),
}));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));
vi.mock('../../hooks/useStorage', () => ({ removeFromIndexedDB: vi.fn() }));

let guestSignIn: () => Promise<string> = async () => '';
const Probe = () => {
    const { user, guestUserId, signInAsGuest } = useAuth();
    guestSignIn = signInAsGuest;
    return <div>{`user=${user?.id ?? 'none'} guest=${guestUserId ?? 'none'}`}</div>;
};

const events: string[] = [];
const record = (e: Event) => events.push(e.type);

describe('AuthProvider with an anonymous session', () => {
    beforeEach(() => {
        events.length = 0;
        window.addEventListener('app:migration:start', record);
        window.addEventListener('app:signout', record);
        signInAnonymously.mockReset();
        localStorage.clear();
        heartbeat.mockClear();
        migrate.mockClear();
        usersSelect.mockReset();
        getSession.mockReset();
        getSession.mockResolvedValue({ data: { session: null } });
    });

    afterEach(() => {
        window.removeEventListener('app:migration:start', record);
        window.removeEventListener('app:signout', record);
    });

    it('exposes the guest uid, keeps user null, and runs no account side effects', async () => {
        localStorage.setItem(StorageKey.DEMO_DATA_LOADED, 'true');
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await act(async () =>
            emit({ id: 'g1', email: null, displayName: null, photoURL: null, isAnonymous: true })
        );
        await waitFor(() => expect(screen.getByText('user=none guest=g1')).toBeTruthy());
        expect(usersSelect).not.toHaveBeenCalled();
        expect(migrate).not.toHaveBeenCalled();
        expect(heartbeat).not.toHaveBeenCalledWith('g1');
        expect(localStorage.getItem(StorageKey.DEMO_DATA_LOADED)).toBe('true');
        expect(events).toEqual([]);

        // The guest session ending is not a sign-out of an account.
        await act(async () => emit(null));
        await waitFor(() => expect(screen.getByText('user=none guest=none')).toBeTruthy());
        expect(events).toEqual([]);
    });

    it('refuses a guest sign-in while an account is signed in', async () => {
        usersSelect.mockResolvedValue({ data: null, error: null });
        signInAnonymously.mockResolvedValue({ id: 'g2' });
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await act(async () =>
            emit({
                id: 'u1',
                email: 'a@b.c',
                displayName: null,
                photoURL: null,
                isAnonymous: false,
            })
        );
        await waitFor(() => expect(screen.getByText('user=u1 guest=none')).toBeTruthy());
        await expect(guestSignIn()).rejects.toThrow();
        expect(signInAnonymously).not.toHaveBeenCalled();
    });

    it('refuses a guest sign-in when the stored session is an account the UI has not loaded yet', async () => {
        getSession.mockResolvedValue({
            data: { session: { user: { id: 'u1', is_anonymous: false } } },
        });
        signInAnonymously.mockResolvedValue({ id: 'g2' });
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await expect(guestSignIn()).rejects.toThrow();
        expect(signInAnonymously).not.toHaveBeenCalled();
    });

    it('reuses an existing anonymous session instead of minting another', async () => {
        getSession.mockResolvedValue({
            data: { session: { user: { id: 'g9', is_anonymous: true } } },
        });
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await expect(guestSignIn()).resolves.toBe('g9');
        expect(signInAnonymously).not.toHaveBeenCalled();
    });
});
