import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SharedBuildFields } from '../SharedBuildFields';
import type { SharedAutogearBuild } from '../../../types/communityRecommendation';

const baseBuild: SharedAutogearBuild = {
    version: 2,
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    fleetBuffs: [],
    excludedImplantTypes: [],
    optimizeImplants: false,
};

describe('SharedBuildFields', () => {
    it('renders a null shipRole (a role-less Custom build) as "Custom" rather than crashing', () => {
        render(<SharedBuildFields build={baseBuild} />);
        expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    it('renders a real role by its display name', () => {
        render(<SharedBuildFields build={{ ...baseBuild, shipRole: 'ATTACKER' }} />);
        expect(screen.queryByText('Custom')).not.toBeInTheDocument();
    });
});
