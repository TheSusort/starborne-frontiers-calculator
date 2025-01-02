import { render, screen, fireEvent, createEvent, waitFor } from '../../../test-utils/test-utils';
import { StatPriorityForm } from '../StatPriorityForm';
import { StatPriority } from '../../../types/autogear';
import { vi } from 'vitest';

describe('StatPriorityForm', () => {
    const defaultProps = {
        onAdd: vi.fn(),
        existingPriorities: [] as StatPriority[],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders form elements', () => {
        render(<StatPriorityForm {...defaultProps} />);

        expect(screen.getByLabelText(/stat/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/max limit/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add priority/i })).toBeInTheDocument();
    });

    test('handles stat selection', () => {
        render(<StatPriorityForm {...defaultProps} />);

        const statSelect = screen.getByLabelText(/stat/i);
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: /defence/i }));

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        expect(defaultProps.onAdd).toHaveBeenCalledWith({
            stat: 'defence',
            maxLimit: undefined,
            weight: 1,
        });
    });

    test('handles max limit input', () => {
        render(<StatPriorityForm {...defaultProps} />);

        const maxLimitInput = screen.getByLabelText(/max limit/i);
        fireEvent.change(maxLimitInput, { target: { value: '100' } });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        expect(defaultProps.onAdd).toHaveBeenCalledWith({
            stat: 'attack', // First stat in AVAILABLE_STATS
            maxLimit: 100,
            weight: 1,
        });
    });

    test('assigns correct weight based on existing priorities', () => {
        const existingPriorities: StatPriority[] = [
            { stat: 'attack', weight: 1 },
            { stat: 'defence', weight: 2 },
        ];

        render(<StatPriorityForm {...defaultProps} existingPriorities={existingPriorities} />);

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        expect(defaultProps.onAdd).toHaveBeenCalledWith(expect.objectContaining({ weight: 3 }));
    });

    test('resets max limit after submission', () => {
        render(<StatPriorityForm {...defaultProps} />);

        const maxLimitInput = screen.getByLabelText(/max limit/i);
        fireEvent.change(maxLimitInput, { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        expect(maxLimitInput).toHaveValue(null);
    });

    test('prevents form submission default behavior', () => {
        render(<StatPriorityForm {...defaultProps} />);

        const form = screen.getByRole('form');
        const submitEvent = createEvent.submit(form);
        fireEvent(form, submitEvent);

        expect(submitEvent.defaultPrevented).toBe(true);
    });

    test('clears form and adds priority on submission', async () => {
        render(<StatPriorityForm {...defaultProps} />);

        // Set up form with values
        const statSelect = screen.getByLabelText(/stat/i);
        const maxLimitInput = screen.getByLabelText(/max limit/i);

        // Select a stat
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: /defence/i }));

        // Add max limit
        fireEvent.change(maxLimitInput, { target: { value: '100' } });

        // Submit form
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        // Verify onAdd was called with correct values
        expect(defaultProps.onAdd).toHaveBeenCalledWith({
            stat: 'defence',
            maxLimit: 100,
            weight: 1,
        });
        await waitFor(() => {
            expect(maxLimitInput).toHaveValue(null);
            // Verify stat select was reset to first option
            expect(screen.getByRole('button', { name: /stat/i })).toHaveTextContent(/attack/i);
        });
    });

    test('adds priority with correct weight when priorities exist', () => {
        const existingPriorities: StatPriority[] = [
            { stat: 'attack', weight: 1, maxLimit: 50 },
            { stat: 'defence', weight: 2 },
        ];

        render(<StatPriorityForm {...defaultProps} existingPriorities={existingPriorities} />);

        // Submit form with new priority
        const statSelect = screen.getByLabelText(/stat/i);
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: /speed/i }));
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        // Verify new priority was added with correct weight
        expect(defaultProps.onAdd).toHaveBeenCalledWith({
            stat: 'speed',
            maxLimit: undefined,
            weight: 3,
        });
    });
});
