import { renderHook } from '../../test-utils/test-utils';
import { useGearLookup, useGearSets } from '../useGear';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { vi } from 'vitest';

describe('useGear Hooks', () => {
    const mockGearPieces: GearPiece[] = [
        {
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
        {
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
        {
            id: 'gear3',
            slot: 'generator',
            level: 1,
            stars: 5,
            rarity: 'legendary',
            mainStat: { name: 'defence', value: 1500, type: 'flat' },
            subStats: [],
            setBonus: 'SHIELD',
            shipId: 'ship1',
        },
    ];

    const mockEquipment: Ship['equipment'] = {
        weapon: 'gear1',
        hull: 'gear2',
        generator: 'gear3',
    };

    describe('useGearLookup', () => {
        const getGearPiece = vi.fn((id: string) => mockGearPieces.find((gear) => gear.id === id));

        beforeEach(() => {
            vi.clearAllMocks();
        });

        test('creates lookup object for equipped gear', () => {
            const { result } = renderHook(() => useGearLookup(mockEquipment, getGearPiece));

            expect(result.current['gear1']).toBe(mockGearPieces[0]);
            expect(result.current['gear2']).toBe(mockGearPieces[1]);
            expect(result.current['gear3']).toBe(mockGearPieces[2]);
            expect(getGearPiece).toHaveBeenCalledTimes(3);
        });

        test('handles empty equipment', () => {
            const { result } = renderHook(() => useGearLookup({}, getGearPiece));

            expect(Object.keys(result.current)).toHaveLength(0);
            expect(getGearPiece).not.toHaveBeenCalled();
        });

        test('handles undefined gear pieces', () => {
            const emptyGetGearPiece = vi.fn(() => undefined);
            const { result } = renderHook(() => useGearLookup(mockEquipment, emptyGetGearPiece));

            expect(Object.keys(result.current)).toHaveLength(3);
            Object.values(result.current).forEach((value) => {
                expect(value).toBeUndefined();
            });
        });

        test('memoizes results', () => {
            const { result, rerender } = renderHook(() =>
                useGearLookup(mockEquipment, getGearPiece)
            );

            const firstResult = result.current;
            rerender();
            expect(result.current).toBe(firstResult);
        });
    });

    describe('useGearSets', () => {
        test('calculates active set bonuses', () => {
            const gearLookup = {
                gear1: mockGearPieces[0],
                gear2: mockGearPieces[1],
                gear3: mockGearPieces[2],
            };

            const { result } = renderHook(() => useGearSets(mockEquipment, gearLookup));

            expect(result.current).toContain('CRITICAL');
            expect(result.current).not.toContain('SHIELD');
            expect(result.current).toHaveLength(1); // One complete CRITICAL set
        });

        test('handles multiple complete sets', () => {
            const gearWithMultipleSets = {
                ...mockEquipment,
                sensor: 'gear4',
                software: 'gear5',
            };

            const gearLookup = {
                gear1: mockGearPieces[0],
                gear2: mockGearPieces[1],
                gear3: { ...mockGearPieces[2], setBonus: 'CRITICAL' },
                gear4: { ...mockGearPieces[0], id: 'gear4', setBonus: 'CRITICAL' },
                gear5: { ...mockGearPieces[1], id: 'gear5', setBonus: 'SHIELD' },
            };

            const { result } = renderHook(() => useGearSets(gearWithMultipleSets, gearLookup));

            expect(result.current.filter((set) => set === 'CRITICAL')).toHaveLength(2);
            expect(result.current).not.toContain('SHIELD');
        });

        test('handles empty equipment', () => {
            const { result } = renderHook(() => useGearSets({}, {}));

            expect(result.current).toHaveLength(0);
        });

        test('memoizes results', () => {
            const gearLookup = {
                gear1: mockGearPieces[0],
                gear2: mockGearPieces[1],
                gear3: mockGearPieces[2],
            };

            const { result, rerender } = renderHook(() => useGearSets(mockEquipment, gearLookup));

            const firstResult = result.current;
            rerender();
            expect(result.current).toBe(firstResult);
        });
    });
});
