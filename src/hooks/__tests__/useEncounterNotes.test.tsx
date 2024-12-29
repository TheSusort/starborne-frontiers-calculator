import { renderHook, act } from '../../test-utils/test-utils';
import { useEncounterNotes } from '../useEncounterNotes';
import { vi } from 'vitest';
import { EncounterNote, Position } from '../../types/encounters';

describe('useEncounterNotes Hook', () => {
    const mockEncounters: EncounterNote[] = [
        {
            id: '1',
            name: 'First Encounter',
            formation: [
                { shipId: 'ship1', position: 'T1' as Position },
                { shipId: 'ship2', position: 'M2' as Position },
            ],
            createdAt: 1234567890,
        },
        {
            id: '2',
            name: 'Second Encounter',
            formation: [
                { shipId: 'ship3', position: 'B1' as Position },
                { shipId: 'ship4', position: 'B4' as Position },
            ],
            createdAt: 1234567891,
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
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('initializes with empty encounters and loading state', () => {
        const { result } = renderHook(() => useEncounterNotes());
        expect(result.current.encounters).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });

    test('loads encounters from localStorage', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockEncounters));
        const { result } = renderHook(() => useEncounterNotes());

        expect(result.current.encounters).toEqual(mockEncounters);
        expect(result.current.isLoading).toBe(false);
        expect(localStorageMock.getItem).toHaveBeenCalledWith('encounterNotes');
    });

    test('adds new encounter', () => {
        const { result } = renderHook(() => useEncounterNotes());
        const mockNow = 1234567892;
        vi.setSystemTime(mockNow);

        const newEncounter = {
            name: 'New Encounter',
            formation: [{ shipId: 'ship5', position: 'M1' as Position }],
        };

        act(() => {
            result.current.addEncounter(newEncounter);
        });

        expect(result.current.encounters).toHaveLength(1);
        expect(result.current.encounters[0]).toEqual({
            ...newEncounter,
            id: mockNow.toString(),
            createdAt: mockNow,
        });
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'encounterNotes',
            JSON.stringify(result.current.encounters)
        );
    });

    test('updates existing encounter', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockEncounters));
        const { result } = renderHook(() => useEncounterNotes());

        const updatedEncounter = {
            ...mockEncounters[0],
            formation: [
                ...mockEncounters[0].formation,
                { shipId: 'ship6', position: 'T4' as Position },
            ],
        };

        act(() => {
            result.current.updateEncounter(updatedEncounter);
        });

        expect(result.current.encounters[0].formation).toHaveLength(3);
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'encounterNotes',
            JSON.stringify(result.current.encounters)
        );
    });

    test('deletes encounter', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockEncounters));
        const { result } = renderHook(() => useEncounterNotes());

        act(() => {
            result.current.deleteEncounter('1');
        });

        expect(result.current.encounters).toHaveLength(1);
        expect(result.current.encounters[0].id).toBe('2');
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'encounterNotes',
            JSON.stringify(result.current.encounters)
        );
    });

    test('handles localStorage errors gracefully', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.getItem.mockImplementation(() => {
            throw new Error('Storage error');
        });

        const { result } = renderHook(() => useEncounterNotes());

        expect(result.current.encounters).toEqual([]);
        expect(result.current.isLoading).toBe(false);

        consoleError.mockRestore();
    });

    test('maintains encounter order', () => {
        localStorageMock.getItem.mockReturnValue(JSON.stringify(mockEncounters));
        const { result } = renderHook(() => useEncounterNotes());

        const newEncounter = {
            name: 'New Encounter',
            formation: [{ shipId: 'ship7', position: 'M3' as Position }],
        };

        act(() => {
            result.current.addEncounter(newEncounter);
        });

        expect(result.current.encounters).toHaveLength(3);
        expect(result.current.encounters[0].name).toBe('First Encounter');
        expect(result.current.encounters[1].name).toBe('Second Encounter');
        expect(result.current.encounters[2].name).toBe('New Encounter');
    });
});