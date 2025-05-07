import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import { AutogearPage } from '../manager/AutogearPage';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { vi } from 'vitest';

// Mock hooks
const mockShips: Ship[] = [
    {
        id: 'ship1',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'TERRAN',
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
    },
];

vi.mock('../../contexts/ShipsContext', () => ({
    useShips: () => ({
        ships: mockShips,
        getShipById: (id: string) => mockShips.find((ship) => ship.id === id),
        handleEquipGear: vi.fn(),
    }),
}));

vi.mock('../../contexts/InventoryProvider', () => ({
    useInventory: () => ({
        inventory: mockGear,
        getGearPiece: (id: string) => mockGear.find((gear) => gear.id === id),
        saveInventory: vi.fn(),
    }),
}));

vi.mock('../../hooks/useEngineeringStats', () => ({
    useEngineeringStats: () => ({
        getEngineeringStatsForShipType: vi.fn(),
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: vi.fn(),
    }),
}));

vi.mock('../../utils/autogear/getStrategy', () => ({
    getAutogearStrategy: () => ({
        name: 'Beam Search',
        description: 'Test strategy',
        setProgressCallback: (
            callback: (progress: { current: number; total: number; percentage: number }) => void
        ) => {
            // Simulate progress update
            callback({ current: 50, total: 100, percentage: 50 });
        },
        findOptimalGear: async () => {
            // Delay to allow progress bar to show
            await new Promise((resolve) => setTimeout(resolve, 0));
            return [
                {
                    slotName: 'weapon',
                    gearId: 'gear1',
                    score: 100,
                },
            ];
        },
    }),
}));

describe('AutogearPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders autogear settings', () => {
        render(<AutogearPage />);

        expect(screen.getByText('Autogear')).toBeInTheDocument();
        expect(screen.getByText('Find the best gear for your ship.')).toBeInTheDocument();
    });

    test('handles ship selection', async () => {
        render(<AutogearPage />);

        const shipSelector = screen.getByRole('button', { name: /select a ship/i });
        fireEvent.click(shipSelector);

        const shipOption = screen.getByText('Test Ship');
        fireEvent.click(shipOption);

        await waitFor(() => {
            expect(screen.getByText(/Test Ship/)).toBeInTheDocument();
        });
    });

    test('handles priority management', () => {
        render(<AutogearPage />);

        // Add priority
        const statSelect = screen.getByLabelText(/stat/i);
        fireEvent.click(statSelect);
        fireEvent.click(screen.getAllByRole('option', { name: /^attack$/i })[0]);

        const maxLimit = screen.getByLabelText(/max limit \(optional\)/i);
        fireEvent.change(maxLimit, { target: { value: '1000' } });

        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        expect(screen.getByText(/Max: 1/)).toBeInTheDocument();
    });

    test('handles optimization with progress', async () => {
        render(<AutogearPage />);

        // Select ship
        const shipSelector = screen.getByRole('button', { name: /select a ship/i });
        fireEvent.click(shipSelector);
        fireEvent.click(screen.getByText('Test Ship'));

        // Add priority
        const statSelect = screen.getByLabelText(/stat/i);
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: /^attack$/i }));
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        // Start optimization
        fireEvent.click(screen.getByRole('button', { name: /find optimal gear/i }));

        await waitFor(() => {
            expect(screen.getByRole('progressbar')).toBeInTheDocument();
        });
    });

    test('shows gear suggestions after optimization', async () => {
        render(<AutogearPage />);

        // Setup and run optimization
        const shipSelector = screen.getByRole('button', { name: /select a ship/i });
        fireEvent.click(shipSelector);
        fireEvent.click(screen.getByText('Test Ship'));

        const statSelect = screen.getByLabelText(/stat/i);
        fireEvent.click(statSelect);
        fireEvent.click(screen.getByRole('option', { name: /^attack$/i }));
        fireEvent.click(screen.getByRole('button', { name: /add priority/i }));

        fireEvent.click(screen.getByRole('button', { name: /find optimal gear/i }));

        await waitFor(() => {
            expect(screen.getByText(/^suggested gear$/i)).toBeInTheDocument();
            expect(screen.getByText(/ATK/i)).toBeInTheDocument();
        });
    });
});
