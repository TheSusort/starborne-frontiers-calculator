import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { CommunityBuildList } from '../CommunityBuildList';
import type { CommunityBuild } from '../../../utils/communityBuild';

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const makeBuild = (over: Partial<CommunityBuild> = {}): CommunityBuild => ({
    id: 'r1',
    shipName: 'Ares',
    shipRefitLevel: 3,
    title: 'Crit Bruiser',
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
        setPriorities: [{ setName: 'CRITICAL', count: 4 }],
        statBonuses: [],
        fleetBuffs: [],
        excludedImplantTypes: [],
        optimizeImplants: false,
    },
    ...over,
});

const renderList = (
    builds: CommunityBuild[],
    props: Partial<React.ComponentProps<typeof CommunityBuildList>> = {}
) => {
    const onApply = vi.fn();
    const onToggleExpand = vi.fn();
    const onSortChange = vi.fn();
    render(
        <CommunityBuildList
            builds={builds}
            equippedUltimateImplant={null}
            sort="top"
            onSortChange={onSortChange}
            expandedId={null}
            onToggleExpand={onToggleExpand}
            userVote={null}
            canVote
            canApply
            onVote={vi.fn()}
            onApply={onApply}
            {...props}
        />
    );
    return { onApply, onToggleExpand, onSortChange };
};

describe('CommunityBuildList', () => {
    it('renders one row per build with its title and summary', () => {
        renderList([makeBuild(), makeBuild({ id: 'r2', title: 'Speed Opener' })]);
        expect(screen.getByText('Crit Bruiser')).toBeInTheDocument();
        expect(screen.getByText('Speed Opener')).toBeInTheDocument();
        expect(screen.getAllByText(/4x Critical/)).toHaveLength(2);
    });

    it('shows the vote sum with a sign', () => {
        renderList([makeBuild({ upvotes: 10, downvotes: 1 })]);
        expect(screen.getByText('+9')).toBeInTheDocument();
    });

    it('shows a refit chip', () => {
        renderList([makeBuild({ shipRefitLevel: 3 })]);
        expect(screen.getByText(/Refit 3/)).toBeInTheDocument();
    });

    it('shows an implant chip only for implant-specific builds', () => {
        renderList([
            makeBuild({ id: 'a', isImplantSpecific: true, ultimateImplant: 'Havoc' }),
            makeBuild({ id: 'b', title: 'Generic' }),
        ]);
        expect(screen.getByText('Havoc')).toBeInTheDocument();
    });

    it('sorts matching-implant builds first', () => {
        renderList(
            [
                makeBuild({ id: 'generic', title: 'Generic', score: 0.99 }),
                makeBuild({
                    id: 'mine',
                    title: 'Mine',
                    score: 0.1,
                    isImplantSpecific: true,
                    ultimateImplant: 'Havoc',
                }),
            ],
            { equippedUltimateImplant: 'Havoc' }
        );
        const titles = screen.getAllByTestId('community-build-title').map((el) => el.textContent);
        expect(titles).toEqual(['Mine', 'Generic']);
    });

    it('calls onToggleExpand with the build id when a row is clicked', () => {
        const { onToggleExpand } = renderList([makeBuild()]);
        fireEvent.click(screen.getByRole('button', { name: /crit bruiser/i }));
        expect(onToggleExpand).toHaveBeenCalledWith('r1');
    });

    it('renders the details body only for the expanded build', () => {
        renderList([makeBuild(), makeBuild({ id: 'r2', title: 'Speed Opener' })], {
            expandedId: 'r1',
        });
        expect(screen.getAllByRole('button', { name: /apply to autogear/i })).toHaveLength(1);
    });

    it('calls onApply with the expanded build', () => {
        const { onApply } = renderList([makeBuild()], { expandedId: 'r1' });
        fireEvent.click(screen.getByRole('button', { name: /apply to autogear/i }));
        expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    });

    it('renders an empty-state message with no builds', () => {
        renderList([]);
        expect(screen.getByText(/be the first to share/i)).toBeInTheDocument();
    });
});
