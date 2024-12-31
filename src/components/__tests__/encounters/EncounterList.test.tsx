import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import EncounterList from '../../encounters/EncounterList';
import { EncounterNote, ShipPosition } from '../../../types/encounters';
import { vi } from 'vitest';

// Mock FormationGrid since it's tested separately
vi.mock('../../encounters/FormationGrid', () => ({
    default: ({ formation }: { formation: ShipPosition[] }) => (
        <div data-testid="formation-grid">Ships: {formation.length}</div>
    ),
}));

describe('EncounterList Component', () => {
    const mockEncounters: EncounterNote[] = [
        {
            id: '1',
            name: 'First Encounter',
            formation: [
                { position: 'T1', shipId: 'ship1' },
                { position: 'M2', shipId: 'ship2' },
            ],
            createdAt: 1234567890,
        },
        {
            id: '2',
            name: 'Second Encounter',
            formation: [{ position: 'B1', shipId: 'ship3' }],
            createdAt: 1234567891,
        },
    ];

    const defaultProps = {
        encounters: mockEncounters,
        onEdit: vi.fn(),
        onDelete: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders encounters list title', () => {
        render(<EncounterList {...defaultProps} />);
        expect(screen.getByText('Saved Encounters')).toBeInTheDocument();
    });

    test('renders all encounters', () => {
        render(<EncounterList {...defaultProps} />);

        mockEncounters.forEach((encounter) => {
            expect(screen.getByText(encounter.name)).toBeInTheDocument();
        });
    });

    test('renders formation grids for each encounter', () => {
        render(<EncounterList {...defaultProps} />);

        const formationGrids = screen.getAllByRole('article');
        expect(formationGrids).toHaveLength(mockEncounters.length);

        expect(formationGrids[0]).toHaveTextContent('Ships: 2');
        expect(formationGrids[1]).toHaveTextContent('Ships: 1');
    });

    test('handles edit button click', () => {
        render(<EncounterList {...defaultProps} />);

        const editButtons = screen.getAllByRole('button', { name: /edit/i });
        fireEvent.click(editButtons[0]);

        expect(defaultProps.onEdit).toHaveBeenCalledWith(mockEncounters[0]);
    });

    test('handles delete button click', () => {
        render(<EncounterList {...defaultProps} />);

        const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
        fireEvent.click(deleteButtons[1]);

        expect(defaultProps.onDelete).toHaveBeenCalledWith(mockEncounters[1].id);
    });

    test('renders empty list message when no encounters', () => {
        render(<EncounterList {...defaultProps} encounters={[]} />);

        expect(screen.getByText('Saved Encounters')).toBeInTheDocument();
        expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });

    test('renders encounters in grid layout', () => {
        render(<EncounterList {...defaultProps} />);

        const grid = screen.getByRole('encounter-list');
        expect(grid).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2');
    });

    test('each encounter has edit and delete buttons', () => {
        render(<EncounterList {...defaultProps} />);

        mockEncounters.forEach((encounter) => {
            const container = screen.getByText(encounter.name).closest('div');
            expect(container).toBeInTheDocument();

            const editButton = container!.querySelector('button[aria-label*="edit" i]');
            const deleteButton = container!.querySelector('button[aria-label*="delete" i]');

            expect(editButton).toBeInTheDocument();
            expect(deleteButton).toBeInTheDocument();
        });
    });

    test('encounters are visually separated', () => {
        render(<EncounterList {...defaultProps} />);

        const encounterCards = screen.getAllByRole('article');
        encounterCards.forEach((card) => {
            expect(card).toHaveClass('border', 'border-dark-border');
        });
    });
});
