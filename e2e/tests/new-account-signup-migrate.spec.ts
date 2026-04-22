import { test, expect } from '@playwright/test';
import {
    importGameData,
    openAuthModal,
    submitSignup,
    submitSignin,
} from '../helpers/page-actions';
import { generateTestCredentials } from '../helpers/disposableEmail';
import { installMigrationSentinel, waitForMigration } from '../helpers/wait-for-migration';
import { silenceFirstVisitOverlays } from '../helpers/silence-overlays';
import { capturePageErrors } from '../helpers/capture-page-errors';
import {
    confirmUserEmail,
    deleteTestUser,
    findUserIdByEmail,
} from '../helpers/supabaseAdmin';

const PREFIX = process.env.E2E_TEST_EMAIL_PREFIX;
const DOMAIN = process.env.E2E_TEST_EMAIL_DOMAIN;
if (!PREFIX) throw new Error('E2E_TEST_EMAIL_PREFIX is required');
if (!DOMAIN) throw new Error('E2E_TEST_EMAIL_DOMAIN is required');

test.describe('new account: signup → confirm → signin → migrate', () => {
    const created: string[] = [];

    test.beforeEach(async ({ page }, testInfo) => {
        // Both init-script helpers must run BEFORE the first page.goto so
        // the scripts are registered on the browser context for every
        // document load. The migration sentinel in particular must be in
        // place before any auth state change can dispatch
        // `app:migration:end` — otherwise a race with fast sign-in paths
        // (e.g. email confirmation OFF) could miss the event.
        capturePageErrors(page, testInfo);
        await silenceFirstVisitOverlays(page);
        await installMigrationSentinel(page);
    });

    test.afterEach(async () => {
        for (const email of created) {
            try {
                await deleteTestUser(email, PREFIX!, DOMAIN!);
            } catch (err) {
                console.warn(`cleanup failed for ${email}:`, err);
            }
        }
        created.length = 0;
    });

    test('anon import, signup, confirm, signin, migration fires, data persists', async ({
        page,
    }) => {
        const { email, password } = generateTestCredentials(PREFIX!, DOMAIN!);
        created.push(email);

        // 1. Anon import
        await page.goto('/');
        await importGameData(page);
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5', { timeout: 10_000 });

        // 2. Signup
        await openAuthModal(page);
        await submitSignup(page, email, password);

        // 3. Locate the user in auth.users (poll briefly — signup returns
        //    immediately but the user row is written asynchronously).
        let userId: string | null = null;
        for (let attempt = 0; attempt < 10 && !userId; attempt++) {
            userId = await findUserIdByEmail(email);
            if (!userId) await page.waitForTimeout(500);
        }
        expect(userId, 'user row should exist after signup').not.toBeNull();

        // 4. Confirm via admin API (skips real email click)
        await confirmUserEmail(userId!);

        // 5. Signin. The migration sentinel was installed in beforeEach via
        //    addInitScript, so the listener is already in place on every
        //    document load — we don't need to arm it here. If the modal was
        //    auto-closed after signup, reopen it; otherwise submitSignin's
        //    ensureSigninMode toggles mode as needed.
        const emailInputVisible = await page
            .getByTestId('auth-email-input')
            .isVisible()
            .catch(() => false);
        if (!emailInputVisible) {
            await openAuthModal(page);
        }
        await submitSignin(page, email, password);

        // 6. Wait for migration to complete
        await waitForMigration(page, 30_000);

        // 7. Persistence check — reload, assert ship count still shows.
        //    This exercises the Supabase READ path through RLS.
        await page.reload();
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5', { timeout: 10_000 });
    });
});
