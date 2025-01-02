import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { ShipSelector } from '../ShipSelector';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { FACTIONS } from '../../../constants/factions';

const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship 1',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'ATTACKER',
        equipment: {},
        equipmentLocked: false,
        refits: [],
        implants: [],
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
    },
    {
        id: 'ship2',
        name: 'Test Ship 2',
        rarity: 'rare',
        faction: 'MARAUDERS',
        type: 'DEFENDER',
        equipment: {},
        equipmentLocked: false,
        refits: [],
        implants: [],
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
    },
];

let currentMockShips: Ship[] = mockShips;

// Mock useShips hook
vi.mock('../../../hooks/useShips', () => ({
    useShips: () => ({
        ships: currentMockShips,
        loading: false,
        error: null,
        editingShip: undefined,
        setEditingShip: vi.fn(),
        handleEquipGear: vi.fn(),
        handleRemoveGear: vi.fn(),
        handleRemoveShip: vi.fn(),
        handleSaveShip: vi.fn(),
        getShipById: (id: string) => currentMockShips.find((ship) => ship.id === id),
        updateShip: vi.fn(),
        saveShips: vi.fn(),
        validateGearAssignments: vi.fn(),
        handleLockEquipment: vi.fn(),
    }),
}));

// Mock ShipDisplay component
vi.mock('../ShipDisplay', () => ({
    ShipDisplay: ({
        ship,
        onClick,
        variant,
    }: {
        ship: Ship;
        onClick: (ship: Ship) => void;
        variant: 'compact' | 'full';
    }) => (
        <div data-testid={`ship-display-${ship.id}`} onClick={() => onClick?.(ship)}>
            <span>{ship.name}</span>
            <span>{FACTIONS[ship.faction].name}</span>
            <span>{SHIP_TYPES[ship.type].name}</span>
            {variant === 'compact' && <span>Compact View</span>}
            {variant === 'full' && <span>Full View</span>}
        </div>
    ),
}));

describe('ShipSelector', () => {
    const defaultProps = {
        onSelect: vi.fn(),
        selected: null,
        variant: 'full' as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders select ship button when no ship selected', () => {
        render(<ShipSelector {...defaultProps} />);
        expect(screen.getByRole('button', { name: /select a ship/i })).toBeInTheDocument();
    });

    test('renders selected ship with full variant', () => {
        render(<ShipSelector {...defaultProps} selected={mockShips[0]} />);
        expect(screen.getByTestId('ship-display-ship1')).toBeInTheDocument();
        expect(screen.getByText('Full View')).toBeInTheDocument();
    });

    test('renders selected ship with compact variant', () => {
        render(<ShipSelector {...defaultProps} variant="compact" selected={mockShips[0]} />);
        expect(screen.getByText('Compact View')).toBeInTheDocument();
    });

    test('highlights selected ship', () => {
        render(<ShipSelector {...defaultProps} selected={mockShips[0]} />);
        const selectedShip = screen.getByTestId('ship-display-ship1');
        expect(selectedShip).toBeInTheDocument();
    });

    test('opens ship selection modal', () => {
        render(<ShipSelector {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /select a ship/i }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    test('handles ship selection from modal', () => {
        currentMockShips = mockShips;
        render(<ShipSelector {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /select a ship/i }));
        fireEvent.click(screen.getByTestId('ship-display-ship1'));
        expect(defaultProps.onSelect).toHaveBeenCalledWith(mockShips[0]);
    });

    test('handles empty ships list', () => {
        currentMockShips = [];
        render(<ShipSelector {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: /select a ship/i }));
        expect(screen.getByText('No ships available')).toBeInTheDocument();
    });

    test('renders in simulation context', () => {
        render(
            <ShipSelector onSelect={defaultProps.onSelect} selected={mockShips[0]} variant="full" />
        );

        expect(screen.getByTestId('ship-display-ship1')).toBeInTheDocument();
        expect(screen.getByText('Full View')).toBeInTheDocument();
    });
});
