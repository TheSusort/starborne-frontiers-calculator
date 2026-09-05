import { COVERAGE_SAMPLE_SIZE } from '../utils/gear/roleSlotCoverage';
import { usePersistedPreference } from './usePersistedPreference';

/** The only sample sizes the coverage grid's control offers. */
export const COVERAGE_SAMPLE_SIZE_STEPS = [10, 20, 50, 100, 200] as const;

function isValidStep(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        (COVERAGE_SAMPLE_SIZE_STEPS as readonly number[]).includes(value)
    );
}

/**
 * Persists the coverage grid's "target pieces per slot" sample size, via
 * `usePersistedPreference` — see that hook's doc for why persistence is
 * gated on hydration. A stored value outside `COVERAGE_SAMPLE_SIZE_STEPS`
 * (corrupted, or from a future step list this build does not offer) falls
 * back to `defaultValue` rather than being trusted.
 */
export const usePersistedCoverageSampleSize = (
    key: string,
    defaultValue: number = COVERAGE_SAMPLE_SIZE
) => usePersistedPreference(key, defaultValue, isValidStep);
