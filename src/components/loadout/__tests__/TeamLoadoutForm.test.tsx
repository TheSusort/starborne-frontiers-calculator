import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { TeamLoadoutForm } from '../TeamLoadoutForm';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';

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

const mockShip: Ship = {
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

describe('TeamLoadoutForm Component', () => {
    const defaultProps = {
        onSubmit: vi.fn(),
        existingNames: ['Existing Team'],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders form fields', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        expect(screen.getByLabelText('Team Loadout Name')).toBeInTheDocument();
        expect(screen.getAllByTestId('ship-selector')).toHaveLength(5);
        expect(screen.getByRole('button', { name: /create team loadout/i })).toBeInTheDocument();
    });

    test('submit button is disabled initially', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        expect(screen.getByRole('button', { name: /create team loadout/i })).toBeDisabled();
    });

    test('enables submit when form is valid', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        // Fill in name
        fireEvent.change(screen.getByLabelText('Team Loadout Name'), {
            target: { value: 'New Team' },
        });

        // Select all ships
        const shipSelectors = screen.getAllByTestId('ship-selector');
        shipSelectors.forEach((selector) => {
            fireEvent.click(selector);
        });

        expect(screen.getByRole('button', { name: /create team loadout/i })).toBeEnabled();
    });

    test('prevents duplicate team names', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        // Try to use existing name
        fireEvent.change(screen.getByLabelText('Team Loadout Name'), {
            target: { value: 'Existing Team' },
        });

        // Select all ships
        const shipSelectors = screen.getAllByTestId('ship-selector');
        shipSelectors.forEach((selector) => {
            fireEvent.click(selector);
        });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create team loadout/i }));

        expect(
            screen.getByText('A team loadout with this name already exists')
        ).toBeInTheDocument();
        expect(defaultProps.onSubmit).not.toHaveBeenCalled();
    });

    test('handles successful form submission', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        // Fill in name
        fireEvent.change(screen.getByLabelText('Team Loadout Name'), {
            target: { value: 'New Team' },
        });

        // Select all ships
        const shipSelectors = screen.getAllByTestId('ship-selector');
        shipSelectors.forEach((selector) => {
            fireEvent.click(selector);
        });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create team loadout/i }));

        expect(defaultProps.onSubmit).toHaveBeenCalledWith({
            name: 'New Team',
            shipLoadouts: Array(5)
                .fill(null)
                .map((_, index) => ({
                    position: index + 1,
                    shipId: mockShip.id,
                    equipment: mockShip.equipment,
                })),
        });
    });

    test('resets form after submission', () => {
        render(<TeamLoadoutForm {...defaultProps} />);

        // Fill in form
        fireEvent.change(screen.getByLabelText('Team Loadout Name'), {
            target: { value: 'New Team' },
        });

        const shipSelectors = screen.getAllByTestId('ship-selector');
        shipSelectors.forEach((selector) => {
            fireEvent.click(selector);
        });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /create team loadout/i }));

        // Check reset
        expect(screen.getByLabelText('Team Loadout Name')).toHaveValue('');
        screen.getAllByTestId('ship-selector').forEach((selector) => {
            expect(selector).toHaveTextContent('Select a Ship');
        });
    });
});
