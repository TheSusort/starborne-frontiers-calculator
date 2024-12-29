import { renderHook } from '../../test-utils/test-utils';
import { useTeamGearLookup, useTeamGearSets } from '../useTeamGear';
import { GearPiece } from '../../types/gear';
import { TeamLoadout } from '../../types/loadout';
import { vi } from 'vitest';

describe('useTeamGear Hooks', () => {
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
            slot: 'generator',
            level: 1,
            stars: 5,
            rarity: 'epic',
            mainStat: { name: 'defence', value: 1500, type: 'flat' },
            subStats: [],
            setBonus: 'SHIELD',
            shipId: 'ship2',
        },
    };

    const mockShipLoadouts: TeamLoadout['shipLoadouts'] = [
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
                generator: 'gear3',
            },
        },
    ];

    const getGearPiece = vi.fn((id: string) => mockGearPieces[id]);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('useTeamGearLookup', () => {
        test('creates lookup object for each ship position', () => {
            const { result } = renderHook(() => useTeamGearLookup(mockShipLoadouts, getGearPiece));

            expect(result.current[1]).toBeDefined();
            expect(result.current[2]).toBeDefined();
            expect(result.current[1]['gear1']).toBe(mockGearPieces['gear1']);
            expect(result.current[1]['gear2']).toBe(mockGearPieces['gear2']);
            expect(result.current[2]['gear3']).toBe(mockGearPieces['gear3']);
        });

        test('handles empty loadouts', () => {
            const { result } = renderHook(() => useTeamGearLookup([], getGearPiece));

            expect(Object.keys(result.current)).toHaveLength(0);
            expect(getGearPiece).not.toHaveBeenCalled();
        });

        test('memoizes results', () => {
            const { result, rerender } = renderHook(() =>
                useTeamGearLookup(mockShipLoadouts, getGearPiece)
            );

            const firstResult = result.current;
            rerender();
            expect(result.current).toBe(firstResult);
        });

        test('updates when loadouts change', () => {
            const { result, rerender } = renderHook(
                ({ loadouts }) => useTeamGearLookup(loadouts, getGearPiece),
                {
                    initialProps: { loadouts: mockShipLoadouts },
                }
            );

            const newLoadouts = [
                {
                    position: 1,
                    shipId: 'ship1',
                    equipment: { weapon: 'gear1' },
                },
            ];

            rerender({ loadouts: newLoadouts });

            expect(Object.keys(result.current[1])).toHaveLength(1);
            expect(result.current[1]['gear1']).toBe(mockGearPieces['gear1']);
            expect(result.current[2]).toBeUndefined();
        });
    });

    describe('useTeamGearSets', () => {
        test('calculates gear sets for each position', () => {
            const gearLookups = {
                1: {
                    gear1: mockGearPieces['gear1'],
                    gear2: mockGearPieces['gear2'],
                },
                2: {
                    gear3: mockGearPieces['gear3'],
                },
            };

            const { result } = renderHook(() => useTeamGearSets(mockShipLoadouts, gearLookups));

            expect(result.current[1]).toContain('CRITICAL');
            expect(result.current[2]).not.toContain('CRITICAL');
            expect(result.current[2]).not.toContain('SHIELD'); // Only one piece, not enough for set
        });

        test('handles empty loadouts', () => {
            const { result } = renderHook(() => useTeamGearSets([], {}));

            expect(Object.keys(result.current)).toHaveLength(0);
        });

        test('memoizes results', () => {
            const gearLookups: Record<number, Record<string, GearPiece>> = {
                1: {
                    gear1: mockGearPieces['gear1'],
                    gear2: mockGearPieces['gear2'],
                },
                2: {
                    gear3: mockGearPieces['gear3'],
                },
            };

            const { result, rerender } = renderHook(() =>
                useTeamGearSets(mockShipLoadouts, gearLookups)
            );

            const firstResult = result.current;
            rerender();
            expect(result.current).toBe(firstResult);
        });

        test('updates when loadouts or lookups change', () => {
            // Use only position 1 loadout to match our lookups
            const singleLoadout = [mockShipLoadouts[0]];

            const initialLookups: Record<number, Record<string, GearPiece>> = {
                1: {
                    gear1: mockGearPieces['gear1'],
                    gear2: mockGearPieces['gear2'],
                },
            };

            const { result, rerender } = renderHook(
                ({ lookups }: { lookups: Record<number, Record<string, GearPiece>> }) =>
                    useTeamGearSets(singleLoadout, lookups),
                {
                    initialProps: { lookups: initialLookups },
                }
            );

            const newLookups: Record<number, Record<string, GearPiece>> = {
                1: {
                    gear1: mockGearPieces['gear1'],
                },
            };

            rerender({ lookups: newLookups });

            expect(result.current[1]).toHaveLength(0);
        });
    });
});
