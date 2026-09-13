import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const TEMPLATE = {
    id: 'T_AEGIS',
    name: 'Aegis',
    rarity: 'legendary',
    faction: 'ATLAS',
    type: 'ATTACKER',
    baseStats: { hp: 1000, attack: 100, crit: 10 },
    equipment: {},
    implants: {},
    refits: [],
} as unknown as Ship;

const getShipById = vi.fn((id: string) => (id === 'ship-owned' ? ownedShip : undefined));

const addEncounter = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters, loading: false, addEncounter }),
}));
vi.mock('../../../hooks/useShipsData', () => ({
    useShipsData: () => ({
        ships: [TEMPLATE],
        loading: false,
        error: null,
        fetchSingleShip: vi.fn(),
        getAscensionStats: () => [
            { level: 1, attribute: 'HullPoints', type: 'Percentage', value: 0.15 },
        ],
    }),
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
            resolveShip={() => null}
            onLoadEncounter={vi.fn()}
            copyLabel="Copy to other side"
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
        expect(board).toEqual({ T1: { ship: ownedShip } });
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

// A saved formation stores ids only. A reference unit's id belongs to no owned row, so the
// owned-ship lookup drops the cell and the board silently loses the ship on load.
describe('PlacementBoard load-from-encounter with a reference ship', () => {
    // The fixture is module-level and shared, so put it back rather than leaving the
    // describes above dependent on running first.
    const originalFormation = encounters[0].formation;

    beforeEach(() => {
        vi.clearAllMocks();
        encounters[0].formation = [
            { shipId: 'template:T_AEGIS:refitted', position: 'T1' },
            { shipId: 'ship-owned', position: 'M2' },
        ];
    });

    afterEach(() => {
        encounters[0].formation = originalFormation;
    });

    const loadEncounter = () => {
        const onLoadEncounter = vi.fn();
        renderBoard({ onLoadEncounter });
        fireEvent.click(screen.getByRole('button', { name: /Load encounter/i }));
        fireEvent.click(screen.getByText('Defense Wall'));
        return onLoadEncounter.mock.calls[0][0];
    };

    it('rebuilds the reference ship from its template rather than dropping the cell', () => {
        const board = loadEncounter();
        expect(board.T1?.ship.id).toBe('template:T_AEGIS:refitted');
        expect(board.T1?.ship.refits).toHaveLength(6);
    });

    it('still resolves owned ships alongside it', () => {
        expect(loadEncounter().M2?.ship).toBe(ownedShip);
    });

    it('skips a reference id whose unit is no longer in the catalogue', () => {
        encounters[0].formation = [{ shipId: 'template:T_GONE:r0', position: 'T1' }];
        expect(loadEncounter().T1).toBeUndefined();
    });
});
