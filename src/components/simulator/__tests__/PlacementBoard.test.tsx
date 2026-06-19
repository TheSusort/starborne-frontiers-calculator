import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const addEncounter = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters, loading: false, addEncounter }),
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

describe('PlacementBoard save-as-encounter', () => {
    // A non-empty board to save.
    const formation: LocalEncounterNote['formation'] = [{ shipId: 'ship-owned', position: 'T1' }];

    beforeEach(() => {
        addEncounter.mockClear();
    });

    it('disables the "Save as encounter" trigger when the formation is empty', () => {
        renderBoard({ formation: [] });
        expect(screen.getByRole('button', { name: /Save as encounter/i })).toBeDisabled();
    });

    it('saves the current formation as a new encounter with the typed name', async () => {
        renderBoard({ formation });

        fireEvent.click(screen.getByRole('button', { name: /Save as encounter/i }));

        // Modal open; Save disabled while the name is empty.
        const saveButton = screen.getByRole('button', { name: /^Save$/i });
        expect(saveButton).toBeDisabled();

        const nameInput = screen.getByLabelText(/Encounter name/i);
        fireEvent.change(nameInput, { target: { value: 'My Team' } });
        expect(saveButton).not.toBeDisabled();

        fireEvent.click(saveButton);

        await waitFor(() => expect(addEncounter).toHaveBeenCalledTimes(1));
        expect(addEncounter).toHaveBeenCalledWith({ name: 'My Team', formation });
    });
});
