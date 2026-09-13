import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from '../ProfilePage';
import {
    deleteUserSupabaseData,
    reuploadLocalDataToSupabase,
    pruneSupabaseDataNotInLocal,
    PRUNABLE_SECTIONS,
} from '../../services/userDataService';
import { isSupabaseSyncEnabled } from '../../utils/syncUtils';

const USER_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('../../services/userDataService', () => ({
    deleteUserSupabaseData: vi.fn().mockResolvedValue(undefined),
    reuploadLocalDataToSupabase: vi.fn().mockResolvedValue(undefined),
    pruneSupabaseDataNotInLocal: vi.fn().mockResolvedValue(undefined),
    PRUNABLE_SECTIONS: ['ships', 'inventory_items'],
}));

vi.mock('../../utils/syncUtils', () => ({
    isSupabaseSyncEnabled: vi.fn().mockReturnValue(false),
    setSupabaseSyncEnabled: vi.fn(),
}));

vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: () => ({ user: { id: USER_ID }, signOut: vi.fn() }),
}));

vi.mock('../../contexts/ActiveProfileProvider', () => ({
    useActiveProfile: () => ({
        activeProfileId: USER_ID,
        isOnAlt: false,
        refreshProfiles: vi.fn(),
    }),
}));

// One stable object: the page's load effect lists `addNotification` in its
// dependencies, so a fresh identity per render re-runs it forever and the page
// never leaves its loading state.
const notification = { addNotification: vi.fn() };
vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => notification,
}));

vi.mock('../../services/userProfileService', () => ({
    getUserProfile: vi.fn().mockResolvedValue(null),
    updateUserProfile: vi.fn(),
    checkUsernameAvailability: vi.fn(),
    getUserStats: vi.fn().mockResolvedValue(null),
    getUserUsageStats: vi.fn().mockResolvedValue(null),
    getTopShipRankings: vi.fn().mockResolvedValue([]),
}));

// Children that pull in Supabase, charts or the sidebar; none of them take part
// in the ordering this file is about.
vi.mock('../../components/import/BackupRestoreData', () => ({
    BackupRestoreData: () => null,
}));
vi.mock('../../components/profile/AltAccountsSection', () => ({
    AltAccountsSection: () => null,
}));
vi.mock('../../components/engineering/EngineeringLeaderboards', () => ({
    EngineeringLeaderboards: () => null,
}));
vi.mock('../../components/auth/AuthModal', () => ({ AuthModal: () => null }));
vi.mock('../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../components/seo/Seo', () => ({ default: () => null }));

/** The page loads its profile asynchronously and shows a loader until it lands. */
const renderDataTab = async () => {
    render(
        <MemoryRouter initialEntries={['/profile?tab=data']}>
            <ProfilePage />
        </MemoryRouter>
    );
    await screen.findByText('Cloud Sync');
};

/**
 * The order these two ran in is the whole fix. Deleting the cloud copy first
 * and uploading second means a failed upload leaves the account with nothing —
 * the shape that emptied cloud gear and ships in #504. Recording the calls in a
 * shared list is what lets a test see the order rather than just the pair.
 */
const recordCallOrder = () => {
    const order: string[] = [];
    (deleteUserSupabaseData as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('delete');
    });
    (reuploadLocalDataToSupabase as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('upload');
    });
    (pruneSupabaseDataNotInLocal as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('prune');
    });
    return order;
};

describe('ProfilePage cloud sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        (isSupabaseSyncEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });

    describe('enabling sync', () => {
        it('uploads local data before removing anything from the cloud', async () => {
            const order = recordCallOrder();
            await renderDataTab();

            fireEvent.click(screen.getByRole('switch'));

            await waitFor(() => expect(order).toEqual(['upload', 'prune']));
        });

        it('prunes rather than wiping the account first', async () => {
            await renderDataTab();

            fireEvent.click(screen.getByRole('switch'));

            await waitFor(() => expect(pruneSupabaseDataNotInLocal).toHaveBeenCalled());
            expect(deleteUserSupabaseData).not.toHaveBeenCalled();
        });

        it('names every prunable section, since local replaces the whole cloud copy', async () => {
            await renderDataTab();

            fireEvent.click(screen.getByRole('switch'));

            await waitFor(() =>
                expect(pruneSupabaseDataNotInLocal).toHaveBeenCalledWith(USER_ID, PRUNABLE_SECTIONS)
            );
        });

        // A prune that throws must not leave the toggle claiming sync is on: the
        // cloud copy is then a partial replacement nobody has reconciled.
        it('leaves sync off when the prune fails', async () => {
            (pruneSupabaseDataNotInLocal as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
                new Error('prune failed')
            );
            await renderDataTab();

            fireEvent.click(screen.getByRole('switch'));

            await waitFor(() => expect(pruneSupabaseDataNotInLocal).toHaveBeenCalled());
            expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
        });
    });

    describe('clear and re-sync', () => {
        beforeEach(() => {
            (isSupabaseSyncEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        });

        const confirmClearAndReSync = () => {
            fireEvent.click(screen.getByRole('button', { name: 'Clear & re-sync' }));
            fireEvent.click(screen.getByRole('button', { name: 'Clear & Re-sync' }));
        };

        it('uploads local data before removing anything from the cloud', async () => {
            const order = recordCallOrder();
            await renderDataTab();

            confirmClearAndReSync();

            await waitFor(() => expect(order).toEqual(['upload', 'prune']));
        });

        it('prunes rather than wiping the account first', async () => {
            await renderDataTab();

            confirmClearAndReSync();

            await waitFor(() => expect(pruneSupabaseDataNotInLocal).toHaveBeenCalled());
            expect(deleteUserSupabaseData).not.toHaveBeenCalled();
        });
    });

    // Turning sync OFF is the one caller that should still empty the account:
    // there is no local copy being mirrored, the user is asking for removal.
    describe('disabling sync', () => {
        it('still deletes every cloud row', async () => {
            (isSupabaseSyncEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
            await renderDataTab();

            fireEvent.click(screen.getByRole('switch'));
            fireEvent.click(screen.getByRole('button', { name: 'Disable Sync' }));

            await waitFor(() => expect(deleteUserSupabaseData).toHaveBeenCalledWith(USER_ID));
            expect(reuploadLocalDataToSupabase).not.toHaveBeenCalled();
        });
    });
});
