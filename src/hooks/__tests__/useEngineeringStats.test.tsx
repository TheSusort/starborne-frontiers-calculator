import { renderHook, act } from '../../test-utils/test-utils';
import { useEngineeringStats } from '../useEngineeringStats';
import { vi } from 'vitest';
import { EngineeringStats, Stat } from '../../types/stats';
import { ShipTypeName } from '../../constants/shipTypes';

describe('useEngineeringStats Hook', () => {
    const mockStats: EngineeringStats = {
        stats: [
            {
                shipType: 'ATTACKER',
                stats: [
                    {
                        name: 'attack',
                        value: 25,
                        type: 'percentage',
                    },
                    {
                        name: 'critDamage',
                        value: 15,
                        type: 'percentage',
                    },
                ] as Stat[],
            },
            {
                shipType: 'DEFENDER',
                stats: [
                    {
                        name: 'defence',
                        value: 30,
                        type: 'percentage',
                    },
                    {
                        name: 'hp',
                        value: 20,
                        type: 'percentage',
                    },
                ] as Stat[],
            },
        ],
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

    test('initializes with empty stats', () => {
        const { result } = renderHook(() => useEngineeringStats());
        expect(result.current.engineeringStats).toEqual({ stats: [] });
    });

    test('loads stats from localStorage', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockStats));
        const { result } = renderHook(() => useEngineeringStats());

        expect(result.current.engineeringStats).toEqual(mockStats);
        expect(localStorageMock.getItem).toHaveBeenCalledWith('engineeringStats');
    });

    test('saves engineering stats', () => {
        const { result } = renderHook(() => useEngineeringStats());

        act(() => {
            result.current.saveEngineeringStats(mockStats);
        });

        expect(result.current.engineeringStats).toEqual(mockStats);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'engineeringStats',
            JSON.stringify(mockStats)
        );
    });

    test('deletes engineering stats for a ship type', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockStats));
        const { result } = renderHook(() => useEngineeringStats());

        act(() => {
            result.current.deleteEngineeringStats('ATTACKER');
        });

        expect(result.current.engineeringStats.stats).toHaveLength(1);
        expect(result.current.engineeringStats.stats[0].shipType).toBe('DEFENDER');
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'engineeringStats',
            JSON.stringify(result.current.engineeringStats)
        );
    });

    test('gets engineering stats for specific ship type', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockStats));
        const { result } = renderHook(() => useEngineeringStats());

        const attackerStats = result.current.getEngineeringStatsForShipType('ATTACKER');
        expect(attackerStats).toEqual(mockStats.stats[0]);

        const defenderStats = result.current.getEngineeringStatsForShipType('DEFENDER');
        expect(defenderStats).toEqual(mockStats.stats[1]);

        const nonExistentStats = result.current.getEngineeringStatsForShipType(
            'SUPPORTER' as ShipTypeName
        );
        expect(nonExistentStats).toBeUndefined();
    });

    test('gets all allowed stats', () => {
        const { result } = renderHook(() => useEngineeringStats());
        const allowedStats = result.current.getAllAllowedStats();

        // Test a few key stats
        expect(allowedStats.attack.allowedTypes).toEqual(['percentage']);
        expect(allowedStats.hp.allowedTypes).toEqual(['percentage']);
        expect(allowedStats.hacking.allowedTypes).toEqual(['flat']);
        expect(allowedStats.crit.allowedTypes).toEqual([]);
    });

    test('handles localStorage errors gracefully', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.getItem.mockImplementation(() => {
            throw new Error('Storage error');
        });

        const { result } = renderHook(() => useEngineeringStats());

        expect(result.current.engineeringStats).toEqual({ stats: [] });
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    test('handles malformed JSON in localStorage', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.getItem.mockReturnValue('invalid json');

        const { result } = renderHook(() => useEngineeringStats());

        expect(result.current.engineeringStats).toEqual({ stats: [] });
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });
});
