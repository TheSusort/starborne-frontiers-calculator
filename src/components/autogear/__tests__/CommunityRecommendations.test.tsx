import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CommunityRecommendations } from '../CommunityRecommendations';
import type { Ship } from '../../../types/ship';

vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => {} }));
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

// The share/no-share copy is decided entirely by `canShare` (real hook, exercised in
// useCommunityRecommendations.test.ts) now that a role-less usable formula shares too —
// there is no longer a component-local "no role to file it under yet" case. Mocking the
// hook isolates that message logic from fetching/voting, which this file is not about.
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

const renderPanel = (canShare: boolean) => {
    useCommunityRecommendationsMock.mockReturnValue({ ...baseHookReturn, canShare });
    render(
        <CommunityRecommendations
            selectedShip={makeShip()}
            currentBuild={null}
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
});
