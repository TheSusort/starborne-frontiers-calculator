import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { ShipDisplay } from '../ShipDisplay';
import { Ship } from '../../../types/ship';
import { vi } from 'vitest';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { FACTIONS } from '../../../constants/factions';
import { Stat } from '../../../types/stats';

// Mock hooks
vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({
        getGearPiece: vi.fn(),
    }),
}));

vi.mock('../../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({
        engineeringStats: { stats: [] },
        saveEngineeringStats: vi.fn(),
        deleteEngineeringStats: vi.fn(),
        getAllAllowedStats: vi.fn(),
        getEngineeringStatsForShipType: (shipType: string) => ({
            shipType,
            stats: [
                { name: 'hp', value: 100, type: 'flat' },
                { name: 'attack', value: 10, type: 'percentage' },
            ],
        }),
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: vi.fn(),
    }),
}));

// Mock components
vi.mock('../../stats/StatList', () => ({
    StatList: ({ stats }: { stats: Stat[] }) => (
        <div data-testid="stat-list">{JSON.stringify(stats)}</div>
    ),
}));

const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    equipment: {},
    refits: [
        {
            stats: [
                { name: 'hp', value: 1000, type: 'flat' },
                { name: 'attack', value: 100, type: 'flat' },
                { name: 'defence', value: 50, type: 'flat' },
                { name: 'speed', value: 10, type: 'percentage' },
                { name: 'hacking', value: 0, type: 'flat' },
                { name: 'security', value: 0, type: 'flat' },
            ],
            id: '',
        },
        {
            stats: [
                { name: 'hp', value: 1500, type: 'flat' },
                { name: 'attack', value: 150, type: 'flat' },
                { name: 'defence', value: 60, type: 'flat' },
                { name: 'speed', value: 12, type: 'percentage' },
                { name: 'hacking', value: 0, type: 'flat' },
                { name: 'security', value: 0, type: 'flat' },
            ],
            id: '',
        },
    ],
    implants: {},
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

describe('ShipDisplay', () => {
    const defaultProps = {
        ship: mockShip,
        onEdit: vi.fn(),
        onRemove: vi.fn(),
        onLockEquipment: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders ship name and type icons', () => {
        render(<ShipDisplay {...defaultProps} />);

        expect(screen.getByText('Test Ship')).toBeInTheDocument();
        expect(screen.getByAltText(SHIP_TYPES.ATTACKER.name)).toBeInTheDocument();
        expect(screen.getByAltText(FACTIONS.TERRAN_COMBINE.name)).toBeInTheDocument();
    });

    test('renders refit stars correctly', () => {
        render(<ShipDisplay {...defaultProps} />);

        const stars = screen.getAllByText('★');
        const activeStars = stars.filter((star) => star.className.includes('text-yellow-400'));
        const inactiveStars = stars.filter((star) => star.className.includes('text-gray-500'));

        expect(activeStars).toHaveLength(2); // Two refits
        expect(inactiveStars).toHaveLength(4); // Remaining slots
    });

    test('renders compact variant', () => {
        render(<ShipDisplay {...defaultProps} variant="compact" />);

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.queryByTestId('stat-list')).not.toBeInTheDocument();
    });

    test('renders extended variant without implants section when no implants', () => {
        render(<ShipDisplay {...defaultProps} variant="extended" />);

        // Implants section should not show when there are no implants
        expect(screen.queryByText('Implants:')).not.toBeInTheDocument();
    });

    test('handles edit button click', () => {
        render(<ShipDisplay {...defaultProps} />);

        // Open the dropdown menu first
        fireEvent.click(screen.getByRole('button', { name: /ship actions/i }));
        // Click the edit menu item
        fireEvent.click(screen.getByText('Edit ship'));
        expect(defaultProps.onEdit).toHaveBeenCalledWith(mockShip);
    });

    test('handles remove button click', () => {
        render(<ShipDisplay {...defaultProps} />);

        // Open the dropdown menu first
        fireEvent.click(screen.getByRole('button', { name: /ship actions/i }));
        // Click the remove menu item
        fireEvent.click(screen.getByText('Remove ship'));
        expect(defaultProps.onRemove).toHaveBeenCalledWith('ship1');
    });

    test('handles lock equipment button click', async () => {
        render(<ShipDisplay {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /lock equipment/i }));
        expect(defaultProps.onLockEquipment).toHaveBeenCalledWith(mockShip);
    });

    test('shows locked state correctly', () => {
        render(<ShipDisplay {...defaultProps} ship={{ ...mockShip, equipmentLocked: true }} />);

        expect(screen.getByRole('button', { name: /unlock equipment/i })).toBeInTheDocument();
    });

    test('handles click events when clickable', () => {
        const onClick = vi.fn();
        render(<ShipDisplay {...defaultProps} onClick={onClick} />);

        fireEvent.click(screen.getByText('Test Ship'));
        expect(onClick).toHaveBeenCalled();
    });

    test('applies correct border color based on rarity', () => {
        render(<ShipDisplay {...defaultProps} />);

        const container = screen.getByText('Test Ship').closest('div')
            ?.parentElement?.parentElement;
        expect(container).toHaveClass('border-rarity-legendary'); // legendary rarity
    });

    test('calculates total stats correctly', () => {
        render(<ShipDisplay {...defaultProps} />);

        const statList = screen.getByTestId('stat-list');
        const stats = JSON.parse(statList.textContent || '{}');

        // Base stats + Refits + Implants + Engineering
        expect(stats).toEqual(
            expect.objectContaining({
                hp: expect.any(Number),
                attack: expect.any(Number),
                defence: expect.any(Number),
                speed: expect.any(Number),
            })
        );
    });
});
