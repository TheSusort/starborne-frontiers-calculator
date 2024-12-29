import { renderHook, act } from '../../test-utils/test-utils';
import { useLoadouts } from '../useLoadouts';
import { vi } from 'vitest';
import { Loadout, TeamLoadout } from '../../types/loadout';

// Mock useNotification hook
vi.mock('../useNotification', () => ({
    useNotification: () => ({
        addNotification: vi.fn(),
    }),
}));

describe('useLoadouts Hook', () => {
    const mockLoadouts: Loadout[] = [
        {
            id: '1',
            name: 'Test Loadout 1',
            shipId: 'ship1',
            equipment: {
                weapon: 'gear1',
                hull: 'gear2',
                generator: 'gear3',
            },
            createdAt: 1234567890,
        },
    ];

    const mockTeamLoadouts: TeamLoadout[] = [
        {
            id: '1',
            name: 'Test Team 1',
            shipLoadouts: [
                {
                    position: 1,
                    shipId: 'ship1',
                    equipment: {
                        weapon: 'gear1',
                        hull: 'gear2',
                    },
                },
                {
                    position: 2,
                    shipId: 'ship2',
                    equipment: {
                        weapon: 'gear3',
                        hull: 'gear4',
                    },
                },
            ],
            createdAt: 1234567890,
        },
    ];

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
        // Mock crypto.randomUUID
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');
    });

    describe('Individual Loadouts', () => {
        test('initializes with empty loadouts', () => {
            const { result } = renderHook(() => useLoadouts());
            expect(result.current.loadouts).toEqual([]);
        });

        test('loads loadouts from localStorage', () => {
            localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(mockLoadouts));
            const { result } = renderHook(() => useLoadouts());
            expect(result.current.loadouts).toEqual(mockLoadouts);
        });

        test('adds new loadout', async () => {
            const { result } = renderHook(() => useLoadouts());
            const newLoadout = {
                name: 'New Loadout',
                shipId: 'ship1',
                equipment: { weapon: 'gear1' },
            };

            await act(async () => {
                await result.current.addLoadout(newLoadout);
            });

            expect(result.current.loadouts).toHaveLength(1);
            expect(result.current.loadouts[0]).toEqual({
                ...newLoadout,
                id: '00000000-0000-0000-0000-000000000000',
                createdAt: expect.any(Number),
            });
        });

        test('updates existing loadout', async () => {
            localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(mockLoadouts));
            const { result } = renderHook(() => useLoadouts());

            const updatedEquipment = {
                weapon: 'gear4',
                hull: 'gear5',
            };

            await act(async () => {
                await result.current.updateLoadout('1', updatedEquipment);
            });

            expect(result.current.loadouts[0].equipment).toEqual(updatedEquipment);
        });

        test('deletes loadout', async () => {
            localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(mockLoadouts));
            const { result } = renderHook(() => useLoadouts());

            await act(async () => {
                await result.current.deleteLoadout('1');
            });

            expect(result.current.loadouts).toHaveLength(0);
        });
    });

    describe('Team Loadouts', () => {
        test('loads team loadouts from localStorage', () => {
            localStorageMock.getItem
                .mockReturnValueOnce(JSON.stringify(mockLoadouts))
                .mockReturnValueOnce(JSON.stringify(mockTeamLoadouts));

            const { result } = renderHook(() => useLoadouts());
            expect(result.current.teamLoadouts).toEqual(mockTeamLoadouts);
        });

        test('adds new team loadout', async () => {
            const { result } = renderHook(() => useLoadouts());
            const newTeamLoadout = {
                name: 'New Team',
                shipLoadouts: [
                    {
                        position: 1,
                        shipId: 'ship1',
                        equipment: { weapon: 'gear1' },
                    },
                ],
            };

            await act(async () => {
                await result.current.addTeamLoadout(newTeamLoadout);
            });

            expect(result.current.teamLoadouts).toHaveLength(1);
            expect(result.current.teamLoadouts[0]).toEqual({
                ...newTeamLoadout,
                id: '00000000-0000-0000-0000-000000000000',
                createdAt: expect.any(Number),
            });
        });

        test('prevents duplicate gear in team loadout', async () => {
            const { result } = renderHook(() => useLoadouts());
            const invalidTeamLoadout = {
                name: 'Invalid Team',
                shipLoadouts: [
                    {
                        position: 1,
                        shipId: 'ship1',
                        equipment: { weapon: 'gear1' },
                    },
                    {
                        position: 2,
                        shipId: 'ship2',
                        equipment: { weapon: 'gear1' }, // Duplicate gear
                    },
                ],
            };

            await expect(result.current.addTeamLoadout(invalidTeamLoadout)).rejects.toThrow(
                'Invalid team loadout: Duplicate gear pieces detected'
            );
        });

        test('updates team loadout', async () => {
            localStorageMock.getItem
                .mockReturnValueOnce(JSON.stringify(mockLoadouts))
                .mockReturnValueOnce(JSON.stringify(mockTeamLoadouts));

            const { result } = renderHook(() => useLoadouts());

            const updatedShipLoadouts = [
                {
                    position: 1,
                    shipId: 'ship1',
                    equipment: { weapon: 'gear5' },
                },
            ];

            await act(async () => {
                await result.current.updateTeamLoadout('1', updatedShipLoadouts);
            });

            expect(result.current.teamLoadouts[0].shipLoadouts).toEqual(updatedShipLoadouts);
        });

        test('deletes team loadout', async () => {
            localStorageMock.getItem
                .mockReturnValueOnce(JSON.stringify(mockLoadouts))
                .mockReturnValueOnce(JSON.stringify(mockTeamLoadouts));

            const { result } = renderHook(() => useLoadouts());

            await act(async () => {
                await result.current.deleteTeamLoadout('1');
            });

            expect(result.current.teamLoadouts).toHaveLength(0);
        });
    });
});
