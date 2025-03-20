import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import { ShipsPage } from '../manager/ShipsPage';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { vi } from 'vitest';
import React from 'react';

window.scrollTo = vi.fn();

// Mock data
const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship',
        type: 'ATTACKER',
        faction: 'TERRAN',
        rarity: 'legendary',
        equipment: {
            weapon: 'gear1',
            armor: 'gear2',
        },
        equipmentLocked: false,
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
        refits: [],
        implants: [],
    },
];

const mockGear: GearPiece[] = [
    {
        id: 'gear1',
        slot: 'weapon',
        level: 10,
        stars: 5,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: 'CRITICAL',
        shipId: 'ship1',
    },
    {
        id: 'gear2',
        slot: 'armor',
        level: 8,
        stars: 4,
        rarity: 'epic',
        mainStat: { name: 'hp', value: 2000, type: 'flat' },
        subStats: [],
        setBonus: 'FORTITUDE',
        shipId: 'ship1',
    },
];

// Mock hooks
const mockSaveInventory = vi.fn();
const mockHandleSaveShip = vi.fn();
const mockHandleRemoveShip = vi.fn();
const mockHandleEquipGear = vi.fn();
const mockHandleRemoveGear = vi.fn();
const mockHandleLockEquipment = vi.fn();
const mockAddNotification = vi.fn();

vi.mock('../../hooks/useInventory', () => ({
    useInventory: () => ({
        inventory: mockGear,
        saveInventory: mockSaveInventory,
        getGearPiece: (id: string) => mockGear.find((g) => g.id === id),
    }),
}));

vi.mock('../../hooks/useShips', () => ({
    useShips: () => ({
        ships: mockShips,
        loading: false,
        error: null,
        editingShip: null,
        handleRemoveShip: mockHandleRemoveShip,
        handleEquipGear: mockHandleEquipGear,
        handleRemoveGear: mockHandleRemoveGear,
        handleSaveShip: mockHandleSaveShip,
        setEditingShip: vi.fn(),
        handleLockEquipment: mockHandleLockEquipment,
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

// Mock UI components
vi.mock('../../components/ui', () => ({
    PageLayout: ({
        children,
        title,
        description,
        action,
    }: {
        children: React.ReactNode;
        title: string;
        description: string;
        action: { onClick: () => void; label: string };
    }) => (
        <div>
            <h1>{title}</h1>
            <p>{description}</p>
            <button onClick={action?.onClick}>{action?.label}</button>
            {children}
        </div>
    ),
    CollapsibleForm: ({
        children,
        isVisible,
    }: {
        children: React.ReactNode;
        isVisible: boolean;
    }) => <div className={isVisible ? '' : 'max-h-0'}>{children}</div>,
}));

// Mock ShipForm and ShipInventory components
vi.mock('../../components/ship/ShipForm', () => ({
    ShipForm: ({ onSubmit }: { onSubmit: (ship: Ship) => void }) => (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    id: 'new-ship',
                    name: 'New Ship',
                    type: 'ATTACKER',
                    faction: 'TERRAN',
                    rarity: 'legendary',
                    equipment: {},
                    equipmentLocked: false,
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
                    refits: [],
                    implants: [],
                });
            }}
        >
            <button type="submit">Create Ship</button>
        </form>
    ),
}));

vi.mock('../../components/ship/ShipInventory', () => ({
    ShipInventory: ({
        ships,
        onRemove,
        onEdit,
        onEquipGear,
        onRemoveGear,
        onLockEquipment,
    }: {
        ships: Ship[];
        onRemove: (id: string) => void;
        onEdit: (ship: Ship) => void;
        onEquipGear: (shipId: string, slot: string, gearId: string) => void;
        onRemoveGear: (shipId: string, slot: string) => void;
        onLockEquipment: (ship: Ship) => void;
    }) => (
        <div>
            {ships.map((ship: Ship) => (
                <div key={ship.id} className="ship-card">
                    <h3>{ship.name}</h3>
                    <button onClick={() => onEdit(ship)}>Edit</button>
                    <button onClick={() => onRemove(ship.id)}>Remove</button>
                    <button onClick={() => onLockEquipment(ship)}>
                        {ship.equipmentLocked ? 'Unlock' : 'Lock'} Equipment
                    </button>
                    {Object.entries(ship.equipment).map(([slot, gearId]) => (
                        <div key={slot}>
                            <span>
                                {slot}: {gearId}
                            </span>
                            <button onClick={() => onRemoveGear(ship.id, slot)}>Remove Gear</button>
                            <button onClick={() => onEquipGear(ship.id, slot, 'new-gear')}>
                                Equip Gear
                            </button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    ),
}));

describe('ShipsPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<ShipsPage />);
        expect(screen.getByText('Ship Management')).toBeInTheDocument();
        expect(screen.getByText(/Manage your ships and their equipment/i)).toBeInTheDocument();
    });

    test('handles ship creation', async () => {
        render(<ShipsPage />);

        fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
        fireEvent.click(screen.getByRole('button', { name: /^create ship$/i }));

        await waitFor(() => {
            expect(mockHandleSaveShip).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'new-ship',
                    name: 'New Ship',
                })
            );
            expect(mockAddNotification).toHaveBeenCalledWith('success', 'Ship saved successfully');
        });
    });

    test('handles ship deletion', async () => {
        render(<ShipsPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);

        await waitFor(() => {
            expect(mockHandleRemoveShip).toHaveBeenCalledWith('ship1');
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Ship removed successfully'
            );
        });
    });

    test('handles gear equipment', async () => {
        render(<ShipsPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /equip gear/i })[0]);

        await waitFor(() => {
            expect(mockHandleEquipGear).toHaveBeenCalledWith('ship1', 'weapon', 'new-gear');
            expect(mockSaveInventory).toHaveBeenCalled();
        });
    });

    test('handles gear removal', async () => {
        render(<ShipsPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /remove gear/i })[0]);

        await waitFor(() => {
            expect(mockHandleRemoveGear).toHaveBeenCalledWith('ship1', 'weapon');
            expect(mockSaveInventory).toHaveBeenCalled();
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Gear removed successfully'
            );
        });
    });

    test('handles equipment locking', async () => {
        render(<ShipsPage />);

        fireEvent.click(screen.getAllByRole('button', { name: /lock equipment/i })[0]);

        await waitFor(() => {
            expect(mockHandleLockEquipment).toHaveBeenCalledWith(mockShips[0]);
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                expect.stringContaining('Equipment lock state on Test Ship set to')
            );
        });
    });
});
