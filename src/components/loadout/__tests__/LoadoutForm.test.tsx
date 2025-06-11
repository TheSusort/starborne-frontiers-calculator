import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { LoadoutForm } from '../LoadoutForm';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';

let mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    equipment: {
        weapon: 'gear1',
        hull: 'gear2',
    },
    refits: [],
    implants: {},
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

// Mock ShipSelector component
vi.mock('../../ship/ShipSelector', () => ({
    ShipSelector: ({
        onSelect,
        selected,
    }: {
        onSelect: (ship: Ship) => void;
        selected: Ship | null;
    }) => (
        <div className="space-y-4">
            <button
                aria-label={selected ? 'Select another Ship' : 'Select a Ship'}
                onClick={() => onSelect(mockShip)}
                data-testid="ship-selector"
            >
                {selected ? 'Select another Ship' : 'Select a Ship'}
            </button>
            {selected && (
                <div>
                    <span>{selected.name}</span>
                </div>
            )}
        </div>
    ),
}));

describe('LoadoutForm Component', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
        existingNames: ['Existing Loadout'],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders form fields', () => {
        render(<LoadoutForm {...defaultProps} />);

        expect(screen.getByLabelText('Loadout Name')).toBeInTheDocument();
        expect(screen.getByText('Select Ship')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create loadout/i })).toBeInTheDocument();
    });

    test('submit button is disabled initially', () => {
        render(<LoadoutForm {...defaultProps} />);

        expect(screen.getByRole('button', { name: /create loadout/i })).toBeDisabled();
    });

    test('enables submit button when form is valid', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'New Loadout' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        expect(screen.getByRole('button', { name: /create loadout/i })).toBeEnabled();
    });

    test('prevents duplicate loadout names', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Try to use existing name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'Existing Loadout' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        expect(screen.getByText('A loadout with this name already exists')).toBeInTheDocument();
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });

    test('handles successful form submission', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'New Loadout' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        expect(defaultProps.onSubmit).toHaveBeenCalledWith({
            name: 'New Loadout',
            shipId: mockShip.id,
            equipment: mockShip.equipment,
        });
    });

    test('resets form after successful submission', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name
        const nameInput = screen.getByLabelText('Loadout Name');
        fireEvent.change(nameInput, {
            target: { value: 'New Loadout' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        // Check form reset
        expect(nameInput).toHaveValue('');
        expect(screen.getByTestId('ship-selector')).toHaveTextContent('Select a Ship');
    });

    test('trims whitespace from loadout name', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name with whitespace
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: '  New Loadout  ' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        expect(defaultProps.onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'New Loadout',
                shipId: mockShip.id,
                equipment: mockShip.equipment,
            })
        );
    });

    test('clears error when name is changed', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Try to use existing name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'Existing Loadout' },
        });

        // Select ship
        fireEvent.change(screen.getByTestId('ship-selector'), {
            target: { value: 'ship1' },
        });

        // Submit to trigger error
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        // Change name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'New Name' },
        });

        expect(
            screen.queryByText('A loadout with this name already exists')
        ).not.toBeInTheDocument();
    });

    test('prevents submission with empty name', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Select ship but leave name empty
        fireEvent.change(screen.getByTestId('ship-selector'), {
            target: { value: 'ship1' },
        });

        // Submit button should be disabled
        expect(screen.getByRole('button', { name: /create loadout/i })).toBeDisabled();
    });

    test('prevents submission with only whitespace name', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name with only whitespace
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: '   ' },
        });

        // Select ship
        fireEvent.change(screen.getByTestId('ship-selector'), {
            target: { value: 'ship1' },
        });

        // Submit button should be disabled
        expect(screen.getByRole('button', { name: /create loadout/i })).toBeDisabled();
    });

    test('handles form submission with minimal equipment', () => {
        // Modify the mockShip before the test
        mockShip = {
            ...mockShip,
            equipment: {}, // Empty equipment
        };

        render(<LoadoutForm {...defaultProps} />);

        // Fill in name
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'New Loadout' },
        });

        // Select ship
        fireEvent.click(screen.getByTestId('ship-selector'));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create loadout/i }));

        expect(defaultProps.onSubmit).toHaveBeenCalledWith({
            name: 'New Loadout',
            shipId: mockShip.id,
            equipment: {},
        });

        // Reset mockShip for other tests
        mockShip = {
            ...mockShip,
            equipment: {
                weapon: 'gear1',
                hull: 'gear2',
            },
        };
    });

    test('prevents submission without selected ship', () => {
        render(<LoadoutForm {...defaultProps} />);

        // Fill in name but don't select ship
        fireEvent.change(screen.getByLabelText('Loadout Name'), {
            target: { value: 'New Loadout' },
        });

        expect(screen.getByRole('button', { name: /create loadout/i })).toBeDisabled();
    });
});
