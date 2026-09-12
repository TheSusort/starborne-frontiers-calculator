import { describe, it, expect } from 'vitest';
import { StorageKey, inventoryCacheKey } from '../storage';

/**
 * Inventory lives in IndexedDB, and the cache key is profile-scoped. Backup,
 * restore and InventoryProvider must all derive it the same way — a site that
 * restates the ternary and drifts writes gear where nothing reads it.
 */
describe('inventoryCacheKey', () => {
    it('scopes the key to the active profile when one is signed in', () => {
        expect(inventoryCacheKey('profile-1')).toBe(`${StorageKey.INVENTORY}:profile-1`);
    });

    it('falls back to the unscoped key when signed out', () => {
        expect(inventoryCacheKey(null)).toBe(StorageKey.INVENTORY);
    });
});
