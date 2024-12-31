import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import EncounterForm from '../EncounterForm';
import { EncounterNote } from '../../../types/encounters';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';

// Mock the current time for consistent snapshots
const mockNow = 1234567890000;
vi.setSystemTime(mockNow);

const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
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
    equipment: {},
    equipmentLocked: false,
    refits: [],
    implants: [],
};

// Mock ship selector component since it's a complex component with its own tests
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: ({ onSelect }: { onSelect: (ship: Ship) => void }) => (
        <button onClick={() => onSelect(mockShip)}>Select Ship</button>
    ),
}));

describe('EncounterForm Component', () => {
    const mockInitialEncounter: EncounterNote = {
        id: '123',
        name: 'Test Encounter',
        formation: [
            { position: 'T1', shipId: 'ship1' },
            { position: 'M2', shipId: 'ship2' },
        ],
        createdAt: 1234567800000,
    };

    const defaultProps = {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders empty form by default', () => {
        render(<EncounterForm {...defaultProps} />);

        expect(screen.getByLabelText(/encounter name/i)).toHaveValue('');
        expect(screen.getByRole('button', { name: /save encounter/i })).toBeInTheDocument();
    });

    test('initializes with encounter data when provided', () => {
        render(<EncounterForm {...defaultProps} initialEncounter={mockInitialEncounter} />);

        expect(screen.getByLabelText(/encounter name/i)).toHaveValue('Test Encounter');
        expect(screen.getByRole('button', { name: /update encounter/i })).toBeInTheDocument();
    });

    test('handles form submission with new encounter', async () => {
        render(<EncounterForm {...defaultProps} />);

        // Fill in encounter name
        fireEvent.change(screen.getByLabelText(/encounter name/i), {
            target: { value: 'New Encounter' },
        });

        // Select a position and add a ship
        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!);

        // Click the ship selector button (mocked)
        fireEvent.click(screen.getByText('Select Ship'));

        // Submit the form
        fireEvent.submit(screen.getByRole('button', { name: /save encounter/i }));

        await waitFor(() => {
            expect(defaultProps.onSubmit).toHaveBeenCalledWith({
                id: expect.any(String),
                name: 'New Encounter',
                formation: [{ position: 'T1', shipId: 'ship1' }],
                createdAt: mockNow,
            });
        });
    });

    test('handles form submission with existing encounter', async () => {
        render(<EncounterForm {...defaultProps} initialEncounter={mockInitialEncounter} />);

        // Update encounter name
        fireEvent.change(screen.getByLabelText(/encounter name/i), {
            target: { value: 'Updated Encounter' },
        });

        // Submit the form
        fireEvent.submit(screen.getByRole('button', { name: /update encounter/i }));

        await waitFor(() => {
            expect(defaultProps.onSubmit).toHaveBeenCalledWith({
                ...mockInitialEncounter,
                name: 'Updated Encounter',
            });
        });
    });

    test('handles ship placement and removal', () => {
        render(<EncounterForm {...defaultProps} />);

        // Select a position
        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!);

        // Ship selector should appear
        expect(screen.getByText(/select ship for position t1/i)).toBeInTheDocument();

        // Add a ship
        fireEvent.click(screen.getByText('Select Ship'));

        // Remove the ship (Ctrl+Click)
        fireEvent.click(position!, { ctrlKey: true });

        // Ship should be removed
        expect(screen.queryByText(mockShip.name)).not.toBeInTheDocument();
    });

    test('validates required name field', async () => {
        render(<EncounterForm {...defaultProps} />);

        // Try to submit by clicking the button
        const submitButton = screen.getByRole('button', { name: /save encounter/i });
        fireEvent.click(submitButton);

        // Form should not submit
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();

        // Input should show validation error
        const nameInput = screen.getByLabelText(/encounter name/i);
        expect(nameInput).toBeInvalid();
    });

    test('resets form after successful submission', async () => {
        render(<EncounterForm {...defaultProps} />);

        // Fill in encounter name
        fireEvent.change(screen.getByLabelText(/encounter name/i), {
            target: { value: 'Test Encounter' },
        });

        // Add a ship
        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!);
        fireEvent.click(screen.getByText('Select Ship'));

        // Submit the form
        fireEvent.submit(screen.getByRole('button', { name: /save encounter/i }));

        await waitFor(() => {
            // Form should be reset
            expect(screen.getByLabelText(/encounter name/i)).toHaveValue('');
            expect(screen.queryByText(mockShip.name)).not.toBeInTheDocument();
        });
    });

    test('handles ship selection cancellation', () => {
        render(<EncounterForm {...defaultProps} />);

        // Select a position
        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!);

        // Select another position without adding a ship
        const anotherPosition = screen.getByText('M2').parentElement?.parentElement;
        fireEvent.click(anotherPosition!);

        // Ship selector should update to new position
        expect(screen.getByText(/select ship for position m2/i)).toBeInTheDocument();
    });
});
