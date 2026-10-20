import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Ship } from '../../../types/ship';
import { IMPORT_START_EVENT } from '../../import/importEvents';

let mockShips: Ship[] = [];
vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: mockShips }),
}));
vi.mock('../../../utils/demoData', () => ({ isDemoDataLoaded: () => false }));

import { useShowFleetPanel } from '../fleetPanelState';

const SHIP = { id: 's1' } as Ship;

describe('useShowFleetPanel', () => {
    beforeEach(() => {
        mockShips = [];
    });

    it('switches to the fleet panel when ships arrive without an import', () => {
        const { result, rerender } = renderHook(() => useShowFleetPanel());
        expect(result.current).toBe(false);
        mockShips = [SHIP];
        rerender();
        expect(result.current).toBe(true);
    });

    it('keeps Quick Start once an import starts, so its import button stays mounted', () => {
        const { result, rerender } = renderHook(() => useShowFleetPanel());
        act(() => {
            window.dispatchEvent(new Event(IMPORT_START_EVENT));
        });
        mockShips = [SHIP];
        rerender();
        expect(result.current).toBe(false);
    });

    it('keeps the fleet panel when a re-import starts from it', () => {
        mockShips = [SHIP];
        const { result, rerender } = renderHook(() => useShowFleetPanel());
        act(() => {
            window.dispatchEvent(new Event(IMPORT_START_EVENT));
        });
        mockShips = [];
        rerender();
        expect(result.current).toBe(true);
    });
});
