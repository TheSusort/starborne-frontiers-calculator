import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import { EngineeringStatsForm } from '../../engineering/EngineeringStatsForm';
import { EngineeringStat } from '../../../types/stats';
import { SHIP_TYPES } from '../../../constants';
import { vi } from 'vitest';

// Mock useEngineeringStats hook
vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({
        getAllAllowedStats: () => ({
            attack: { allowedTypes: ['percentage'] },
            defence: { allowedTypes: ['percentage'] },
            hp: { allowedTypes: ['percentage'] },
            critDamage: { allowedTypes: ['percentage'] },
        }),
        engineeringStats: { stats: [] },
    }),
}));

describe('EngineeringStatsForm Component', () => {
    const mockInitialStats: EngineeringStat = {
        shipType: 'ATTACKER',
        stats: [
            { name: 'attack', value: 25, type: 'percentage' },
            { name: 'critDamage', value: 15, type: 'percentage' },
        ],
    };

    const defaultProps = {
        onSubmit: vi.fn(),
        initialStats: undefined,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders form with default values', () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        // Should show ship type selector
        const shipTypeButton = screen.getByRole('button', { name: 'Ship Type' });
        expect(shipTypeButton).toBeInTheDocument();

        // Should show add stat button
        expect(screen.getByRole('button', { name: /add stat/i })).toBeInTheDocument();

        // Should show save button
        expect(screen.getByRole('button', { name: /save engineering stats/i })).toBeInTheDocument();
    });

    test('initializes with provided stats', () => {
        render(<EngineeringStatsForm {...defaultProps} initialStats={mockInitialStats} />);

        // Should select correct ship type
        expect(screen.getByRole('button', { name: 'Ship Type' })).toHaveTextContent('Attacker');

        // Should show existing stats
        const valueInputs = screen.getAllByRole('spinbutton');
        expect(valueInputs).toHaveLength(2);
        expect(valueInputs[0]).toHaveValue(25);
        expect(valueInputs[1]).toHaveValue(15);
    });

    test('handles adding new stats', async () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        const addButton = screen.getByRole('button', { name: /add stat/i });
        fireEvent.click(addButton);

        // Should add a new stat row
        await waitFor(() => {
            expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
        });
    });

    test('handles removing stats', async () => {
        const onSubmit = vi.fn();
        render(
            <EngineeringStatsForm
                {...defaultProps}
                initialStats={mockInitialStats}
                onSubmit={onSubmit}
            />
        );

        // Verify initial state
        const initialInputs = screen.getAllByLabelText(/value/i);
        expect(initialInputs).toHaveLength(2);
        expect(initialInputs[0]).toHaveValue(25); // attack stat
        expect(initialInputs[1]).toHaveValue(15); // critDamage stat

        // Find all remove buttons
        const removeButtons = screen.getAllByRole('button', { name: 'Remove stat' });
        expect(removeButtons).toHaveLength(2);

        // Click the first remove button
        fireEvent.click(removeButtons[0]);

        // Submit the form to verify the stats
        const submitButton = screen.getByRole('button', { name: /save engineering stats/i });
        fireEvent.click(submitButton);

        // Should have removed only the first stat
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledWith({
                shipType: 'ATTACKER',
                stats: [{ name: 'critDamage', value: 15, type: 'percentage' }],
            });
        });
    });

    test('handles form submission', async () => {
        render(<EngineeringStatsForm {...defaultProps} initialStats={mockInitialStats} />);

        // Update a stat value
        const valueInputs = screen.getAllByRole('spinbutton');
        fireEvent.change(valueInputs[0], { target: { value: '30' } });

        // Submit the form
        const submitButton = screen.getByRole('button', { name: /save engineering stats/i });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(defaultProps.onSubmit).toHaveBeenCalledWith({
                shipType: 'ATTACKER',
                stats: [
                    { name: 'attack', value: 30, type: 'percentage' },
                    { name: 'critDamage', value: 15, type: 'percentage' },
                ],
            });
        });
    });

    test('handles ship type change', () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        // Open ship type dropdown
        const shipTypeButton = screen.getByRole('button', { name: 'Ship Type' });
        fireEvent.click(shipTypeButton);

        // Select new option
        const defenderOption = screen.getByRole('option', { name: SHIP_TYPES.DEFENDER.name });
        fireEvent.click(defenderOption);

        expect(shipTypeButton).toHaveTextContent('Defender');
    });

    test('enforces maximum stats limit', () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        // Add maximum number of stats (5)
        const addButton = screen.getByRole('button', { name: /add stat/i });
        for (let i = 0; i < 6; i++) {
            fireEvent.click(addButton);
        }

        // Should only add up to the maximum
        expect(screen.getAllByRole('spinbutton')).toHaveLength(5);

        // Add button should be hidden
        expect(screen.queryByRole('button', { name: /add stat/i })).not.toBeInTheDocument();
    });

    test('resets form after submission', async () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        // Add a stat
        const addButton = screen.getByRole('button', { name: /add stat/i });
        fireEvent.click(addButton);

        // Submit the form
        const submitButton = screen.getByRole('button', { name: /save engineering stats/i });
        fireEvent.click(submitButton);

        await waitFor(() => {
            // Form should be reset
            expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Ship Type' })).toHaveTextContent('Attacker');
        });
    });

    test('filters available ship types', () => {
        render(<EngineeringStatsForm {...defaultProps} />);

        // Open ship type dropdown
        const shipTypeButton = screen.getByRole('button', { name: 'Ship Type' });
        fireEvent.click(shipTypeButton);

        // All ship types should be available (since engineeringStats.stats is empty in mock)
        Object.values(SHIP_TYPES).forEach((type) => {
            expect(screen.getByRole('option', { name: type.name })).toBeInTheDocument();
        });
    });
});
