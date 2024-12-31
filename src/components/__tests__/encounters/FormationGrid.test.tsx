import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import FormationGrid from '../../encounters/FormationGrid';
import { Position, ShipPosition } from '../../../types/encounters';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';

const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship 1',
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
        refits: [],
        implants: [],
    },
    {
        id: 'ship2',
        name: 'Test Ship 2',
        rarity: 'epic',
        faction: 'TERRAN',
        type: 'DEFENDER',
        baseStats: {
            hp: 2000,
            attack: 50,
            defence: 100,
            speed: 8,
            hacking: 0,
            security: 0,
            crit: 5,
            critDamage: 50,
            healModifier: 0,
        },
        equipment: {},
        refits: [],
        implants: [],
    },
];

// Mock useShips hook
vi.mock('../../../hooks/useShips', () => ({
    useShips: () => ({
        ships: mockShips,
    }),
}));

describe('FormationGrid Component', () => {
    const mockFormation: ShipPosition[] = [
        { position: 'T1', shipId: 'ship1' },
        { position: 'M2', shipId: 'ship2' },
    ];

    const defaultProps = {
        formation: mockFormation,
        onPositionSelect: vi.fn(),
        selectedPosition: undefined as Position | undefined,
        onRemoveShip: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders all grid positions', () => {
        render(<FormationGrid {...defaultProps} />);

        // Check if all positions are rendered (3 rows x 4 columns = 12 positions)
        ['T1', 'T2', 'T3', 'T4', 'M1', 'M2', 'M3', 'M4', 'B1', 'B2', 'B3', 'B4'].forEach((pos) => {
            expect(screen.getByText(pos)).toBeInTheDocument();
        });
    });

    test('displays ships in correct positions', () => {
        render(<FormationGrid {...defaultProps} />);

        // Check if ships are displayed in their positions
        expect(screen.getByText('Test Ship 1')).toBeInTheDocument();
        expect(screen.getByText('Test Ship 2')).toBeInTheDocument();

        // Check if ships are in correct grid cells
        const t1Cell = screen.getByText('T1').parentElement;
        const m2Cell = screen.getByText('M2').parentElement;

        expect(t1Cell).toHaveTextContent('Test Ship 1');
        expect(m2Cell).toHaveTextContent('Test Ship 2');
    });

    test('handles position selection', () => {
        render(<FormationGrid {...defaultProps} />);

        const position = screen.getByText('T3').parentElement?.parentElement;
        fireEvent.click(position!);

        expect(defaultProps.onPositionSelect).toHaveBeenCalledWith('T3');
    });

    test('handles ship removal with ctrl+click', () => {
        render(<FormationGrid {...defaultProps} />);

        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!, { ctrlKey: true });

        expect(defaultProps.onRemoveShip).toHaveBeenCalledWith('T1');
    });

    test('handles ship removal with meta+click (for Mac)', () => {
        render(<FormationGrid {...defaultProps} />);

        const position = screen.getByText('T1').parentElement?.parentElement;
        fireEvent.click(position!, { metaKey: true });

        expect(defaultProps.onRemoveShip).toHaveBeenCalledWith('T1');
    });

    test('highlights selected position', () => {
        render(<FormationGrid {...defaultProps} selectedPosition="M3" />);

        const selectedCell =
            screen.getByText('M3').parentElement?.parentElement?.parentElement?.parentElement;
        expect(selectedCell).toHaveClass('bg-yellow-500');
    });

    test('shows removal tip when onRemoveShip is provided', () => {
        render(<FormationGrid {...defaultProps} />);

        expect(screen.getByText(/Ctrl\+Click to remove a ship/)).toBeInTheDocument();
    });

    test('hides removal tip when onRemoveShip is not provided', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { onRemoveShip, ...propsWithoutRemove } = defaultProps;
        render(<FormationGrid {...propsWithoutRemove} />);

        expect(screen.queryByText(/Ctrl\+Click to remove a ship/)).not.toBeInTheDocument();
    });

    test('handles empty formation', () => {
        render(<FormationGrid {...defaultProps} formation={[]} />);

        // Should render empty grid without ships
        mockShips.forEach((ship) => {
            expect(screen.queryByText(ship.name)).not.toBeInTheDocument();
        });
    });

    test('handles undefined callbacks gracefully', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { onPositionSelect, onRemoveShip, ...minimalProps } = defaultProps;
        render(<FormationGrid {...minimalProps} />);

        // Clicking positions should not cause errors
        const position = screen.getByText('T1').parentElement?.parentElement;
        expect(() => {
            fireEvent.click(position!);
            fireEvent.click(position!, { ctrlKey: true });
        }).not.toThrow();
    });
});
