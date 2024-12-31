import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { EngineeringStatsList } from '../../engineering/EngineeringStatsList';
import { EngineeringStat } from '../../../types/stats';
import { SHIP_TYPES } from '../../../constants';
import { vi } from 'vitest';

describe('EngineeringStatsList Component', () => {
    const mockStats: EngineeringStat[] = [
        {
            shipType: 'ATTACKER',
            stats: [
                { name: 'attack', value: 25, type: 'percentage' },
                { name: 'critDamage', value: 15, type: 'percentage' },
            ],
        },
        {
            shipType: 'DEFENDER',
            stats: [
                { name: 'hp', value: 30, type: 'percentage' },
                { name: 'defence', value: 20, type: 'percentage' },
            ],
        },
    ];

    const defaultProps = {
        stats: mockStats,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders empty state when no stats', () => {
        render(<EngineeringStatsList {...defaultProps} stats={[]} />);

        expect(screen.getByText('No engineering stats found.')).toBeInTheDocument();
    });

    test('renders list title when stats exist', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        expect(screen.getByText('Existing Engineering Stats')).toBeInTheDocument();
    });

    test('renders all ship type cards', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        // Check ship type names are rendered
        expect(screen.getByText(SHIP_TYPES.ATTACKER.name)).toBeInTheDocument();
        expect(screen.getByText(SHIP_TYPES.DEFENDER.name)).toBeInTheDocument();
    });

    test('renders stat values correctly', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        // Check stat values and formatting
        expect(screen.getByText('+25%')).toBeInTheDocument();
        expect(screen.getByText('+15%')).toBeInTheDocument();
        expect(screen.getByText('+30%')).toBeInTheDocument();
        expect(screen.getByText('+20%')).toBeInTheDocument();
    });

    test('handles edit button click', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        const editButtons = screen.getAllByRole('button', { name: /edit engineering stats/i });
        fireEvent.click(editButtons[0]);

        expect(defaultProps.onEdit).toHaveBeenCalledWith(mockStats[0]);
    });

    test('handles delete button click', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        const deleteButtons = screen.getAllByRole('button', { name: /delete engineering stats/i });
        fireEvent.click(deleteButtons[1]);

        expect(defaultProps.onDelete).toHaveBeenCalledWith('DEFENDER');
    });

    test('renders empty stats message when ship has no stats', () => {
        const statsWithEmpty: EngineeringStat[] = [
            {
                shipType: 'ATTACKER',
                stats: [],
            },
        ];

        render(<EngineeringStatsList {...defaultProps} stats={statsWithEmpty} />);

        expect(screen.getByText('No stats added')).toBeInTheDocument();
    });

    test('displays stat labels correctly', () => {
        render(<EngineeringStatsList {...defaultProps} />);

        expect(screen.getByText('Attack:')).toBeInTheDocument();
        expect(screen.getByText('Crit Power:')).toBeInTheDocument();
        expect(screen.getByText('HP:')).toBeInTheDocument();
        expect(screen.getByText('Defence:')).toBeInTheDocument();
    });

    test('scrolls to top on edit', () => {
        // Mock scrollTo
        const scrollToMock = vi.fn();
        window.scrollTo = scrollToMock;

        render(<EngineeringStatsList {...defaultProps} />);

        const editButton = screen.getAllByRole('button', { name: /edit engineering stats/i })[0];
        fireEvent.click(editButton);

        expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
});
