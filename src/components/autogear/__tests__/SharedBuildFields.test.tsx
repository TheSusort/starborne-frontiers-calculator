import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SharedBuildFields } from '../SharedBuildFields';
import type { SharedAutogearBuild } from '../../../types/communityRecommendation';
import type { ShipTypeName } from '../../../constants/shipTypes';

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

    it('renders no Equation section when the configured role does not host the roleBasis axis', () => {
        // DEFENDER hosts nothing (roleBasisHost.ts) — the scorer ignores this roleBasis
        // entirely, so an old row carrying one from before this rule shipped must not display
        // "Scores damage as..." copy the role never reads.
        render(
            <SharedBuildFields
                build={{
                    ...baseBuild,
                    shipRole: 'DEFENDER',
                    roleBasis: {
                        produces: 'damage',
                        terms: [{ stat: 'attack', weight: 2.1 }],
                    },
                }}
            />
        );
        expect(screen.queryByTestId('community-build-equation')).not.toBeInTheDocument();
    });

    it('renders without throwing, and with no Equation section, for a shipRole that no longer names a real role', () => {
        expect(() =>
            render(
                <SharedBuildFields
                    build={{
                        ...baseBuild,
                        shipRole: 'RETIRED_ROLE' as ShipTypeName,
                        roleBasis: {
                            produces: 'damage',
                            terms: [{ stat: 'attack', weight: 2.1 }],
                        },
                    }}
                />
            )
        ).not.toThrow();
        expect(screen.queryByTestId('community-build-equation')).not.toBeInTheDocument();
    });

    it("shows a Formula bonus row's percentage rather than hiding it", () => {
        render(
            <SharedBuildFields
                build={{
                    ...baseBuild,
                    customFormula: {
                        rows: [{ stat: 'hp', kind: 'bonus', direction: 'max', percentage: 42 }],
                    },
                }}
            />
        );
        expect(screen.getByTestId('community-build-formula-row')).toHaveTextContent('42%');
    });

    it('never renders a nonzero equation weight as x0.000', () => {
        render(
            <SharedBuildFields
                build={{
                    ...baseBuild,
                    shipRole: 'ATTACKER',
                    roleBasis: {
                        produces: 'damage',
                        // The schema's own MIN_NUMBER_MAGNITUDE floor (1e-6) — small enough to
                        // round to "0.000" under toFixed(3), but still a real authored weight.
                        terms: [{ stat: 'attack', weight: 0.000001 }],
                    },
                }}
            />
        );
        const equation = screen.getByTestId('community-build-equation');
        expect(equation).not.toHaveTextContent('x0.000');
    });
});
