import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SquadLeaderPicker from '../SquadLeaderPicker';
import type { BoardState } from '../PlacementBoard';
import type { Ship } from '../../../types/ship';
import type { SquadLeaderSelection } from '../../../utils/combat/preFight';

const marauderShip = (id: string): Ship => ({ id, name: id, faction: 'MARAUDERS' }) as Ship;
const atlasShip = (id: string): Ship => ({ id, name: id, faction: 'ATLAS_SYNDICATE' }) as Ship;

// 2 Marauders + 1 off-faction ship.
const marauderBoard: BoardState = {
    T1: marauderShip('m1'),
    T2: marauderShip('m2'),
    M1: atlasShip('a1'),
};

const renderPicker = (props: Partial<React.ComponentProps<typeof SquadLeaderPicker>> = {}) =>
    render(
        <SquadLeaderPicker
            side="player"
            selection={undefined}
            onChange={vi.fn()}
            board={{}}
            {...props}
        />
    );

const brandisherStage3: SquadLeaderSelection = {
    faction: 'MARAUDERS',
    name: 'Brandisher',
    stage: 3,
};

describe('SquadLeaderPicker selects', () => {
    it('lists all 10 factions plus a None option', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: /Faction/i }));
        expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Marauders' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Atlas Syndicate' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Terran Combine' })).toBeInTheDocument();
        // 10 factions + None.
        expect(screen.getAllByRole('option')).toHaveLength(11);
    });

    it('selecting a faction picks its first leader at the default stage', () => {
        const onChange = vi.fn();
        renderPicker({ onChange });
        fireEvent.click(screen.getByRole('button', { name: /Faction/i }));
        fireEvent.click(screen.getByRole('option', { name: 'Marauders' }));
        expect(onChange).toHaveBeenCalledWith({ faction: 'MARAUDERS', name: 'Puppet', stage: 3 });
    });

    it('changing faction resets the leader to the new faction (stage carries over)', () => {
        const onChange = vi.fn();
        renderPicker({
            selection: { faction: 'ATLAS_SYNDICATE', name: 'Negotiator', stage: 2 },
            onChange,
        });
        fireEvent.click(screen.getByRole('button', { name: /Faction/i }));
        fireEvent.click(screen.getByRole('option', { name: 'Marauders' }));
        expect(onChange).toHaveBeenCalledWith({ faction: 'MARAUDERS', name: 'Puppet', stage: 2 });
    });

    it('selecting None clears the selection', () => {
        const onChange = vi.fn();
        renderPicker({ selection: brandisherStage3, onChange });
        fireEvent.click(screen.getByRole('button', { name: /Faction/i }));
        fireEvent.click(screen.getByRole('option', { name: 'None' }));
        expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('lists the faction leaders with rarity labels and switches leader', () => {
        const onChange = vi.fn();
        renderPicker({ selection: brandisherStage3, onChange });
        fireEvent.click(screen.getByRole('button', { name: /Leader/i }));
        expect(screen.getByRole('option', { name: 'Puppet (Rare)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Reaper (Epic)' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: 'Reaper (Epic)' }));
        expect(onChange).toHaveBeenCalledWith({ faction: 'MARAUDERS', name: 'Reaper', stage: 3 });
    });

    it('changes the stage via the I / II / III select', () => {
        const onChange = vi.fn();
        renderPicker({ selection: brandisherStage3, onChange });
        fireEvent.click(screen.getByRole('button', { name: /Stage/i }));
        fireEvent.click(screen.getByRole('option', { name: 'I' }));
        expect(onChange).toHaveBeenCalledWith({
            faction: 'MARAUDERS',
            name: 'Brandisher',
            stage: 1,
        });
    });
});

describe('SquadLeaderPicker applied-effects preview', () => {
    it('shows per-effect recipient counts for the current board', () => {
        renderPicker({ selection: brandisherStage3, board: marauderBoard });
        // Stage I ally stat effects land on the 2 placed Marauders (not the Atlas ship).
        expect(screen.getByText('+10% Attack')).toBeInTheDocument();
        expect(screen.getAllByText(/2 Marauders ships/).length).toBeGreaterThanOrEqual(2);
    });

    it('shows enemy-targeting stage III effects as hitting all enemy ships', () => {
        renderPicker({ selection: brandisherStage3, board: marauderBoard });
        expect(screen.getByText('Enemy units lose 15 Security')).toBeInTheDocument();
        expect(screen.getByText('Enemy units lose 10% Defence')).toBeInTheDocument();
        expect(screen.getAllByText(/all enemy ships/)).toHaveLength(2);
    });

    it('marks effects the sim cannot model with a Not simulated tag', () => {
        renderPicker({ selection: brandisherStage3, board: marauderBoard });
        // Stage II "+25% direct damage to secondary targets" is conditional → unsimulated;
        // the four stat effects (I ally buffs + III enemy debuffs) are simulated.
        expect(screen.getByText('+25% direct damage to secondary targets')).toBeInTheDocument();
        expect(screen.getAllByText('Not simulated')).toHaveLength(1);
    });

    it('scopes the preview to the selected stage', () => {
        renderPicker({
            selection: { ...brandisherStage3, stage: 1 },
            board: marauderBoard,
        });
        expect(screen.getByText('+10% Attack')).toBeInTheDocument();
        expect(
            screen.queryByText('+25% direct damage to secondary targets')
        ).not.toBeInTheDocument();
        expect(screen.queryByText('Enemy units lose 15 Security')).not.toBeInTheDocument();
    });

    it('warns when no leader-faction ship is placed (faction gate unmet)', () => {
        renderPicker({ selection: brandisherStage3, board: { M1: atlasShip('a1') } });
        expect(
            screen.getByText(
                /No Marauders ship on this team — leader effects inactive \(enemy-targeting effects included\)\./
            )
        ).toBeInTheDocument();
    });

    it('shows no gate warning while a faction ship is placed', () => {
        renderPicker({ selection: brandisherStage3, board: marauderBoard });
        expect(screen.queryByText(/leader effects inactive/)).not.toBeInTheDocument();
    });

    it('renders no preview without a selection', () => {
        renderPicker({ board: marauderBoard });
        expect(screen.queryByText(/ships/)).not.toBeInTheDocument();
        expect(screen.queryByText('Not simulated')).not.toBeInTheDocument();
    });
});
