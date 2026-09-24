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

    it('renders a Formula section for a build carrying a customFormula', () => {
        render(
            <SharedBuildFields
                build={{
                    ...baseBuild,
                    customFormula: {
                        rows: [
                            {
                                stat: 'directDamage',
                                kind: 'core',
                                direction: 'max',
                                basis: [{ stat: 'attack', weight: 2.1 }],
                            },
                            { stat: 'hp', kind: 'bonus', direction: 'min' },
                        ],
                    },
                }}
            />
        );
        expect(screen.getByText('Formula')).toBeInTheDocument();
        const rows = screen.getAllByTestId('community-build-formula-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Core');
        expect(rows[0]).toHaveTextContent('Direct Damage');
        expect(rows[0]).toHaveTextContent('Attack x2.100');
        expect(rows[1]).toHaveTextContent('Bonus');
        expect(rows[1]).toHaveTextContent('as little as possible');
    });

    it('renders no Formula section for a build with no customFormula', () => {
        render(<SharedBuildFields build={baseBuild} />);
        expect(screen.queryByText('Formula')).not.toBeInTheDocument();
    });

    it('renders an Equation section for a build carrying a roleBasis', () => {
        render(
            <SharedBuildFields
                build={{
                    ...baseBuild,
                    shipRole: 'ATTACKER',
                    roleBasis: {
                        produces: 'damage',
                        terms: [
                            { stat: 'attack', weight: 2.1 },
                            { stat: 'hp', weight: 0.267 },
                        ],
                    },
                }}
            />
        );
        const equation = screen.getByTestId('community-build-equation');
        expect(equation).toHaveTextContent('Scores damage as: Attack x2.100 + HP x0.267');
    });

    it('renders no Equation section for a build with no roleBasis', () => {
        render(<SharedBuildFields build={baseBuild} />);
        expect(screen.queryByTestId('community-build-equation')).not.toBeInTheDocument();
    });
});
