import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlacementBoard from '../PlacementBoard';
import type { Ship } from '../../../types/ship';
import type { LocalEncounterNote } from '../../../types/encounters';

// One encounter with a 2-ship formation; one of the two ships is no longer owned.
const encounters: LocalEncounterNote[] = [
    {
        id: 'enc-1',
        name: 'Defense Wall',
        createdAt: 0,
        formation: [
            { shipId: 'ship-owned', position: 'T1' },
            { shipId: 'ship-missing', position: 'M2' },
        ],
    },
];

const ownedShip = { id: 'ship-owned', name: 'Nova' } as Ship;

const getShipById = vi.fn((id: string) => (id === 'ship-owned' ? ownedShip : undefined));

vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters, loading: false }),
}));
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [ownedShip], getShipById }),
}));
// Sidebar (pulled in transitively) imports /favicon.ico?url which isn't available in tests.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const renderBoard = (props: Partial<React.ComponentProps<typeof PlacementBoard>> = {}) =>
    render(
        <PlacementBoard
            title="Your Team"
            formation={[]}
            selectedPosition={undefined}
            onSelectPosition={vi.fn()}
            onRemoveShip={vi.fn()}
            onPickShip={vi.fn()}
            onCloseSelector={vi.fn()}
            onLoadEncounter={vi.fn()}
            {...props}
        />
    );

describe('PlacementBoard load-from-encounter', () => {
    beforeEach(() => {
        getShipById.mockClear();
    });

    it('lists the saved encounter in the dropdown', () => {
        renderBoard();
        fireEvent.click(screen.getByRole('button', { name: /Load encounter/i }));
        expect(screen.getByRole('option', { name: 'Defense Wall' })).toBeInTheDocument();
    });

    it('loads the encounter into a BoardState, mapping owned ships to positions and skipping unowned ships', () => {
        const onLoadEncounter = vi.fn();
        renderBoard({ onLoadEncounter });

        fireEvent.click(screen.getByRole('button', { name: /Load encounter/i }));
        fireEvent.click(screen.getByRole('option', { name: 'Defense Wall' }));

        expect(onLoadEncounter).toHaveBeenCalledTimes(1);
        const board = onLoadEncounter.mock.calls[0][0];
        // Owned ship placed at its position; unowned ship's cell skipped entirely.
        expect(board).toEqual({ T1: ownedShip });
        expect(board.M2).toBeUndefined();
    });
});
