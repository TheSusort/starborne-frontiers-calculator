import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { LoadoutList } from '../LoadoutList';
import { Loadout } from '../../../types/loadout';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { vi } from 'vitest';

// Mock useShips hook
const mockHandleEquipGear = vi.fn();

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        equipGear: mockHandleEquipGear,
        ships: [mockShip],
        loading: false,
        error: null,
        editingShip: undefined,
        setEditingShip: vi.fn(),
        handleRemoveGear: vi.fn(),
        handleRemoveShip: vi.fn(),
        handleSaveShip: vi.fn(),
        getShipById: vi.fn(),
        updateShip: vi.fn(),
        saveShips: vi.fn(),
        validateGearAssignments: vi.fn(),
        handleLockEquipment: vi.fn(),
    }),
}));

// Mock LoadoutCard component
vi.mock('../LoadoutCard', () => ({
    LoadoutCard: ({
        name,
        onEquip,
        onDelete,
        onUpdate,
    }: {
        name: string;
        onEquip: () => void;
        onDelete: () => void;
        onUpdate: (equipment: Record<string, string>) => void;
    }) => (
        <div data-testid="loadout-card">
            <h3>{name}</h3>
            <button onClick={onEquip}>Equip</button>
            <button onClick={onDelete}>Delete</button>
            <button onClick={() => onUpdate({ weapon: 'newGear1' })}>Update</button>
        </div>
    ),
}));

const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    equipment: {},
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
};

const mockGear: GearPiece = {
    id: 'gear1',
    slot: 'weapon',
    level: 10,
    stars: 5,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 1000, type: 'flat' },
    subStats: [],
    setBonus: 'CRITICAL',
};

describe('LoadoutList Component', () => {
    const mockLoadouts: Loadout[] = [
        {
            id: 'loadout1',
            name: 'Test Loadout 1',
            shipId: 'ship1',
            equipment: { weapon: 'gear1' },
            createdAt: Date.now(),
        },
        {
            id: 'loadout2',
            name: 'Test Loadout 2',
            shipId: 'ship1',
            equipment: { hull: 'gear2' },
            createdAt: Date.now(),
        },
    ];

    const defaultProps = {
        loadouts: mockLoadouts,
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        getGearPiece: (id: string) => (id === 'gear1' ? mockGear : undefined),
        availableGear: [mockGear],
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders empty state when no loadouts', () => {
        render(<LoadoutList {...defaultProps} loadouts={[]} />);

        expect(screen.getByText(/no loadouts created yet/i)).toBeInTheDocument();
        expect(screen.getByText(/new loadout/i)).toBeInTheDocument();
    });

    test('renders loadout cards for each loadout', () => {
        render(<LoadoutList {...defaultProps} />);

        const cards = screen.getAllByTestId('loadout-card');
        expect(cards).toHaveLength(2);
        expect(screen.getByText('Test Loadout 1')).toBeInTheDocument();
        expect(screen.getByText('Test Loadout 2')).toBeInTheDocument();
    });

    test('handles loadout deletion', () => {
        render(<LoadoutList {...defaultProps} />);

        const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
        fireEvent.click(deleteButtons[0]);

        expect(defaultProps.onDelete).toHaveBeenCalledWith('loadout1');
    });

    test('handles loadout update', () => {
        render(<LoadoutList {...defaultProps} />);

        const updateButtons = screen.getAllByRole('button', { name: /update/i });
        fireEvent.click(updateButtons[0]);

        expect(defaultProps.onUpdate).toHaveBeenCalledWith('loadout1', { weapon: 'newGear1' });
    });

    test('handles loadout equipment', () => {
        render(<LoadoutList {...defaultProps} />);

        const equipButtons = screen.getAllByRole('button', { name: /equip/i });
        fireEvent.click(equipButtons[0]);

        expect(mockHandleEquipGear).toHaveBeenCalledWith('ship1', 'weapon', 'gear1');
    });

    test('skips rendering loadouts with invalid ship references', () => {
        const loadoutsWithInvalidShip = [
            {
                ...mockLoadouts[0],
                shipId: 'invalidShip',
            },
        ];

        render(<LoadoutList {...defaultProps} loadouts={loadoutsWithInvalidShip} />);

        expect(screen.queryByTestId('loadout-card')).not.toBeInTheDocument();
    });

    test('renders in grid layout', () => {
        render(<LoadoutList {...defaultProps} />);

        const container = screen.getAllByTestId('loadout-card')[0].parentElement?.parentElement;
        expect(container).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3');
    });
});
