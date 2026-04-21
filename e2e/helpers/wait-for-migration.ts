import { Page } from '@playwright/test';

/**
 * Install a listener in the page BEFORE triggering sign-in, so the migration
 * event cannot fire before we're listening. Returns a handle to await.
 *
 * Usage:
 *   const migrationDone = await armMigrationListener(page);
 *   await signIn(page, email, password);
 *   await migrationDone(30_000);
 */
export async function armMigrationListener(page: Page): Promise<(timeoutMs: number) => Promise<void>> {
    await page.evaluate(() => {
        (window as unknown as { __e2eMigrationEnded?: boolean }).__e2eMigrationEnded = false;
        window.addEventListener(
            'app:migration:end',
            () => {
                (window as unknown as { __e2eMigrationEnded: boolean }).__e2eMigrationEnded = true;
            },
            { once: true }
        );
    });

    return async (timeoutMs: number) => {
        await page.waitForFunction(
            () =>
                (window as unknown as { __e2eMigrationEnded?: boolean }).__e2eMigrationEnded === true,
            null,
            { timeout: timeoutMs }
        );
    };
}
