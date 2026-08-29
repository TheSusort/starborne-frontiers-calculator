import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { CommunityBuildDetails } from '../CommunityBuildDetails';
import type { CommunityBuild } from '../../../utils/communityBuild';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeBuild = (over: Partial<CommunityBuild['build']> = {}): CommunityBuild => ({
    id: 'r1',
    shipName: 'Ares',
    shipRefitLevel: 3,
    title: 'Crit Bruiser',
    description: 'caps crit',
    isImplantSpecific: false,
    upvotes: 10,
    downvotes: 1,
    score: 0.9,
    createdAt: '2026-08-01T00:00:00Z',
    isLegacy: false,
    build: {
        version: 1,
        shipRole: 'ATTACKER',
        statPriorities: [],
        setPriorities: [],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
        ...over,
    },
});

const renderDetails = (
    build: CommunityBuild,
    props: Partial<React.ComponentProps<typeof CommunityBuildDetails>> = {}
) => {
    const onApply = vi.fn();
    const onVote = vi.fn();
    render(
        <CommunityBuildDetails
            build={build}
            userVote={null}
            canVote
            canApply
            onVote={onVote}
            onApply={onApply}
            {...props}
        />
    );
    return { onApply, onVote };
};

describe('CommunityBuildDetails', () => {
    it('renders a stat priority with no limits as its stat name, not a blank row', () => {
        // STATS.critDamage.label is 'Crit Power', NOT 'Crit Damage' — verified in
        // src/constants/stats.ts:46. Asserting the wrong label here would pass
        // vacuously against a component that rendered nothing at all.
        renderDetails(makeBuild({ statPriorities: [{ stat: 'critDamage' }] }));
        expect(screen.getByTestId('community-build-priority').textContent).toContain('Crit Power');
    });

    it('renders stat priorities in payload order, because order is the priority', () => {
        renderDetails(
            makeBuild({ statPriorities: [{ stat: 'crit' }, { stat: 'speed' }, { stat: 'attack' }] })
        );
        const items = screen.getAllByTestId('community-build-priority');
        expect(items.map((el) => el.textContent)).toEqual([
            expect.stringContaining('Crit Rate'),
            expect.stringContaining('Speed'),
            expect.stringContaining('Attack'),
        ]);
    });

    it('renders min, max and hard requirement in the settings-panel wording', () => {
        renderDetails(
            makeBuild({
                statPriorities: [
                    { stat: 'crit', minLimit: 100, maxLimit: 200, hardRequirement: true },
                ],
            })
        );
        const row = screen.getByTestId('community-build-priority');
        expect(row.textContent).toContain('min: 100');
        expect(row.textContent).toContain('max: 200');
        expect(row.textContent).toContain('Hard Requirement');
    });

    it('distinguishes a 4-piece set from a 2-piece set', () => {
        renderDetails(makeBuild({ setPriorities: [{ setName: 'CRITICAL', count: 4 }] }));
        expect(screen.getByTestId('community-build-set').textContent).toContain('4 pieces');
    });

    it('names an implant-kind set priority with no piece count', () => {
        renderDetails(
            makeBuild({ setPriorities: [{ setName: 'MARTYRDOM', count: 1, kind: 'implant' }] })
        );
        const row = screen.getByTestId('community-build-set');
        expect(row.textContent).toContain('Martyrdom');
        expect(row.textContent).not.toContain('pieces');
    });

    it('distinguishes an additive bonus from a multiplier bonus', () => {
        renderDetails(
            makeBuild({
                statBonuses: [
                    { stat: 'attack', percentage: 30, mode: 'additive' },
                    { stat: 'speed', percentage: 50, mode: 'multiplier' },
                ],
            })
        );
        const rows = screen.getAllByTestId('community-build-bonus');
        expect(rows[0].textContent).toContain('Additive');
        expect(rows[1].textContent).toContain('Multiplier');
    });

    it('renders fleet buffs and implant settings', () => {
        renderDetails(
            makeBuild({
                fleetBuffs: [{ stat: 'attack', percentage: 30 }],
                excludedImplantTypes: ['MARTYRDOM'],
                optimizeImplants: true,
            })
        );
        expect(screen.getByText(/Fleet Buffs/i)).toBeInTheDocument();
        expect(screen.getByText(/Optimize implants/i)).toBeInTheDocument();
        expect(screen.getByText(/Martyrdom/)).toBeInTheDocument();
    });

    it('omits a section that has no entries', () => {
        renderDetails(makeBuild());
        expect(screen.queryByText(/Fleet Buffs/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Gear Sets/i)).not.toBeInTheDocument();
    });

    it('does not crash on an unknown stat key from a foreign payload', () => {
        expect(() =>
            renderDetails(makeBuild({ statBonuses: [{ stat: 'mystery', percentage: 5 }] }))
        ).not.toThrow();
    });

    it('calls onApply when Apply is clicked', () => {
        const { onApply } = renderDetails(makeBuild());
        fireEvent.click(screen.getByRole('button', { name: /apply to autogear/i }));
        expect(onApply).toHaveBeenCalledTimes(1);
    });

    it('calls onVote with the vote type', () => {
        const { onVote } = renderDetails(makeBuild());
        fireEvent.click(screen.getByRole('button', { name: /^helpful$/i }));
        expect(onVote).toHaveBeenCalledWith('upvote');
    });

    it('hides the vote buttons and shows a sign-in hint when the user cannot vote', () => {
        renderDetails(makeBuild(), { canVote: false });
        expect(screen.queryByRole('button', { name: /^helpful$/i })).not.toBeInTheDocument();
        expect(screen.getByText(/sign in to vote/i)).toBeInTheDocument();
    });
});
