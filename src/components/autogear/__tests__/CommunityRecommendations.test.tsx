import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CommunityRecommendations } from '../CommunityRecommendations';
import type { Ship } from '../../../types/ship';
import type { SharedAutogearBuild } from '../../../types/communityRecommendation';

vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => {} }));
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

// `canShare` (real hook, exercised in useCommunityRecommendations.test.ts) is the sole
// decider of whether the Share button shows — mocking the hook isolates that from
// fetching/voting, which this file is not about.
const useCommunityRecommendationsMock = vi.fn();
vi.mock('../../../hooks/useCommunityRecommendations', () => ({
    useCommunityRecommendations: (...args: unknown[]) => useCommunityRecommendationsMock(...args),
}));

const baseHookReturn = {
    builds: [],
    loading: false,
    error: null,
    expandedId: null,
    toggleExpanded: () => {},
    sort: 'top' as const,
    setSort: () => {},
    userVote: null,
    handleVote: async () => {},
    showShareForm: false,
    setShowShareForm: () => {},
    ultimateImplantName: null,
    handleShare: async () => true,
};

const makeShip = (): Ship => ({ id: '1', name: 'Ares' }) as Ship;

const critMultiplierBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [],
    setPriorities: [],
    statBonuses: [{ stat: 'critMultiplier', percentage: 100, mode: 'multiplier' }],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

const renderPanel = (canShare: boolean, currentBuild: SharedAutogearBuild | null = null) => {
    useCommunityRecommendationsMock.mockReturnValue({ ...baseHookReturn, canShare });
    render(
        <CommunityRecommendations
            selectedShip={makeShip()}
            currentBuild={currentBuild}
            onApplyBuild={null}
            hasExistingConfig={false}
        />
    );
    // The panel starts collapsed; the share controls only render once expanded.
    // `builds` is always [] here, so the header reads "No community builds yet".
    act(() => {
        screen.getByRole('button', { name: /no community builds yet/i }).click();
    });
};

describe('CommunityRecommendations — share gate copy', () => {
    it('shows the share button when canShare is true, even with no role (Custom mode)', () => {
        renderPanel(true);

        expect(screen.getByRole('button', { name: 'Share your build' })).toBeInTheDocument();
    });

    it('never shows the old "no field for it" message', () => {
        renderPanel(false);

        expect(screen.queryByText(/library has no field for/i)).not.toBeInTheDocument();
    });

    it('falls back to the generic message when nothing can be shared', () => {
        renderPanel(false);

        expect(
            screen.getByText('Configure autogear settings to share your build')
        ).toBeInTheDocument();
    });

    // Tripwire against re-adding a client-side crit-multiplier gate: with both
    // ALLOW_ROLELESS_COMMUNITY_SHARE and ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE on, the
    // component no longer withholds the button/form for a build naming critMultiplier —
    // `canShare` (the hook's own verdict) is the only gate this component reads.
    it('shows the share button and form for a build referencing critMultiplier', () => {
        renderPanel(true, critMultiplierBuild);

        expect(screen.getByRole('button', { name: 'Share your build' })).toBeInTheDocument();
    });
});
