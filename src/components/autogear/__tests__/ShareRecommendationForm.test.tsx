import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen } from '../../../test-utils/test-utils';
import { ShareRecommendationForm } from '../ShareRecommendationForm';
import type { SharedAutogearBuild } from '../../../types/communityRecommendation';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const fullBuild: SharedAutogearBuild = {
    version: 1,
    shipRole: 'ATTACKER',
    statPriorities: [{ stat: 'crit', minLimit: 100 }],
    setPriorities: [{ setName: 'CRITICAL', count: 4 }],
    statBonuses: [{ stat: 'attack', percentage: 30, mode: 'additive' }],
    fleetBuffs: [{ stat: 'speed', percentage: 15 }],
    excludedImplantTypes: ['MARTYRDOM'],
    optimizeImplants: true,
};

const renderForm = (
    build: SharedAutogearBuild,
    props: Partial<React.ComponentProps<typeof ShareRecommendationForm>> = {}
) =>
    render(
        <ShareRecommendationForm
            build={build}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            ultimateImplantName={null}
            {...props}
        />
    );

describe('ShareRecommendationForm preview', () => {
    it('shows the role', () => {
        renderForm(fullBuild);
        expect(screen.getByText('Attacker')).toBeInTheDocument();
    });

    it('shows fleet buffs — the field this preview previously omitted', () => {
        renderForm(fullBuild);
        expect(screen.getByText(/Fleet Buffs/i)).toBeInTheDocument();
        expect(screen.getByTestId('community-build-fleet-buff').textContent).toContain('Speed');
    });

    it('shows excludedImplantTypes and optimizeImplants — also previously omitted', () => {
        renderForm(fullBuild);
        expect(screen.getByText(/Optimize implants/i)).toBeInTheDocument();
        expect(screen.getByText(/Martyrdom/i)).toBeInTheDocument();
    });

    it('shows gear set priorities and limit-carrying stat priorities', () => {
        renderForm(fullBuild);
        expect(screen.getByTestId('community-build-set').textContent).toContain('4 pieces');
        expect(screen.getByTestId('community-build-priority').textContent).toContain('min: 100');
    });

    it('omits fleet buffs / implants sections entirely when the build has none of them', () => {
        renderForm({
            ...fullBuild,
            fleetBuffs: [],
            excludedImplantTypes: [],
            optimizeImplants: false,
        });
        expect(screen.queryByText(/Fleet Buffs/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Optimize implants/i)).not.toBeInTheDocument();
    });
});
