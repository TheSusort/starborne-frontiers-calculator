import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { SortPanel } from '../SortPanel';
import { vi } from 'vitest';

describe('SortPanel Component', () => {
    const mockOptions = [
        { value: 'id', label: 'Date Added' },
        { value: 'setBonus', label: 'Set' },
        { value: 'level', label: 'Level' },
        { value: 'stars', label: 'Stars' },
        { value: 'rarity', label: 'Rarity' },
    ];

    const defaultProps = {
        options: mockOptions,
        currentSort: { field: 'id', direction: 'asc' as const },
        onSort: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders sort field selector', () => {
        render(<SortPanel {...defaultProps} />);

        expect(screen.getByText('Sort by')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sort by' })).toBeInTheDocument();
    });

    test('handles sort field change', () => {
        render(<SortPanel {...defaultProps} />);

        // Open select dropdown
        fireEvent.click(screen.getByRole('button', { name: 'Sort by' }));

        // Select new option
        fireEvent.click(screen.getByRole('option', { name: 'Level' }));

        expect(defaultProps.onSort).toHaveBeenCalledWith({
            field: 'level',
            direction: 'asc',
        });
    });

    test('toggles sort direction', () => {
        render(<SortPanel {...defaultProps} />);

        const directionButton = screen.getByRole('button', { name: /toggle sort direction/i });
        fireEvent.click(directionButton);

        expect(defaultProps.onSort).toHaveBeenCalledWith({
            field: 'id',
            direction: 'desc',
        });
    });

    test('maintains selected sort field when toggling direction', () => {
        render(<SortPanel {...defaultProps} currentSort={{ field: 'level', direction: 'asc' }} />);

        const directionButton = screen.getByRole('button', { name: /toggle sort direction/i });
        fireEvent.click(directionButton);

        expect(defaultProps.onSort).toHaveBeenCalledWith({
            field: 'level',
            direction: 'desc',
        });
    });
});
