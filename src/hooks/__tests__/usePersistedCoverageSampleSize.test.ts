import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    usePersistedCoverageSampleSize,
    COVERAGE_SAMPLE_SIZE_STEPS,
} from '../usePersistedCoverageSampleSize';
import { COVERAGE_SAMPLE_SIZE } from '../../utils/gear/roleSlotCoverage';

let mockUser: { id: string } | null = null;
vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: mockUser }),
}));

const KEY = 'gear-coverage-sample-size-test';

describe('usePersistedCoverageSampleSize', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUser = null;
    });

    it('starts at the default when signed out, even with a valid stored value', () => {
        // The read is user-gated, matching usePersistedViewMode exactly: a
        // signed-out session must not pick up a leftover browser-local value.
        localStorage.setItem(KEY, '100');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('starts at the default when signed in with nothing stored', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('reads a valid stored value when signed in', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(KEY, '100');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(100);
    });

    it('falls back to the default when the stored value is not one of the allowed steps', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(KEY, '37');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('falls back to the default when the stored value is not a number at all', () => {
        mockUser = { id: 'user-1' };
        localStorage.setItem(KEY, 'not-a-number');
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        expect(result.current[0]).toBe(COVERAGE_SAMPLE_SIZE);
    });

    it('persists a change to localStorage', () => {
        mockUser = { id: 'user-1' };
        const { result } = renderHook(() => usePersistedCoverageSampleSize(KEY));
        act(() => result.current[1](200));
        expect(result.current[0]).toBe(200);
        expect(localStorage.getItem(KEY)).toBe('200');
    });

    it('offers exactly the fixed steps 10, 20, 50, 100, 200', () => {
        expect(COVERAGE_SAMPLE_SIZE_STEPS).toEqual([10, 20, 50, 100, 200]);
    });
});
