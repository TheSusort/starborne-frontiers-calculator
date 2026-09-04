import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import { COVERAGE_SAMPLE_SIZE } from '../utils/gear/roleSlotCoverage';

/** The only sample sizes the coverage grid's control offers. */
export const COVERAGE_SAMPLE_SIZE_STEPS = [10, 20, 50, 100, 200] as const;

function isValidStep(value: number): boolean {
    return (COVERAGE_SAMPLE_SIZE_STEPS as readonly number[]).includes(value);
}

/**
 * Persists the coverage grid's "target pieces per slot" sample size to
 * localStorage, mirroring `usePersistedViewMode`'s shape exactly: the read
 * is gated on `user` (so a signed-out session starts at the default rather
 * than someone else's leftover browser-local value) but the write is not.
 * A stored value outside `COVERAGE_SAMPLE_SIZE_STEPS` (corrupted, or from a
 * future step list this build does not offer) falls back to `defaultValue`
 * rather than being trusted.
 */
export const usePersistedCoverageSampleSize = (
    key: string,
    defaultValue: number = COVERAGE_SAMPLE_SIZE
) => {
    const { user } = useAuth();
    const [sampleSize, setSampleSize] = useState<number>(() => {
        const stored = user ? localStorage.getItem(key) : null;
        const parsed = stored === null ? NaN : Number(stored);
        return isValidStep(parsed) ? parsed : defaultValue;
    });

    useEffect(() => {
        localStorage.setItem(key, String(sampleSize));
    }, [key, sampleSize]);

    return [sampleSize, setSampleSize] as const;
};
