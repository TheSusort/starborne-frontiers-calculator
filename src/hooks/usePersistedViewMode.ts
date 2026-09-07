import { usePersistedPreference } from './usePersistedPreference';

type ViewMode = 'list' | 'image';

function isViewMode(value: unknown): value is ViewMode {
    return value === 'list' || value === 'image';
}

/**
 * Persists the ship inventory's list/image view choice, via
 * `usePersistedPreference` — see that hook's doc for why persistence is
 * gated on hydration. A stored value that is not a `ViewMode` (corrupted,
 * or from a shape this build no longer offers) falls back to `defaultValue`
 * rather than being trusted.
 */
export const usePersistedViewMode = (key: string, defaultValue: ViewMode = 'list') =>
    usePersistedPreference(key, defaultValue, isViewMode);
