import { render, screen, fireEvent, act } from '../../../test-utils/test-utils';
import { GearInventory } from '../GearInventory';
import { GearPiece } from '../../../types/gear';
import { vi } from 'vitest';
const mockGearItems: GearPiece[] = [
    {
        id: '1',
        slot: 'weapon',
        rarity: 'legendary',
        setBonus: 'CRITICAL',
        level: 100,
        stars: 5,
        mainStat: {
            name: 'attack',
            value: 1000,
            type: 'flat',
        },
        subStats: [],
    },
    {
        id: '2',
        slot: 'weapon',
        rarity: 'legendary',
        setBonus: 'CRITICAL',
        level: 100,
        stars: 5,
        mainStat: {
            name: 'attack',
            value: 1000,
            type: 'flat',
        },
        subStats: [],
    },
];

describe('GearInventory Component', () => {
    // Mock localStorage
    const localStorageMock = (() => {
        let store: { [key: string]: string } = {};
        return {
            getItem: vi.fn((key: string) => store[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                store[key] = value.toString();
            }),
            clear: vi.fn(() => {
                store = {};
            }),
        };
    })();

    beforeEach(() => {
        // Setup localStorage mock
        Object.defineProperty(window, 'localStorage', {
            value: localStorageMock,
        });
        localStorageMock.clear();
    });

    test('renders empty state when no items in localStorage', async () => {
        localStorageMock.getItem.mockReturnValue(null);

        await act(async () => {
            render(<GearInventory inventory={[]} onRemove={() => {}} onEdit={() => {}} />);
        });

        expect(await screen.findByText(/no gear pieces added yet/i)).toBeInTheDocument();
    });

    test('renders gear items from localStorage', async () => {
        // Set up localStorage with test data
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockGearItems));

        await act(async () => {
            render(
                <GearInventory inventory={mockGearItems} onRemove={() => {}} onEdit={() => {}} />
            );
        });

        // Test for specific gear pieces from test data
        const legendaryGenerators = await screen.findAllByText('Defence: 1000');
        expect(legendaryGenerators[0]).toBeInTheDocument();
        expect(screen.getAllByAltText('CRITICAL')[0]).toBeInTheDocument();
    });

    describe('inventory management', () => {
        test('removes item when delete button is clicked', async () => {
            const onRemoveMock = vi.fn();
            const lastItem = mockGearItems[mockGearItems.length - 1];

            await act(async () => {
                render(
                    <GearInventory
                        inventory={mockGearItems}
                        onRemove={onRemoveMock}
                        onEdit={() => {}}
                    />
                );
            });

            const deleteButton = screen.getAllByRole('button', { name: /remove gear piece/i })[0];
            fireEvent.click(deleteButton);

            expect(onRemoveMock).toHaveBeenCalledWith(lastItem.id);
        });

        test('calls edit function when edit button is clicked', async () => {
            const onEditMock = vi.fn();
            const lastItem = mockGearItems[mockGearItems.length - 1];

            await act(async () => {
                render(
                    <GearInventory
                        inventory={mockGearItems}
                        onRemove={() => {}}
                        onEdit={onEditMock}
                    />
                );
            });

            const editButton = screen.getAllByRole('button', { name: /edit gear piece/i })[0];
            fireEvent.click(editButton);

            expect(onEditMock).toHaveBeenCalledWith(lastItem);
        });
    });

    describe('filtering functionality', () => {
        beforeEach(async () => {
            await act(async () => {
                render(
                    <GearInventory
                        inventory={mockGearItems}
                        onRemove={() => {}}
                        onEdit={() => {}}
                    />
                );
            });
            await screen.findAllByText('Attack: 800');
        });

        test('filters by slot type', async () => {
            const filterButton = screen.getByLabelText(/filter/i);
            fireEvent.click(filterButton);

            const slotFilter = screen.getByLabelText(/Weapon/i);
            fireEvent.click(slotFilter);

            const weaponItems = screen.getAllByText(/Attack: \d+/);
            const weaponCount = mockGearItems.filter((item) => item.slot === 'weapon').length;
            expect(weaponItems).toHaveLength(weaponCount);
        });

        test('filters by rarity', async () => {
            const filterButton = screen.getByLabelText(/filter/i);
            fireEvent.click(filterButton);

            const rarityFilter = screen.getByLabelText(/Legendary/i) as HTMLInputElement;
            fireEvent.click(rarityFilter);

            // Check that only legendary items are shown
            const legendaryItems = screen.getAllByText(/Main Stat/i);
            const legendaryCount = mockGearItems.filter(
                (item) => item.rarity === 'legendary'
            ).length;
            expect(legendaryItems.length).toBe(legendaryCount);
        });

        test('filters by set bonus', async () => {
            const filterButton = screen.getByLabelText(/filter/i);
            fireEvent.click(filterButton);

            // Find the checkbox by its label text and click it
            const criticalCheckbox = screen.getByLabelText(/Critical/i) as HTMLInputElement;
            fireEvent.click(criticalCheckbox);

            // Should only show items with CRITICAL set bonus
            const criticalItems = screen.getAllByText(/Main Stat/i);
            const criticalCount = mockGearItems.filter(
                (item) => item.setBonus === 'CRITICAL'
            ).length;
            expect(criticalItems.length).toBe(criticalCount);
        });
    });
});
