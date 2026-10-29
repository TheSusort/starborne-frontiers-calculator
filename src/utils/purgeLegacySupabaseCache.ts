/** The service-worker cache in which older builds stored Supabase API responses. */
export const LEGACY_SUPABASE_CACHE = 'supabase-api';

/**
 * Deletes the Supabase response cache older service workers filled, so a signed-in player's data
 * does not outlive their session on a shared browser. The current service worker never writes it
 * (no `*.supabase.co` route in `vite.config.ts`).
 */
export function purgeLegacySupabaseCache(): void {
    if (typeof caches === 'undefined') return;
    caches.delete(LEGACY_SUPABASE_CACHE).catch(() => {
        // Cache Storage can be unavailable (private mode, blocked site data); nothing to purge.
    });
}
