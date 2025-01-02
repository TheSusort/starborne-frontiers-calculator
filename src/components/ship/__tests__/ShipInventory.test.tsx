import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { ShipInventory } from '../ShipInventory';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { vi } from 'vitest';

// Mock useInventory hook
vi.mock('../../../hooks/useInventory', () => ({
    useInventory: () => ({
        getGearPiece: vi.fn(),
    }),
}));

// Mock ShipCard component
vi.mock('../ShipCard', () => ({
    ShipCard: ({
        ship,
        onEdit,
        onRemove,
    }: {
        ship: Ship;
        onEdit: (ship: Ship) => void;
        onRemove: (ship: Ship) => void;
    }) => (
        <div data-testid={`ship-card-${ship.id}`}>
            <span>{ship.name}</span>
            <button onClick={() => onEdit(ship)}>Edit</button>
            <button onClick={() => onRemove(ship)}>Remove</button>
        </div>
    ),
}));

const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship 1',
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'ATTACKER',
        equipment: { weapon: 'gear1' },
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

const mockGear: GearPiece[] = [
    {
        id: 'gear1',
        slot: 'weapon',
        level: 1,
        stars: 1,
        rarity: 'common',
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
        setBonus: 'critical',
    },
];

describe('ShipInventory', () => {
    const defaultProps = {
        ships: mockShips,
        onRemove: vi.fn(),
        onEdit: vi.fn(),
        onEquipGear: vi.fn(),
        onRemoveGear: vi.fn(),
        onLockEquipment: vi.fn(),
        availableGear: mockGear,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders ships list', () => {
        render(<ShipInventory {...defaultProps} />);

        expect(screen.getByTestId('ship-card-ship1')).toBeInTheDocument();
        expect(screen.getByTestId('ship-card-ship2')).toBeInTheDocument();
        expect(screen.getByText('Showing 2 ships')).toBeInTheDocument();
    });

    test('handles empty ships list', () => {
        render(<ShipInventory {...defaultProps} ships={[]} />);

        expect(screen.getByText('No ships created yet')).toBeInTheDocument();
    });

    test('filters ships by faction', async () => {
        render(<ShipInventory {...defaultProps} />);

        // Open filter panel
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));

        // Select Terran faction
        const factionFilter = screen.getByRole('checkbox', { name: /Terran Combine/i });
        fireEvent.click(factionFilter);

        // Verify filtered results
        expect(screen.getByTestId('ship-card-ship1')).toBeInTheDocument();
        expect(screen.queryByTestId('ship-card-ship2')).not.toBeInTheDocument();
        expect(screen.getByText('Showing 1 ships')).toBeInTheDocument();
    });

    test('filters ships by type', () => {
        render(<ShipInventory {...defaultProps} />);

        // Open filter panel
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));

        // Select Attacker type
        const typeFilter = screen.getByRole('checkbox', { name: /Attacker/i });
        fireEvent.click(typeFilter);

        // Verify filtered results
        expect(screen.getByTestId('ship-card-ship1')).toBeInTheDocument();
        expect(screen.queryByTestId('ship-card-ship2')).not.toBeInTheDocument();
    });

    test('sorts ships by different criteria', () => {
        render(<ShipInventory {...defaultProps} />);

        // Open filter panel
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));

        // Sort by faction
        const sortSelect = screen.getByRole('button', { name: /sort by/i });
        fireEvent.click(sortSelect);
        const factionSort = screen.getByRole('option', { name: /Faction/i });
        fireEvent.click(factionSort);

        // Verify sort order
        const ships = screen.getAllByTestId(/ship-card/);
        expect(ships[0]).toHaveTextContent('Test Ship 2'); // XAOC comes before TERRAN
        expect(ships[1]).toHaveTextContent('Test Ship 1');
    });

    test('clears all filters', () => {
        render(<ShipInventory {...defaultProps} />);

        // Open filter panel and apply filters
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));

        const factionFilter = screen.getByRole('checkbox', { name: /Terran Combine/i });
        fireEvent.click(factionFilter);

        // Clear filters
        fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

        // Verify all ships are shown
        expect(screen.getByTestId('ship-card-ship1')).toBeInTheDocument();
        expect(screen.getByTestId('ship-card-ship2')).toBeInTheDocument();
    });

    test('shows no results message when filters match no ships', () => {
        render(<ShipInventory {...defaultProps} />);

        // Open filter panel
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));

        // Apply non-matching filters
        const factionFilter = screen.getByRole('checkbox', { name: /Terran Combine/i });
        fireEvent.click(factionFilter);

        const typeFilter = screen.getByRole('checkbox', { name: /Defender/i });
        fireEvent.click(typeFilter);

        expect(screen.getByText('No matching ships found')).toBeInTheDocument();
    });
});
