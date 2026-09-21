import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CommunityRecommendations } from '../CommunityRecommendations';
import type { Ship } from '../../../types/ship';
import type { CustomFormula } from '../../../types/autogear';
import type { ShipTypeName } from '../../../constants';

vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => {} }));
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId: 'profile-1' }),
}));

// The share/no-share copy is decided by `canShare` (real hook, exercised in
// useCommunityRecommendations.test.ts) plus the props this component reads directly
// (`shipRole`, `customFormula`) for the explanatory message. Mocking the hook isolates
// that message logic from fetching/voting, which this file is not about.
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
    shipRole: ShipTypeName | null,
    customFormula?: CustomFormula
) => {
    useCommunityRecommendationsMock.mockReturnValue({ ...baseHookReturn, canShare });
    render(
        <CommunityRecommendations
            selectedShip={makeShip()}
            currentBuild={null}
            shipRole={shipRole}
            customFormula={customFormula}
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
        renderPanel(true, null, {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
            seededFrom: 'ATTACKER',
        });

        expect(screen.getByRole('button', { name: 'Share your build' })).toBeInTheDocument();
    });

    it('never shows the old "no field for it" message', () => {
        renderPanel(false, null, {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
        });

        expect(screen.queryByText(/library has no field for/i)).not.toBeInTheDocument();
    });

    it('explains the unmirrorable-formula case accurately: a usable formula with no seed', () => {
        renderPanel(false, null, {
            rows: [{ stat: 'attack', kind: 'core', direction: 'max', importance: 1 }],
        });

        expect(screen.getByText(/no role to file it under yet/i)).toBeInTheDocument();
    });

    it('falls back to the generic message for an unconfigured Custom-mode ship', () => {
        renderPanel(false, null, { rows: [] });

        expect(
            screen.getByText('Configure autogear settings to share your build')
        ).toBeInTheDocument();
        expect(screen.queryByText(/no role to file it under yet/i)).not.toBeInTheDocument();
    });
});
