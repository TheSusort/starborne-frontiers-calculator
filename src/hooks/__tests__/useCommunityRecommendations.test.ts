import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCommunityRecommendations } from '../useCommunityRecommendations';
import type { Ship } from '../../types/ship';
import type {
    CommunityRecommendation,
    SharedAutogearBuild,
} from '../../types/communityRecommendation';

vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({ getGearPiece: () => undefined }),
}));
vi.mock('../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

const listForShipMock = vi.fn();
const getUserVoteMock = vi.fn();
const createRecommendationMock = vi.fn();
const voteOnRecommendationMock = vi.fn();
const removeVoteMock = vi.fn();

vi.mock('../../services/communityRecommendations', () => ({
    CommunityRecommendationService: {
        listForShip: (...args: unknown[]) => listForShipMock(...args),
        getUserVote: (...args: unknown[]) => getUserVoteMock(...args),
        createRecommendation: (...args: unknown[]) => createRecommendationMock(...args),
        voteOnRecommendation: (...args: unknown[]) => voteOnRecommendationMock(...args),
        removeVote: (...args: unknown[]) => removeVoteMock(...args),
    },
}));

const makeShip = (id: string, name: string): Ship => ({ id, name }) as Ship;

const makeRow = (id: string, shipName: string): CommunityRecommendation => ({
    id,
    ship_name: shipName,
    ship_refit_level: 0,
    title: `Build ${id}`,
    is_implant_specific: false,
    ship_role: 'ATTACKER',
    stat_priorities: [],
    stat_bonuses: [],
    set_priorities: [],
    upvotes: 0,
    downvotes: 0,
    total_votes: 0,
    score: 0,
    created_at: '2026-08-01T00:00:00Z',
});

const sampleBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

/** Resolves once every already-queued microtask has run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('useCommunityRecommendations — stale-ship fetch guard (Finding 1)', () => {
    it('fetches the newly selected ship even when the previous ship is still in flight, and discards the stale response', async () => {
        const shipA = makeShip('1', 'Ares');
        const shipB = makeShip('2', 'Vantage');

        const deferredA = createDeferred<CommunityRecommendation[]>();
        const deferredB = createDeferred<CommunityRecommendation[]>();

        listForShipMock.mockImplementation((name: string) => {
            if (name === 'Ares') return deferredA.promise;
            if (name === 'Vantage') return deferredB.promise;
            throw new Error(`unexpected ship name ${name}`);
        });

        const { result, rerender } = renderHook(
            (props: { selectedShip: Ship | null }) =>
                useCommunityRecommendations({
                    selectedShip: props.selectedShip,
                    currentBuild: null,
                }),
            { initialProps: { selectedShip: shipA } }
        );

        expect(listForShipMock).toHaveBeenCalledWith('Ares');

        // Switch the slot to a different ship before A's fetch has resolved —
        // the reachable scenario from AutogearQuickSettings.tsx keying rows by
        // array index rather than ship id.
        rerender({ selectedShip: shipB });

        // The defect this pins: with the old isFetchingRef guard still gating
        // the effect, this fetch is never started and the panel is stranded
        // on ship A's builds indefinitely.
        expect(listForShipMock).toHaveBeenCalledWith('Vantage');

        // A's fetch resolves late. It must not strand the panel on ship A's
        // builds nor flash them under ship B's name.
        await act(async () => {
            deferredA.resolve([makeRow('a-row', 'Ares')]);
            await flush();
        });

        expect(result.current.builds.map((b) => b.id)).not.toContain('a-row');

        await act(async () => {
            deferredB.resolve([makeRow('b-row', 'Vantage')]);
            await flush();
        });

        expect(result.current.builds.map((b) => b.id)).toEqual(['b-row']);
        expect(result.current.loading).toBe(false);
    });
});

describe('useCommunityRecommendations — handleShare success reporting (Finding 3)', () => {
    it('reports success even when the post-share refresh throws', async () => {
        const ship = makeShip('1', 'Ares');
        listForShipMock.mockResolvedValueOnce([]); // initial mount fetch
        createRecommendationMock.mockResolvedValueOnce(makeRow('new-rec', 'Ares'));
        listForShipMock.mockRejectedValueOnce(new Error('network blip')); // refresh() after share

        const { result } = renderHook(() =>
            useCommunityRecommendations({ selectedShip: ship, currentBuild: sampleBuild })
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        let shareResult: boolean | undefined;
        await act(async () => {
            shareResult = await result.current.handleShare('Title', 'Description', false);
        });

        expect(shareResult).toBe(true);
        expect(result.current.error).toBeNull();
        expect(result.current.showShareForm).toBe(false);
    });

    it('reports failure when the share itself fails, not when only the refresh fails', async () => {
        const ship = makeShip('1', 'Ares');
        listForShipMock.mockResolvedValueOnce([]); // initial mount fetch
        createRecommendationMock.mockResolvedValueOnce(null);

        const { result } = renderHook(() =>
            useCommunityRecommendations({ selectedShip: ship, currentBuild: sampleBuild })
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        let shareResult: boolean | undefined;
        await act(async () => {
            shareResult = await result.current.handleShare('Title', 'Description', false);
        });

        expect(shareResult).toBe(false);
        expect(result.current.error).toBe(
            'Failed to share recommendation. Please make sure you are signed in.'
        );
    });
});

describe('useCommunityRecommendations — toggleExpanded vote race (Finding 4)', () => {
    it('does not let a stale vote response overwrite the vote for the currently expanded row', async () => {
        const ship = makeShip('1', 'Ares');
        listForShipMock.mockResolvedValueOnce([
            makeRow('build-a', 'Ares'),
            makeRow('build-b', 'Ares'),
        ]);

        const deferredVoteA = createDeferred<'upvote' | 'downvote' | null>();
        const deferredVoteB = createDeferred<'upvote' | 'downvote' | null>();
        getUserVoteMock.mockImplementation((id: string) => {
            if (id === 'build-a') return deferredVoteA.promise;
            if (id === 'build-b') return deferredVoteB.promise;
            throw new Error(`unexpected id ${id}`);
        });

        const { result } = renderHook(() =>
            useCommunityRecommendations({ selectedShip: ship, currentBuild: null })
        );

        await waitFor(() => expect(result.current.builds).toHaveLength(2));

        act(() => result.current.toggleExpanded('build-a'));
        act(() => result.current.toggleExpanded('build-b')); // switch expansion before A's vote resolves

        // B's vote resolves first.
        await act(async () => {
            deferredVoteB.resolve('upvote');
            await flush();
        });
        expect(result.current.userVote).toBe('upvote');

        // A's vote resolves late, for a row that is no longer expanded.
        await act(async () => {
            deferredVoteA.resolve('downvote');
            await flush();
        });

        expect(result.current.expandedId).toBe('build-b');
        expect(result.current.userVote).toBe('upvote');
    });
});
