import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import { ShipForm } from '../ShipForm';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { FACTIONS } from '../../../constants/factions';
import { fetchShipData } from '../../../utils/dataUpdate/shipDataFetcher';

// Mock fetch ship data utility
vi.mock('../../../utils/dataUpdate/shipDataFetcher', () => ({
    fetchShipData: vi.fn(),
}));

// Mock notification hook
const addNotification = vi.fn();
vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification,
    }),
}));

const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    equipment: {},
    equipmentLocked: false,
    refits: [
        {
            stats: [{ name: 'hp', value: 1000, type: 'flat' }],
        },
    ],
    implants: [
        {
            stats: [{ name: 'attack', value: 100, type: 'flat' }],
        },
    ],
    baseStats: {
        hp: 1000,
        attack: 100,
        defence: 50,
        speed: 10,
        hacking: 0,
        security: 0,
        crit: 5,
        critDamage: 50,
        healModifier: 0,
    },
};

describe('ShipForm', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders empty form in create mode', () => {
        render(<ShipForm {...defaultProps} />);

        expect(screen.getByLabelText('Ship Name')).toHaveValue('');
        expect(screen.getByText('Create New Ship')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create ship/i })).toBeInTheDocument();
    });

    test('renders populated form in edit mode', () => {
        render(<ShipForm {...defaultProps} editingShip={mockShip} />);

        expect(screen.getByLabelText('Ship Name')).toHaveValue('Test Ship');
        expect(screen.getByText('Edit Ship')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    });

    test('handles form submission', async () => {
        render(<ShipForm {...defaultProps} />);

        // Fill in required fields
        fireEvent.change(screen.getByLabelText('Ship Name'), {
            target: { value: 'New Ship' },
        });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create ship/i }));

        await waitFor(() => {
            expect(defaultProps.onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Ship',
                })
            );
        });
    });

    test('fetches ship data', async () => {
        vi.mocked(fetchShipData).mockResolvedValueOnce({
            baseStats: mockShip.baseStats,
            faction: 'TERRAN_COMBINE',
            type: 'ATTACKER',
            rarity: 'legendary',
            affinity: 'CHEMICAL',
        });

        render(<ShipForm {...defaultProps} />);

        fireEvent.change(screen.getByLabelText('Ship Name'), {
            target: { value: 'Fetched Ship' },
        });

        fireEvent.click(screen.getByRole('button', { name: /fetch ship data/i }));

        await waitFor(() => {
            expect(fetchShipData).toHaveBeenCalledWith('Fetched Ship');
            expect(screen.getByRole('button', { name: /faction/i })).toHaveTextContent(
                FACTIONS.TERRAN_COMBINE.name
            );
            expect(screen.getByRole('button', { name: /type/i })).toHaveTextContent(
                SHIP_TYPES.ATTACKER.name
            );
        });
    });

    test('handles refit addition and deletion', async () => {
        render(<ShipForm {...defaultProps} />);

        // Add refit
        fireEvent.click(screen.getByRole('button', { name: /add refit/i }));
        expect(screen.getByText('Refits')).toBeInTheDocument();

        // Delete refit
        vi.spyOn(window, 'confirm').mockImplementation(() => true);
        const deleteButtons = screen.getAllByRole('button', { name: /delete refit/i });
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /delete refit/i })).not.toBeInTheDocument();
        });
    });

    test('handles implant addition and deletion', async () => {
        render(<ShipForm {...defaultProps} />);

        // Add implant
        fireEvent.click(screen.getByRole('button', { name: /add implant/i }));
        expect(screen.getByText('Implants')).toBeInTheDocument();

        // Delete implant
        vi.spyOn(window, 'confirm').mockImplementation(() => true);
        const deleteButtons = screen.getAllByRole('button', { name: /delete implant/i });
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(
                screen.queryByRole('button', { name: /delete implant/i })
            ).not.toBeInTheDocument();
        });
    });

    test('shows loading state during fetch', async () => {
        vi.mocked(fetchShipData).mockImplementationOnce(
            () => new Promise((resolve) => setTimeout(resolve, 100))
        );

        render(<ShipForm {...defaultProps} />);

        fireEvent.change(screen.getByLabelText('Ship Name'), {
            target: { value: 'Test' },
        });

        await fireEvent.click(screen.getByRole('button', { name: /fetch ship data/i }));

        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    test('handles fetch error', async () => {
        // Clear any previous calls
        addNotification.mockClear();

        // Mock the fetch to return null (no ship found)
        vi.mocked(fetchShipData).mockResolvedValueOnce(null);

        render(<ShipForm {...defaultProps} />);

        // Enter ship name and click fetch
        fireEvent.change(screen.getByLabelText('Ship Name'), {
            target: { value: 'Test' },
        });

        // Click and wait for the error to be handled
        await fireEvent.click(screen.getByRole('button', { name: /fetch ship data/i }));

        // Wait for the error message
        await waitFor(() => {
            expect(
                screen.getByText(
                    /Could not find ship data. Please check the ship name and try again./i
                )
            ).toBeInTheDocument();
        });
    });

    // Add a separate test for network errors
    test('handles network fetch error', async () => {
        // Clear any previous calls
        addNotification.mockClear();

        // Mock the fetch to throw a network error
        vi.mocked(fetchShipData).mockRejectedValueOnce(new Error('Network error'));

        render(<ShipForm {...defaultProps} />);

        // Enter ship name and click fetch
        fireEvent.change(screen.getByLabelText('Ship Name'), {
            target: { value: 'Test' },
        });

        // Click and wait for the error to be handled
        await fireEvent.click(screen.getByRole('button', { name: /fetch ship data/i }));

        // Wait for the notification
        await waitFor(() => {
            expect(
                screen.getByText(/Failed to fetch ship data. Please try again later./i)
            ).toBeInTheDocument();
        });
    });
});
