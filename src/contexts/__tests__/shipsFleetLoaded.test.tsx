import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ShipsProvider, useShips } from '../ShipsContext';
import { fetchShips } from '../../services/fleetReads';
import type { Ship } from '../../types/ship';

const { profile, notify } = vi.hoisted(() => ({
    profile: { id: null as string | null },
    notify: vi.fn(),
}));

vi.mock('../../config/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: notify }),
}));
vi.mock('../ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: profile.id, profilesLoading: false }),
    PROFILE_SWITCH_EVENT: 'app:profile:switch',
}));
vi.mock('../../services/fleetReads', () => ({ fetchShips: vi.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ShipsProvider>{children}</ShipsProvider>
);

/** A `fetchShips` that resolves only when the test says so. */
const deferredFetch = () => {
    let resolve: (ships: Ship[]) => void = () => {};
    vi.mocked(fetchShips).mockImplementation(() => new Promise<Ship[]>((r) => (resolve = r)));
    return (ships: Ship[]) => resolve(ships);
};

describe('ShipsContext fleetLoaded', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.mocked(fetchShips).mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is true at once for a signed-out player', () => {
        profile.id = null;
        const { result } = renderHook(() => useShips(), { wrapper });
        expect(result.current.fleetLoaded).toBe(true);
    });

    it('is false for a signed-in profile until its first fetch completes', async () => {
        profile.id = 'p1';
        const finish = deferredFetch();
        const { result } = renderHook(() => useShips(), { wrapper });
        expect(result.current.ships).toEqual([]);
        expect(result.current.fleetLoaded).toBe(false);
        await waitFor(() => expect(fetchShips).toHaveBeenCalled());
        expect(result.current.fleetLoaded).toBe(false);
        await act(async () => finish([]));
        await waitFor(() => expect(result.current.fleetLoaded).toBe(true));
    });

    it('is true after a failed fetch, so a fetch error never leaves it pending', async () => {
        profile.id = 'p1';
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(fetchShips).mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useShips(), { wrapper });
        await waitFor(() => expect(result.current.fleetLoaded).toBe(true));
    });

    it('is false again for a newly active profile until its own fetch completes', async () => {
        profile.id = 'p1';
        vi.mocked(fetchShips).mockResolvedValue([]);
        const { result, rerender } = renderHook(() => useShips(), { wrapper });
        await waitFor(() => expect(result.current.fleetLoaded).toBe(true));
        const finish = deferredFetch();
        profile.id = 'p2';
        rerender();
        expect(result.current.fleetLoaded).toBe(false);
        await act(async () => finish([]));
        await waitFor(() => expect(result.current.fleetLoaded).toBe(true));
    });

    it('stays true when a stale fetch for the previous profile finishes last', async () => {
        const resolvers: Record<string, (ships: Ship[]) => void> = {};
        vi.mocked(fetchShips).mockImplementation(
            (_client, id) => new Promise<Ship[]>((r) => (resolvers[id] = r))
        );
        profile.id = 'p1';
        const { result, rerender } = renderHook(() => useShips(), { wrapper });
        await waitFor(() => expect(resolvers.p1).toBeDefined());
        profile.id = 'p2';
        rerender();
        await waitFor(() => expect(resolvers.p2).toBeDefined());
        await act(async () => resolvers.p2([]));
        await waitFor(() => expect(result.current.fleetLoaded).toBe(true));
        await act(async () => resolvers.p1([]));
        expect(result.current.fleetLoaded).toBe(true);
    });
});
