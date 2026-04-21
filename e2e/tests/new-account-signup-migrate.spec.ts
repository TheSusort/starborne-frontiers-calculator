import { test, expect } from '@playwright/test';
import {
    importGameData,
    openAuthModal,
    submitSignup,
    submitSignin,
} from '../helpers/page-actions';
import { generateTestCredentials } from '../helpers/disposableEmail';
import { armMigrationListener } from '../helpers/wait-for-migration';
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

        // 5. Arm migration listener BEFORE signin — if armed after, the
        //    'app:migration:end' event could fire before Playwright's
        //    listener attaches, and we'd wait forever.
        const awaitMigration = await armMigrationListener(page);

        // 6. Signin. If the modal was auto-closed after signup, reopen it.
        //    Otherwise submitSignin's ensureSigninMode toggles mode as needed.
        const emailInputVisible = await page
            .getByTestId('auth-email-input')
            .isVisible()
            .catch(() => false);
        if (!emailInputVisible) {
            await openAuthModal(page);
        }
        await submitSignin(page, email, password);

        // 7. Wait for migration to complete
        await awaitMigration(30_000);

        // 8. Persistence check — reload, assert ship count still shows.
        //    This exercises the Supabase READ path through RLS.
        await page.reload();
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5', { timeout: 10_000 });
    });
});
