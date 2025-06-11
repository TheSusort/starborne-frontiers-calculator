import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import { GearPage } from '../manager/GearPage';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { vi } from 'vitest';
import React from 'react';

window.scrollTo = vi.fn();

// Mock data
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
        shipId: '',
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

const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship',
        type: 'ATTACKER',
        faction: 'TERRAN',
        rarity: 'legendary',
        equipment: { armor: 'gear2' },
        equipmentLocked: false,
        baseStats: {
            hp: 1000,
            attack: 1000,
            defence: 1000,
            hacking: 1000,
            security: 1000,
            speed: 1000,
            crit: 1000,
            critDamage: 1000,
            healModifier: 0,
        },
        refits: [],
        implants: {},
    },
];

// Mock hooks
const mockSaveInventory = vi.fn();
const mockAddNotification = vi.fn();

vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({
        inventory: mockGear,
        loading: false,
        error: null,
        saveInventory: mockSaveInventory,
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: mockShips,
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
        description?: string;
        action?: { onClick: () => void; label: string };
    }) => (
        <div>
            <h1>{title}</h1>
            {description && <p>{description}</p>}
            {action && <button onClick={action.onClick}>{action.label}</button>}
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
    ConfirmModal: ({
        isOpen,
        onClose,
        onConfirm,
        title,
        message,
    }: {
        isOpen: boolean;
        onClose: () => void;
        onConfirm: () => void;
        title: string;
        message: string;
    }) =>
        isOpen ? (
            <div role="dialog">
                <h2>{title}</h2>
                <p>{message}</p>
                <button onClick={onConfirm}>Delete</button>
                <button onClick={onClose}>Cancel</button>
            </div>
        ) : null,
}));

// Mock GearPieceForm and GearInventory
vi.mock('../../components/gear/GearPieceForm', () => ({
    GearPieceForm: ({
        onSubmit,
        editingPiece,
    }: {
        onSubmit: (gear: GearPiece) => void;
        editingPiece: GearPiece;
    }) => (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({
                    id: editingPiece?.id || 'new-gear',
                    slot: 'weapon',
                    level: 1,
                    stars: 1,
                    rarity: 'rare',
                    mainStat: { name: 'attack', value: 100, type: 'flat' },
                    subStats: [],
                    setBonus: 'CRITICAL',
                });
            }}
        >
            <button type="submit">{editingPiece ? 'Update Gear' : 'Add Gear'}</button>
        </form>
    ),
}));

vi.mock('../../components/gear/GearInventory', () => ({
    GearInventory: ({
        inventory,
        onRemove,
        onEdit,
    }: {
        inventory: GearPiece[];
        onRemove: (id: string) => void;
        onEdit: (gear: GearPiece) => void;
    }) => (
        <div>
            {inventory.map((gear: GearPiece) => (
                <div key={gear.id}>
                    <span>{gear.slot}</span>
                    <button onClick={() => onEdit(gear)}>Edit</button>
                    <button onClick={() => onRemove(gear.id)}>Remove</button>
                </div>
            ))}
        </div>
    ),
}));

describe('GearPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<GearPage />);
        expect(screen.getByText('Gear Management')).toBeInTheDocument();
        expect(screen.getByText('Manage your gear and its stats.')).toBeInTheDocument();
    });

    test('toggles form visibility', () => {
        render(<GearPage />);
        const form = screen.getByText('Add Gear')?.closest('.max-h-0');
        expect(form).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        expect(form).not.toHaveClass('max-h-0');

        fireEvent.click(screen.getByRole('button', { name: /hide form/i }));
        expect(form).toHaveClass('max-h-0');
    });

    test('handles gear addition', async () => {
        render(<GearPage />);

        fireEvent.click(screen.getByRole('button', { name: /create/i }));
        fireEvent.click(screen.getByRole('button', { name: /add gear/i }));

        await waitFor(() => {
            expect(mockSaveInventory).toHaveBeenCalledWith(
                expect.arrayContaining([
                    ...mockGear,
                    expect.objectContaining({
                        id: 'new-gear',
                        slot: 'weapon',
                    }),
                ])
            );
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Gear piece saved successfully'
            );
        });
    });

    test('handles gear editing', async () => {
        render(<GearPage />);

        // Click edit button
        fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0]);

        // Submit updated gear
        fireEvent.click(screen.getByRole('button', { name: /update gear/i }));

        await waitFor(() => {
            expect(mockSaveInventory).toHaveBeenCalled();
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Gear piece saved successfully'
            );
        });
    });

    test('handles gear deletion with confirmation', async () => {
        render(<GearPage />);

        // Click remove button
        fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);

        // Confirm modal should appear
        await waitFor(() => {
            expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
        });

        // Confirm deletion
        fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

        await waitFor(() => {
            expect(mockSaveInventory).toHaveBeenCalledWith(
                expect.not.arrayContaining([
                    expect.objectContaining({
                        id: 'gear1',
                    }),
                ])
            );
            expect(mockAddNotification).toHaveBeenCalledWith(
                'success',
                'Gear piece removed successfully'
            );
        });
    });

    test('shows warning when deleting equipped gear', async () => {
        render(<GearPage />);

        // Click remove button for equipped gear
        fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[1]);

        await waitFor(() => {
            expect(screen.getByText(/this gear piece is currently equipped/i)).toBeInTheDocument();
        });
    });
});
