import { renderHook, act, waitFor } from '../../test-utils/test-utils';
import { useInventory } from '../useInventory';
import { GearPiece } from '../../types/gear';
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

describe('useInventory', () => {
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
        Object.defineProperty(window, 'localStorage', {
            value: localStorageMock,
        });
        localStorageMock.clear();
    });

    test('loads inventory from localStorage', async () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockGearItems));

        const { result } = renderHook(() => useInventory());

        // Wait for the hook to finish loading
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(result.current.inventory).toEqual(mockGearItems);
        expect(result.current.loading).toBe(false);
    });

    test('saves inventory to localStorage', async () => {
        const { result } = renderHook(() => useInventory());

        await act(async () => {
            await result.current.saveInventory(mockGearItems);
        });

        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'gear-inventory',
            JSON.stringify(mockGearItems)
        );
        expect(result.current.inventory).toEqual(mockGearItems);
    });

    test('handles localStorage errors when loading', async () => {
        // Mock console.error to avoid noise in test output
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Mock the error case
        localStorageMock.getItem.mockImplementation(() => {
            throw new Error('Storage error');
        });

        const { result } = renderHook(() => useInventory());

        await waitFor(
            () => {
                // Make sure loading has finished
                expect(result.current.loading).toBe(false);
            },
            { timeout: 1000 }
        );

        expect(result.current.error).toBe('Failed to load inventory');
        expect(result.current.inventory).toEqual([]);
        expect(localStorageMock.getItem).toHaveBeenCalledWith('gear-inventory');

        // Cleanup
        consoleError.mockRestore();
    });

    test('handles localStorage errors when saving', async () => {
        // Mock console.error to avoid noise in test output
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Start with a clean localStorage
        localStorageMock.getItem.mockImplementation(() => null);

        const { result } = renderHook(() => useInventory());

        // Wait for initial load
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        // Mock setItem to throw error
        localStorageMock.setItem.mockImplementation(() => {
            throw new Error('Storage error');
        });

        // Attempt to save new inventory
        await act(async () => {
            await result.current.saveInventory(mockGearItems);
        });

        expect(result.current.error).toBe('Failed to save inventory');
        expect(result.current.inventory).toEqual([]); // Should remain empty as save failed

        // Cleanup
        consoleError.mockRestore();
    });
});
