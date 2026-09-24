import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CommunityRecommendations } from '../CommunityRecommendations';
import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants';
import type { CustomFormula } from '../../../types/autogear';

vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => {} }));
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

// `canShare` (real hook, exercised in useCommunityRecommendations.test.ts) decides whether
// the Share button shows. When it is false, this component still distinguishes "nothing
// configured" from "a role-less but otherwise usable formula, withheld by
// ALLOW_ROLELESS_COMMUNITY_SHARE" via its own shipRole/customFormula props — mocking the
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

const renderPanel = (
    canShare: boolean,
    fields: { shipRole?: ShipTypeName | null; customFormula?: CustomFormula } = {}
) => {
    useCommunityRecommendationsMock.mockReturnValue({ ...baseHookReturn, canShare });
    render(
        <CommunityRecommendations
            selectedShip={makeShip()}
            currentBuild={null}
            shipRole={fields.shipRole ?? null}
            customFormula={fields.customFormula}
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

    it('explains a role-less but usable formula cannot be shared yet, withheld by the gate', () => {
        renderPanel(false, {
            shipRole: null,
            customFormula: {
                rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
            },
        });

        expect(
            screen.getByText(/this formula has no role to file it under yet/i)
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Share your build' })).not.toBeInTheDocument();
    });

    it('does not show the role-less-formula message once the formula is seeded from a role', () => {
        renderPanel(false, {
            shipRole: null,
            customFormula: {
                seededFrom: 'ATTACKER',
                rows: [{ stat: 'attack', kind: 'core', direction: 'max' }],
            },
        });

        expect(
            screen.queryByText(/this formula has no role to file it under yet/i)
        ).not.toBeInTheDocument();
        expect(
            screen.getByText('Configure autogear settings to share your build')
        ).toBeInTheDocument();
    });
});
