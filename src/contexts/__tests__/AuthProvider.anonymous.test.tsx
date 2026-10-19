import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { AuthUser } from '../../services/auth/types';
import { StorageKey } from '../../constants/storage';

let emit: (u: AuthUser | null) => void = () => {};
vi.mock('../../services/auth/supabaseAuth', () => ({
    SupabaseAuthService: class {
        onAuthStateChanged(cb: (u: AuthUser | null) => void) {
            emit = cb;
            return () => {};
        }
        signInAnonymously = vi.fn();
    },
}));
const usersSelect = vi.fn();
vi.mock('../../config/supabase', () => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: usersSelect }) }) }) },
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

import { AuthProvider, useAuth } from '../AuthProvider';

const Probe = () => {
    const { user, guestUserId } = useAuth();
    return <div>{`user=${user?.id ?? 'none'} guest=${guestUserId ?? 'none'}`}</div>;
};

describe('AuthProvider with an anonymous session', () => {
    beforeEach(() => {
        localStorage.clear();
        heartbeat.mockClear();
        migrate.mockClear();
        usersSelect.mockReset();
    });

    it('exposes the guest uid, keeps user null, and runs no account side effects', async () => {
        localStorage.setItem(StorageKey.DEMO_DATA_LOADED, 'true');
        const events: string[] = [];
        const record = (e: Event) => events.push(e.type);
        window.addEventListener('app:migration:start', record);
        window.addEventListener('app:signout', record);
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
        window.removeEventListener('app:migration:start', record);
        window.removeEventListener('app:signout', record);
    });
});
