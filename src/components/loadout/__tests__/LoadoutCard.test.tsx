import { render, screen, fireEvent, waitFor } from '../../../test-utils/test-utils';
import { LoadoutCard } from '../LoadoutCard';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { GearSlotName } from '../../../constants';
import { vi } from 'vitest';

window.scrollTo = vi.fn();

// Mock hooks
vi.mock('../../../hooks/useGear', () => ({
    useGearLookup: (
        equipment: Record<string, string>,
        getGearPiece: (id: string) => GearPiece | undefined
    ) => {
        return Object.entries(equipment).reduce(
            (acc, [_, id]) => {
                const gear = getGearPiece(id);
                if (gear) acc[id] = gear;
                return acc;
            },
            {} as Record<string, GearPiece>
        );
    },
    useGearSets: () => ['CRITICAL', 'FORTITUDE'],
}));

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({
        equipGear: vi.fn(),
        getShipById: vi.fn(),
    }),
}));

vi.mock('../../../contexts/InventoryProvider', () => ({
    useInventory: () => ({
        saveInventory: vi.fn(),
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: vi.fn(),
    }),
}));

describe('LoadoutCard Component', () => {
    const mockShip: Ship = {
        id: 'ship1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN',
        type: 'ATTACKER',
        equipment: {},
        refits: [],
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

    const mockGear: GearPiece = {
        id: 'gear1',
        slot: 'weapon',
        level: 10,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: 'CRITICAL',
        shipId: 'ship1',
    };

    const defaultProps = {
        ship: mockShip,
        equipment: { weapon: 'gear1' } as Record<GearSlotName, string>,
        availableGear: [mockGear],
        getGearPiece: (id: string) => (id === 'gear1' ? mockGear : undefined),
        onUpdate: vi.fn(),
        showControls: true,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders loadout name when provided', () => {
        render(<LoadoutCard {...defaultProps} name="Test Loadout" />);
        expect(screen.getByText('Test Loadout')).toBeInTheDocument();
    });

    test('renders ship display with gear slots', () => {
        render(<LoadoutCard {...defaultProps} />);

        // Ship name should be visible
        expect(screen.getByText(mockShip.name)).toBeInTheDocument();

        // Gear slot should show equipped gear
        expect(screen.getByText('ATK')).toBeInTheDocument();
        expect(screen.getByText('★ 5')).toBeInTheDocument();
    });

    test('shows active set bonuses', () => {
        render(<LoadoutCard {...defaultProps} />);

        expect(screen.getByText('Sets:')).toBeInTheDocument();
        const setIcons = screen.getAllByRole('img');
        expect(setIcons.length).toBeGreaterThan(0);
    });

    test('handles equip loadout action', async () => {
        const onEquip = vi.fn();
        render(<LoadoutCard {...defaultProps} onEquip={onEquip} />);

        const equipButton = screen.getByRole('button', { name: /equip loadout/i });
        fireEvent.click(equipButton);

        expect(onEquip).toHaveBeenCalled();
    });

    test('handles delete loadout action', () => {
        const onDelete = vi.fn();
        render(<LoadoutCard {...defaultProps} onDelete={onDelete} />);

        const deleteButton = screen.getByRole('button', { name: /delete loadout/i });
        fireEvent.click(deleteButton);

        expect(onDelete).toHaveBeenCalled();
    });

    test('opens gear selection modal when slot is clicked', () => {
        render(<LoadoutCard {...defaultProps} />);

        // Click empty slot
        const emptySlot = screen.getAllByRole('button', { name: /equip gear piece/i })[0];
        fireEvent.click(emptySlot);

        // Modal should be visible
        expect(screen.getByText(/select .* for test ship loadout/i)).toBeInTheDocument();
    });

    test('hides controls when showControls is false', () => {
        render(
            <LoadoutCard
                {...defaultProps}
                showControls={false}
                onEquip={() => {}}
                onDelete={() => {}}
            />
        );

        expect(screen.queryByRole('button', { name: /equip loadout/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /delete loadout/i })).not.toBeInTheDocument();
    });

    test('shows gear tooltip on hover', async () => {
        render(<LoadoutCard {...defaultProps} />);

        const gearSlot = screen.getByText('ATK').parentElement;
        fireEvent.mouseEnter(gearSlot as HTMLElement);

        await waitFor(() => {
            expect(screen.getByText('Main Stat')).toBeInTheDocument();
            expect(screen.getByText('Attack: 1000')).toBeInTheDocument();
        });
    });

    test('filters available gear in modal by slot', () => {
        const hull: GearPiece = { ...mockGear, id: 'gear2', slot: 'hull' };
        render(<LoadoutCard {...defaultProps} availableGear={[mockGear, hull]} />);

        // Click weapon slot
        const weaponSlot = screen.getAllByRole('button', { name: /equip gear piece/i })[0];
        fireEvent.click(weaponSlot);

        // Should only show weapon gear
        expect(screen.getAllByText(/attack/i)).toHaveLength(1);
    });
});
