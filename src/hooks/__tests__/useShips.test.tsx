import { renderHook, act } from '../../test-utils/test-utils';
import { useShips } from '../useShips';
import { vi } from 'vitest';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';

describe('useShips Hook', () => {
    const mockShips: Ship[] = [
        {
            id: 'ship1',
            name: 'Test Ship 1',
            rarity: 'legendary',
            faction: 'TERRAN',
            type: 'ATTACKER',
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
            equipment: {
                weapon: 'gear1',
                hull: 'gear2',
            },
            equipmentLocked: false,
            refits: [],
            implants: [],
        },
        {
            id: 'ship2',
            name: 'Test Ship 2',
            rarity: 'epic',
            faction: 'TERRAN',
            type: 'DEFENDER',
            baseStats: {
                hp: 2000,
                attack: 50,
                defence: 100,
                speed: 8,
                hacking: 0,
                security: 0,
                crit: 5,
                critDamage: 50,
                healModifier: 0,
            },
            equipment: {
                hull: 'gear3',
            },
            equipmentLocked: true,
            refits: [],
            implants: [],
        },
    ];

    const mockGearPieces: Record<string, GearPiece> = {
        gear1: {
            id: 'gear1',
            slot: 'weapon',
            level: 1,
            stars: 5,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [],
            setBonus: 'CRITICAL',
            shipId: 'ship1',
        },
        gear2: {
            id: 'gear2',
            slot: 'hull',
            level: 1,
            stars: 5,
            rarity: 'legendary',
            mainStat: { name: 'hp', value: 2000, type: 'flat' },
            subStats: [],
            setBonus: 'CRITICAL',
            shipId: 'ship1',
        },
        gear3: {
            id: 'gear3',
            slot: 'hull',
            level: 1,
            stars: 5,
            rarity: 'epic',
            mainStat: { name: 'hp', value: 1500, type: 'flat' },
            subStats: [],
            setBonus: 'SHIELD',
            shipId: 'ship2',
        },
    };

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
        localStorageMock.getItem.mockReturnValue(null);
        vi.clearAllMocks();
    });

    // Helper function to wait for state updates
    const waitForNextUpdate = async () => {
        await act(() => Promise.resolve());
    };

    const waitForDoubleUpdate = async () => {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    describe('Initialization and Loading', () => {
        test('initializes with empty ships and loading state', async () => {
            const { result } = renderHook(() => useShips());
            await waitForNextUpdate();

            expect(result.current.ships).toEqual([]);
            expect(result.current.loading).toBe(false);
        });

        test('loads ships from localStorage', async () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());
            await waitForNextUpdate();

            expect(result.current.ships).toEqual(mockShips);
            expect(result.current.loading).toBe(false);
            expect(localStorageMock.getItem).toHaveBeenCalledWith('ships');
        });

        test('handles localStorage error', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            localStorageMock.getItem.mockImplementation(() => {
                throw new Error('Storage error');
            });

            const { result } = renderHook(() => useShips());

            // Wait for all state updates
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve(); // Wait for both setError and setLoading
            });

            expect(result.current.loading).toBe(false);
            expect(consoleError).toHaveBeenCalled();

            consoleError.mockRestore();
        });
    });

    describe('Ship Management', () => {
        test('saves new ship', async () => {
            const { result } = renderHook(() => useShips());
            const newShip = { ...mockShips[0], id: 'newShip' };

            await act(async () => {
                await result.current.handleSaveShip(newShip);
            });

            expect(result.current.ships).toContainEqual(newShip);
            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'ships',
                JSON.stringify([newShip])
            );
        });

        test('updates existing ship', async () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());

            // Wait for initialization
            await waitForDoubleUpdate();

            const updatedShip = { ...mockShips[0], name: 'Updated Ship' };

            // First set the editing ship
            act(() => {
                result.current.setEditingShip(mockShips[0]);
            });

            // Then save and wait for the operation to complete
            await act(async () => {
                await result.current.handleSaveShip(updatedShip);
            });

            // Wait for final state update
            await waitForNextUpdate();

            expect(result.current.ships[0].name).toBe('Updated Ship');
            expect(result.current.editingShip).toBeUndefined();
        });

        test('removes ship', async () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());

            await act(async () => {
                await result.current.handleRemoveShip('ship1');
            });

            expect(result.current.ships).toHaveLength(1);
            expect(result.current.ships[0].id).toBe('ship2');
        });
    });

    describe('Gear Management', () => {
        test('equips gear to ship', () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());

            act(() => {
                result.current.handleEquipGear('ship1', 'generator', 'gear4');
            });

            expect(result.current.ships[0].equipment.generator).toBe('gear4');
        });

        test('removes gear from ship', () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());

            act(() => {
                result.current.handleRemoveGear('ship1', 'weapon');
            });

            expect(result.current.ships[0].equipment.weapon).toBeUndefined();
        });

        test('moves gear between ships', () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const { result } = renderHook(() => useShips());

            act(() => {
                result.current.handleEquipGear('ship2', 'weapon', 'gear1');
            });

            expect(result.current.ships[0].equipment.weapon).toBeUndefined();
            expect(result.current.ships[1].equipment.weapon).toBe('gear1');
        });

        test('validates gear assignments', () => {
            localStorageMock.getItem.mockReturnValue(JSON.stringify(mockShips));
            const getGearPiece = (id: string) => mockGearPieces[id];
            const { result } = renderHook(() => useShips({ getGearPiece }));

            act(() => {
                result.current.validateGearAssignments();
            });

            // Gear should remain assigned as it belongs to the correct ships
            expect(result.current.ships[0].equipment.weapon).toBe('gear1');
            expect(result.current.ships[0].equipment.hull).toBe('gear2');
            expect(result.current.ships[1].equipment.hull).toBe('gear3');
        });

        test('removes invalid gear assignments', () => {
            const invalidShips = [
                {
                    ...mockShips[0],
                    equipment: {
                        weapon: 'invalidGear',
                        hull: 'gear3', // belongs to ship2
                    },
                },
            ];
            localStorageMock.getItem.mockReturnValue(JSON.stringify(invalidShips));
            const getGearPiece = (id: string) => mockGearPieces[id];
            const { result } = renderHook(() => useShips({ getGearPiece }));

            act(() => {
                result.current.validateGearAssignments();
            });

            expect(result.current.ships[0].equipment.weapon).toBeUndefined();
            expect(result.current.ships[0].equipment.hull).toBeUndefined();
        });
    });
});
