import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import { FilterPanel } from '../FilterPanel';
import { vi } from 'vitest';

window.scrollTo = vi.fn();

describe('FilterPanel Component', () => {
    const mockFilters = [
        {
            id: 'rarity',
            label: 'Rarity',
            options: [
                { value: 'legendary', label: 'Legendary' },
                { value: 'epic', label: 'Epic' },
            ],
            values: [],
            onChange: vi.fn(),
        },
        {
            id: 'type',
            label: 'Type',
            options: [
                { value: 'weapon', label: 'Weapon' },
                { value: 'hull', label: 'Hull' },
            ],
            values: [],
            onChange: vi.fn(),
        },
    ];

    const defaultProps = {
        filters: mockFilters,
        isOpen: false,
        onToggle: vi.fn(),
        onClear: vi.fn(),
        hasActiveFilters: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders filter button', () => {
        render(<FilterPanel {...defaultProps} />);
        expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    });

    test('shows filter groups when open', async () => {
        render(<FilterPanel {...defaultProps} isOpen={true} />);

        await waitFor(() => {
            expect(screen.getByTestId('offcanvas-panel')).toBeInTheDocument();
        });

        expect(screen.getByText('Rarity')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
    });

    test('renders active filter chips', () => {
        const activeFilters = [
            {
                ...mockFilters[0],
                values: ['legendary'],
            },
        ];

        render(<FilterPanel {...defaultProps} filters={activeFilters} hasActiveFilters={true} />);

        expect(screen.getByText('Legendary')).toBeInTheDocument();
    });

    test('handles filter chip removal', () => {
        const activeFilters = [
            {
                ...mockFilters[0],
                values: ['legendary'],
            },
        ];

        render(<FilterPanel {...defaultProps} filters={activeFilters} hasActiveFilters={true} />);

        const removeButton = screen.getByRole('button', { name: /remove rarity filter/i });
        fireEvent.click(removeButton);

        expect(activeFilters[0].onChange).toHaveBeenCalledWith([]);
    });

    test('shows clear filters button when filters are active', async () => {
        render(<FilterPanel {...defaultProps} hasActiveFilters={true} isOpen={true} />);

        await waitFor(() => {
            expect(screen.getByTestId('offcanvas-panel')).toBeInTheDocument();
        });

        const clearButton = screen.getByRole('button', { name: /clear filters/i });
        fireEvent.click(clearButton);

        expect(defaultProps.onClear).toHaveBeenCalled();
    });

    test('handles filter panel toggle', () => {
        render(<FilterPanel {...defaultProps} />);

        const filterButton = screen.getByRole('button', { name: /filter/i });
        fireEvent.click(filterButton);

        expect(defaultProps.onToggle).toHaveBeenCalled();
    });

    test('renders sort panel when sort options provided', async () => {
        const sortOptions = [
            { value: 'name', label: 'Name' },
            { value: 'level', label: 'Level' },
        ];

        render(
            <FilterPanel
                {...defaultProps}
                isOpen={true}
                sortOptions={sortOptions}
                sort={{ field: 'name', direction: 'asc' }}
                setSort={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('offcanvas-panel')).toBeInTheDocument();
        });

        expect(screen.getByText('Sort by')).toBeInTheDocument();
    });
});
