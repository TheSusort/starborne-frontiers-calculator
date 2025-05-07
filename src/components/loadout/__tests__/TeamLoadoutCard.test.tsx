import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { TeamLoadoutCard } from '../TeamLoadoutCard';
import { TeamLoadout } from '../../../types/loadout';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { vi } from 'vitest';

// Mock hooks
const mockHandleEquipGear = vi.fn();
const mockSaveInventory = vi.fn();
const mockAddNotification = vi.fn();

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        handleEquipGear: mockHandleEquipGear,
    }),
}));

vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({
        saveInventory: mockSaveInventory,
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

// Mock LoadoutCard component
vi.mock('../LoadoutCard', () => ({
    LoadoutCard: ({
        ship,
        onUpdate,
    }: {
        ship: Ship;
        onUpdate: (equipment: Record<string, string>) => void;
    }) => (
        <div data-testid="loadout-card">
            <span>{ship.name}</span>
            <button onClick={() => onUpdate({ weapon: 'newGear1' })}>Update</button>
        </div>
    ),
}));

describe('TeamLoadoutCard Component', () => {
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

    const mockTeamLoadout: TeamLoadout = {
        id: 'team1',
        name: 'Test Team',
        shipLoadouts: [
            {
                position: 1,
                shipId: 'ship1',
                equipment: { weapon: 'gear1' },
            },
        ],
        createdAt: Date.now(),
    };

    const defaultProps = {
        teamLoadout: mockTeamLoadout,
        ships: [mockShip],
        availableGear: [mockGear],
        getGearPiece: (id: string) => (id === 'gear1' ? mockGear : undefined),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders team loadout name and controls', () => {
        render(<TeamLoadoutCard {...defaultProps} />);

        expect(screen.getByText('Test Team')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /equip team/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete loadout/i })).toBeInTheDocument();
    });

    test('handles team loadout deletion', () => {
        render(<TeamLoadoutCard {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /delete loadout/i }));
        expect(defaultProps.onDelete).toHaveBeenCalledWith('team1');
    });

    test('handles equipping team loadout', () => {
        render(<TeamLoadoutCard {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /equip team/i }));

        expect(mockHandleEquipGear).toHaveBeenCalledWith('ship1', 'weapon', 'gear1');
        expect(mockSaveInventory).toHaveBeenCalled();
        expect(mockAddNotification).toHaveBeenCalledWith(
            'success',
            'Team loadout equipped successfully'
        );
    });

    test('handles ship loadout updates', () => {
        render(<TeamLoadoutCard {...defaultProps} />);

        const updateButton = screen.getByRole('button', { name: /update/i });
        fireEvent.click(updateButton);

        expect(defaultProps.onUpdate).toHaveBeenCalledWith('team1', [
            {
                position: 1,
                shipId: 'ship1',
                equipment: { weapon: 'newGear1' },
            },
        ]);
    });

    test('skips rendering loadouts with invalid ship references', () => {
        const invalidTeamLoadout = {
            ...mockTeamLoadout,
            shipLoadouts: [
                {
                    position: 1,
                    shipId: 'invalidShip',
                    equipment: { weapon: 'gear1' },
                },
            ],
        };

        render(<TeamLoadoutCard {...defaultProps} teamLoadout={invalidTeamLoadout} />);
        expect(screen.queryByTestId('loadout-card')).not.toBeInTheDocument();
    });

    test('handles duplicate gear assignments', () => {
        const duplicateGearLoadout = {
            ...mockTeamLoadout,
            shipLoadouts: [
                {
                    position: 1,
                    shipId: 'ship1',
                    equipment: { weapon: 'gear1' },
                },
                {
                    position: 2,
                    shipId: 'ship2',
                    equipment: { weapon: 'gear1' },
                },
            ],
        };

        render(<TeamLoadoutCard {...defaultProps} teamLoadout={duplicateGearLoadout} />);

        fireEvent.click(screen.getByRole('button', { name: /equip team/i }));
        expect(mockAddNotification).toHaveBeenCalledWith(
            'warning',
            expect.stringContaining('Skipped duplicate gear')
        );
    });
});
