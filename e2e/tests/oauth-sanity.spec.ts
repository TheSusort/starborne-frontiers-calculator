import { test, expect } from '@playwright/test';
import { silenceFirstVisitOverlays } from '../helpers/silence-overlays';
import { capturePageErrors } from '../helpers/capture-page-errors';

test.describe('google oauth redirect sanity', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        capturePageErrors(page, testInfo);
        await silenceFirstVisitOverlays(page);
    });

    test('clicking google button redirects to accounts.google.com with a client_id', async ({
        page,
    }) => {
        await page.goto('/');

        // Open the auth modal. We do NOT use openAuthModal() from page-actions
        // because that helper clicks "Continue with Email" and hides the
        // Google button. The Google button lives on the initial modal screen.
        await page.getByTestId('open-auth-modal').click();
        await expect(page.getByTestId('auth-google-button')).toBeVisible();

        // Clicking Google triggers a top-level navigation to accounts.google.com.
        // We wait for the URL to match, then inspect the query params.
        const navigationPromise = page.waitForURL(/accounts\.google\.com/, {
            timeout: 15_000,
        });
        await page.getByTestId('auth-google-button').click();
        await navigationPromise;

        const url = new URL(page.url());
        expect(url.hostname).toBe('accounts.google.com');
        expect(url.searchParams.get('client_id')).toBeTruthy();

        // Do not complete the OAuth flow. Test ends here.
    });
});
