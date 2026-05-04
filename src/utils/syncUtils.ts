import { StorageKey } from '../constants/storage';

export function isSupabaseSyncEnabled(): boolean {
    return localStorage.getItem(StorageKey.SUPABASE_SYNC_ENABLED) !== 'false';
}

export function setSupabaseSyncEnabled(enabled: boolean): void {
    localStorage.setItem(StorageKey.SUPABASE_SYNC_ENABLED, String(enabled));
}
