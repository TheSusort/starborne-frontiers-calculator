import { afterEach, describe, expect, it } from 'vitest';
import { isSupabaseSyncEnabled } from '../syncUtils';

describe('isSupabaseSyncEnabled', () => {
    afterEach(() => {
        localStorage.removeItem('supabase_sync_enabled');
    });

    it('returns true when flag is absent (default)', () => {
        expect(isSupabaseSyncEnabled()).toBe(true);
    });

    it('returns true when flag is set to "true"', () => {
        localStorage.setItem('supabase_sync_enabled', 'true');
        expect(isSupabaseSyncEnabled()).toBe(true);
    });

    it('returns false when flag is set to "false"', () => {
        localStorage.setItem('supabase_sync_enabled', 'false');
        expect(isSupabaseSyncEnabled()).toBe(false);
    });
});
