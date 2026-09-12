import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackupRestoreData } from '../BackupRestoreData';
import { StorageKey, inventoryCacheKey } from '../../../constants/storage';
import { getFromIndexedDB, setInIndexedDB } from '../../../hooks/useStorage';
import { reuploadLocalDataToSupabase } from '../../../services/userDataService';
import { supabase } from '../../../config/supabase';

// ui/index → Sidebar → /favicon.ico?url which Vitest cannot resolve
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const PROFILE_ID = '11111111-1111-4111-8111-111111111111';

let activeProfileId: string | null = PROFILE_ID;

vi.mock('../../../hooks/useStorage', () => ({
    getFromIndexedDB: vi.fn(),
    setInIndexedDB: vi.fn().mockResolvedValue(undefined),
    clearIndexedDBStorage: vi.fn().mockResolvedValue(undefined),
    removeFromIndexedDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/userDataService', () => ({
    reuploadLocalDataToSupabase: vi.fn().mockResolvedValue(undefined),
    pruneSupabaseDataNotIn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../config/supabase', () => ({
    supabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: { id: PROFILE_ID }, signOut: vi.fn() }),
}));

vi.mock('../../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({ activeProfileId }),
}));

const GEAR = [
    {
        id: 'gear-1',
        slot: 'weapon',
        level: 12,
        stars: 5,
        rarity: 'legendary',
        setBonus: 'CRITICAL',
        mainStat: { name: 'attack', value: 120, type: 'flat' },
        subStats: [{ name: 'crit', value: 8, type: 'percentage' }],
    },
];

const SHIPS = [{ id: 'ship-1', name: 'Aegis', baseStats: { hp: 1000 }, equipment: {}, refits: [] }];

/** jsdom's Blob has no `.text()`; FileReader is the one reader it does implement. */
const readBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsText(blob);
    });

/** Drives the hidden file input with a backup file and waits for the async read. */
const restoreFile = async (backup: Record<string, string>) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
};

describe('BackupRestoreData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeProfileId = PROFILE_ID;
        localStorage.clear();
        (setInIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (getFromIndexedDB as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        (reuploadLocalDataToSupabase as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('backup', () => {
        it('includes the gear inventory, which lives in IndexedDB and not localStorage', async () => {
            localStorage.setItem(StorageKey.SHIPS, JSON.stringify(SHIPS));
            (getFromIndexedDB as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
                Promise.resolve(key === inventoryCacheKey(PROFILE_ID) ? GEAR : undefined)
            );

            // jsdom implements neither half of the object-URL API.
            const blobs: Blob[] = [];
            URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
                blobs.push(blob as Blob);
                return 'blob:stub';
            });
            URL.revokeObjectURL = vi.fn();

            render(<BackupRestoreData />);
            fireEvent.click(screen.getByRole('button', { name: /backup data/i }));

            await waitFor(() => expect(blobs).toHaveLength(1));

            const parsed = JSON.parse(await readBlob(blobs[0])) as Record<string, string>;
            expect(JSON.parse(parsed[StorageKey.INVENTORY])).toEqual(GEAR);
        });
    });

    describe('restore', () => {
        it('writes the gear inventory to IndexedDB under the profile key, not to localStorage', async () => {
            render(<BackupRestoreData />);
            await restoreFile({ [StorageKey.INVENTORY]: JSON.stringify(GEAR) });

            await waitFor(() =>
                expect(setInIndexedDB).toHaveBeenCalledWith(inventoryCacheKey(PROFILE_ID), GEAR)
            );
            expect(localStorage.getItem(StorageKey.INVENTORY)).toBeNull();
        });

        it('never deletes cloud rows itself — the sync path owns every write', async () => {
            render(<BackupRestoreData />);
            await restoreFile({
                [StorageKey.SHIPS]: JSON.stringify(SHIPS),
                [StorageKey.INVENTORY]: JSON.stringify(GEAR),
            });

            await waitFor(() =>
                expect(reuploadLocalDataToSupabase).toHaveBeenCalledWith(PROFILE_ID)
            );
            expect(supabase.from).not.toHaveBeenCalled();
        });

        it('leaves the cloud untouched when signed out', async () => {
            activeProfileId = null;
            render(<BackupRestoreData />);
            await restoreFile({ [StorageKey.SHIPS]: JSON.stringify(SHIPS) });

            await waitFor(() =>
                expect(localStorage.getItem(StorageKey.SHIPS)).toBe(JSON.stringify(SHIPS))
            );
            expect(reuploadLocalDataToSupabase).not.toHaveBeenCalled();
            expect(supabase.from).not.toHaveBeenCalled();
        });
    });
});
