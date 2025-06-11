import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { ShipCard } from '../ShipCard';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { vi } from 'vitest';

// Mock Data
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

const mockShip: Ship = {
    id: 'ship1',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'TERRAN',
    type: 'ATTACKER',
    equipment: {
        weapon: 'gear1',
        hull: 'gear2',
    },
    equipmentLocked: false,
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

// Mock Hooks
beforeAll(() => {
    vi.mock('../../../hooks/useGear', () => ({
        useGearLookup: (
            equipment: Record<string, string>,
            getGearPiece: (id: string) => GearPiece | undefined
        ) => {
            const lookup: Record<string, GearPiece | undefined> = {};
            Object.entries(equipment).forEach(([_, gearId]) => {
                if (gearId) {
                    lookup[gearId] = getGearPiece(gearId);
                }
            });
            return lookup;
        },
        useGearSets: () => ['CRITICAL'],
    }));

    vi.mock('../../../hooks/useNotification', () => ({
        useNotification: () => ({
            addNotification: vi.fn(),
        }),
    }));

    // Mock Components
    vi.mock('../ShipDisplay', () => ({
        ShipDisplay: ({ children }: { children: React.ReactNode }) => (
            <div data-testid="ship-display">{children}</div>
        ),
    }));

    vi.mock('../../gear/GearSlot', () => ({
        GearSlot: ({
            slotKey,
            onSelect,
            gear,
            onHover,
        }: {
            slotKey: string;
            onSelect: (slotKey: string) => void;
            gear: GearPiece | null;
            onHover: (gear: GearPiece | null) => void;
        }) => (
            <button
                onClick={() => onSelect(slotKey)}
                onMouseEnter={() => onHover && onHover(gear)}
                onMouseLeave={() => onHover && onHover(null)}
                data-testid={`gear-slot-${slotKey}`}
                data-gear={gear ? JSON.stringify(gear) : undefined}
            >
                {slotKey}
            </button>
        ),
    }));

    vi.mock('../../gear/GearInventory', () => ({
        GearInventory: ({
            onEquip,
            inventory,
        }: {
            onEquip: (gear: GearPiece) => void;
            inventory: GearPiece[];
        }) => (
            <div data-testid="gear-inventory">
                {inventory.map((gear: GearPiece) => (
                    <button key={gear.id} onClick={() => onEquip(gear)}>
                        Select Gear
                    </button>
                ))}
            </div>
        ),
    }));

    vi.mock('../../ui/layout/Modal', () => ({
        Modal: ({
            children,
            isOpen,
            title,
            onClose,
        }: {
            children: React.ReactNode;
            isOpen: boolean;
            title: string;
            onClose: () => void;
        }) =>
            isOpen ? (
                <div role="dialog" aria-label={title}>
                    <h2>{title}</h2>
                    <button onClick={onClose} aria-label="Close modal">
                        Close
                    </button>
                    {children}
                </div>
            ) : null,
    }));

    vi.mock('../../ui/layout/ConfirmModal', () => ({
        ConfirmModal: ({
            isOpen,
            title,
            message,
            onConfirm,
        }: {
            isOpen: boolean;
            title: string;
            message: string;
            onConfirm: () => void;
        }) =>
            isOpen ? (
                <div role="dialog" aria-label={title}>
                    <h2>{title}</h2>
                    <p>{message}</p>
                    <button onClick={onConfirm}>Confirm</button>
                </div>
            ) : null,
    }));
});

describe('ShipCard', () => {
    const defaultProps = {
        ship: mockShip,
        allShips: [mockShip],
        hoveredGear: null,
        availableGear: [mockGear],
        getGearPiece: vi.fn(),
        onEdit: vi.fn(),
        onRemove: vi.fn(),
        onLockEquipment: vi.fn(),
        onEquipGear: vi.fn(),
        onRemoveGear: vi.fn(),
        onHoverGear: vi.fn(),
        onUnequipAll: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders ship display with gear slots', () => {
        render(<ShipCard {...defaultProps} />);

        expect(screen.getByTestId('ship-display')).toBeInTheDocument();
        expect(screen.getByTestId('gear-slot-weapon')).toBeInTheDocument();
        expect(screen.getByTestId('gear-slot-hull')).toBeInTheDocument();
    });

    test('opens gear selection modal when slot is clicked', () => {
        render(<ShipCard {...defaultProps} />);

        fireEvent.click(screen.getByTestId('gear-slot-weapon'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/select weapon for test ship/i)).toBeInTheDocument();
    });

    test('handles equipping gear', () => {
        render(<ShipCard {...defaultProps} />);

        // Open gear selection modal
        fireEvent.click(screen.getByTestId('gear-slot-weapon'));

        // Select gear
        fireEvent.click(screen.getByText('Select Gear'));

        expect(defaultProps.onEquipGear).toHaveBeenCalledWith('ship1', 'weapon', 'gear1');
    });

    test('shows confirm modal when equipping gear from another ship', async () => {
        const gearFromOtherShip = { ...mockGear, shipId: 'ship2' };
        render(
            <ShipCard
                {...defaultProps}
                allShips={[mockShip, { ...mockShip, id: 'ship2', name: 'Other Ship' }]}
                availableGear={[gearFromOtherShip]}
            />
        );

        // Open gear selection and try to equip
        fireEvent.click(screen.getByTestId('gear-slot-weapon'));
        fireEvent.click(screen.getByText('Select Gear'));

        // Wait for confirm modal to appear
        expect(await screen.findByText(/move gear/i)).toBeInTheDocument();
        expect(await screen.findByText(/would you like to move it/i)).toBeInTheDocument();
    });

    test('prevents equipping gear from locked ships', () => {
        const lockedShip = { ...mockShip, id: 'ship2', equipmentLocked: true };
        const gearFromLockedShip = { ...mockGear, shipId: 'ship2' };

        render(
            <ShipCard
                {...defaultProps}
                allShips={[mockShip, lockedShip]}
                availableGear={[gearFromLockedShip]}
            />
        );

        fireEvent.click(screen.getByTestId('gear-slot-weapon'));
        fireEvent.click(screen.getByText('Select Gear'));

        expect(defaultProps.onEquipGear).not.toHaveBeenCalled();
    });

    test('handles unequip all gear', () => {
        render(<ShipCard {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: /unequip all gear/i }));

        expect(defaultProps.onRemoveGear).toHaveBeenCalledTimes(6); // Once for each gear slot
    });

    test('displays active gear sets', () => {
        render(<ShipCard {...defaultProps} />);

        expect(screen.getByText('Gear Sets:')).toBeInTheDocument();
        expect(screen.getByAltText('CRITICAL')).toBeInTheDocument();
    });

    test('confirms gear movement and equips', async () => {
        const gearFromOtherShip = { ...mockGear, shipId: 'ship2' };
        render(
            <ShipCard
                {...defaultProps}
                allShips={[mockShip, { ...mockShip, id: 'ship2', name: 'Other Ship' }]}
                availableGear={[gearFromOtherShip]}
            />
        );

        // Open gear selection and try to equip
        fireEvent.click(screen.getByTestId('gear-slot-weapon'));
        fireEvent.click(screen.getByText('Select Gear'));

        // Wait for and click confirm button
        const confirmButton = await screen.findByText('Confirm');
        fireEvent.click(confirmButton);

        expect(defaultProps.onEquipGear).toHaveBeenCalledWith('ship1', 'weapon', 'gear1');
    });

    test('handles gear hover events', () => {
        const mockGetGearPiece = vi.fn((id) => {
            return id === 'gear1' ? mockGear : undefined;
        });

        const testShip = {
            ...mockShip,
            equipment: {
                weapon: 'gear1',
            },
        };

        render(<ShipCard {...defaultProps} getGearPiece={mockGetGearPiece} ship={testShip} />);

        const gearSlot = screen.getByTestId('gear-slot-weapon');

        // Simulate hover events
        fireEvent.mouseEnter(gearSlot);
        expect(defaultProps.onHoverGear).toHaveBeenCalledWith(mockGear);

        fireEvent.mouseLeave(gearSlot);
        expect(defaultProps.onHoverGear).toHaveBeenCalledWith(null);
    });

    test('closes gear selection modal', () => {
        render(<ShipCard {...defaultProps} />);

        // Open modal
        fireEvent.click(screen.getByTestId('gear-slot-weapon'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        // Close modal using close button
        fireEvent.click(screen.getByRole('button', { name: /close modal/i }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
