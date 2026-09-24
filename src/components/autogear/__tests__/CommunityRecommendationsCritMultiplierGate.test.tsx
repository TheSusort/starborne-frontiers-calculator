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

const renderPanel = (currentBuild: SharedAutogearBuild | null) => {
    // The real hook would set canShare=false once ALLOW_CRIT_MULTIPLIER_COMMUNITY_SHARE
    // blocks configToSharedBuild from an eventual roleless flip; here it's mocked to `true`
    // (currentBuild is non-null and has a role) so the ONLY thing that can be withholding the
    // button is this component's own crit-multiplier check on `currentBuild`.
    useCommunityRecommendationsMock.mockReturnValue({ ...baseHookReturn, canShare: true });
    render(
        <CommunityRecommendations
            selectedShip={makeShip()}
            currentBuild={currentBuild}
            shipRole="ATTACKER"
            customFormula={undefined}
            onApplyBuild={null}
            hasExistingConfig={false}
        />
    );
    act(() => {
        screen.getByRole('button', { name: /no community builds yet/i }).click();
    });
};

describe('CommunityRecommendations — crit multiplier share gate', () => {
    it('withholds the Share button and explains why for a build referencing critMultiplier', () => {
        renderPanel(critMultiplierBuild);

        expect(screen.queryByRole('button', { name: 'Share your build' })).not.toBeInTheDocument();
        expect(screen.getByText(/crit multiplier/i)).toBeInTheDocument();
    });

    it('shows the Share button for a build with no critMultiplier reference', () => {
        renderPanel({ ...critMultiplierBuild, statBonuses: [] });

        expect(screen.getByRole('button', { name: 'Share your build' })).toBeInTheDocument();
    });
});
