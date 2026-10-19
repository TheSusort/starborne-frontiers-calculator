import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useArcadeSubmission } from '../useArcadeSubmission';
import { GuestNameTakenError } from '../../../services/arcadeService';

const auth = {
    user: null as null | { id: string },
    loading: false,
    guestUserId: null as string | null,
    signInAsGuest: vi.fn(),
};
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../../services/userProfileService', () => ({ getUserProfile: vi.fn() }));
const submit = vi.fn();
const ownName = vi.fn();
vi.mock('../../../services/arcadeService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/arcadeService')>(
        '../../../services/arcadeService'
    );
    return {
        ...actual,
        submitArcadeScore: (...a: unknown[]) => submit(...a),
        getOwnGuestName: (...a: unknown[]) => ownName(...a),
    };
});

const finished = { result: { score: 10, credits: 1, distance: 5 } as never, shipName: 'Atlas' };

describe('useArcadeSubmission (guests)', () => {
    beforeEach(() => {
        auth.user = null;
        auth.loading = false;
        auth.guestUserId = null;
        auth.signInAsGuest.mockReset();
        submit.mockReset();
        ownName.mockReset();
    });

    it('invites a visitor with no session, and only signs in when a name is saved', async () => {
        const { result } = renderHook(() => useArcadeSubmission(finished));
        expect(result.current.status).toBe('guest-invite');
        act(() => result.current.joinAsGuest());
        expect(result.current.status).toBe('needs-guest-name');
        expect(auth.signInAsGuest).not.toHaveBeenCalled();

        auth.signInAsGuest.mockResolvedValue('g1');
        submit.mockResolvedValue({ bestScore: 10, rank: 4 });
        let outcome: string | undefined;
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace');
        });
        expect(outcome).toBe('saved');
        expect(auth.signInAsGuest).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(finished.result, 'Atlas', 'Ace');
        expect(result.current.status).toBe('submitted');
        expect(result.current.rank).toBe(4);
    });

    it('keeps the same guest session when the name is taken', async () => {
        const { result } = renderHook(() => useArcadeSubmission(finished));
        act(() => result.current.joinAsGuest());
        auth.signInAsGuest.mockImplementation(async () => {
            auth.guestUserId = 'g1';
            return 'g1';
        });
        submit.mockRejectedValueOnce(new GuestNameTakenError('guest_name_taken'));
        let outcome: string | undefined;
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace');
        });
        expect(outcome).toBe('taken');
        // The status never left 'needs-guest-name', so the modal stayed open with the typed name.
        expect(result.current.status).toBe('needs-guest-name');

        submit.mockResolvedValue({ bestScore: 10, rank: 1 });
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace2');
        });
        expect(outcome).toBe('saved');
        expect(auth.signInAsGuest).toHaveBeenCalledTimes(1);
    });

    it('auto-submits a returning guest who has a name', async () => {
        auth.guestUserId = 'g1';
        ownName.mockResolvedValue('Ace');
        submit.mockResolvedValue({ bestScore: 10, rank: 2 });
        const { result } = renderHook(() => useArcadeSubmission(finished));
        await waitFor(() => expect(result.current.status).toBe('submitted'));
        expect(submit).toHaveBeenCalledWith(finished.result, 'Atlas');
    });

    it('asks a guest session with no name for one', async () => {
        auth.guestUserId = 'g1';
        ownName.mockResolvedValue(null);
        const { result } = renderHook(() => useArcadeSubmission(finished));
        await waitFor(() => expect(result.current.status).toBe('needs-guest-name'));
        expect(submit).not.toHaveBeenCalled();
    });

    it('never signs in as a guest while an account is signed in', async () => {
        auth.user = { id: 'u1' };
        const { result } = renderHook(() => useArcadeSubmission(null));
        await act(async () => {
            await expect(result.current.saveGuestName('Ace')).rejects.toThrow();
        });
        expect(auth.signInAsGuest).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
    });

    it('reports checking, not the guest invite, while auth is still loading', async () => {
        auth.loading = true;
        const { result, rerender } = renderHook(() => useArcadeSubmission(finished));
        expect(result.current.status).toBe('checking');
        auth.loading = false;
        rerender();
        await waitFor(() => expect(result.current.status).toBe('guest-invite'));
    });

    it('does not reopen the modal when a taken-name reply lands after Skip', async () => {
        const { result } = renderHook(() => useArcadeSubmission(finished));
        act(() => result.current.joinAsGuest());
        auth.signInAsGuest.mockResolvedValue('g1');
        let reject: (e: unknown) => void = () => {};
        submit.mockReturnValue(new Promise((_, r) => (reject = r)));
        let pending: Promise<string> | undefined;
        act(() => {
            pending = result.current.saveGuestName('Ace');
        });
        await waitFor(() => expect(submit).toHaveBeenCalled());
        act(() => result.current.skip());
        await act(async () => {
            reject(new GuestNameTakenError('guest_name_taken'));
            await pending;
        });
        expect(result.current.status).toBe('skipped');
    });

    it('is a no-op for the identity change a join causes', async () => {
        const { result, rerender } = renderHook(() => useArcadeSubmission(finished));
        act(() => result.current.joinAsGuest());
        auth.signInAsGuest.mockResolvedValue('g1');
        let resolve: (v: unknown) => void = () => {};
        submit.mockReturnValue(new Promise((r) => (resolve = r)));
        let pending: Promise<string> | undefined;
        act(() => {
            pending = result.current.saveGuestName('Ace');
        });
        await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
        auth.guestUserId = 'g1';
        rerender();
        await act(async () => {
            resolve({ bestScore: 10, rank: 3 });
            await pending;
        });
        expect(submit).toHaveBeenCalledTimes(1);
        expect(ownName).not.toHaveBeenCalled();
        expect(result.current.status).toBe('submitted');
    });
});
