import { Page } from '@playwright/test';

/**
 * Installs a migration sentinel BEFORE the first page load, via
 * `addInitScript`, so the listener is always attached before any
 * auth state change can fire `app:migration:end`. This is strictly
 * safer than arming after signup: even if email confirmation is OFF
 * and signup triggers an immediate migration, the listener is already
 * in place because init scripts run on every document load.
 *
 * Call this once, at the top of a test (or in a beforeEach), BEFORE
 * the first `page.goto()`. Then call `waitForMigration(page)` at the
 * point you want to block until the event fires.
 */
export async function installMigrationSentinel(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as unknown as { __e2eMigrationEnded?: boolean }).__e2eMigrationEnded = false;
        window.addEventListener(
            'app:migration:end',
            () => {
                (window as unknown as { __e2eMigrationEnded: boolean }).__e2eMigrationEnded =
                    true;
            },
            { once: true }
        );
    });
}

/**
 * Waits until the sentinel installed by `installMigrationSentinel` flips
 * to true. Throws on timeout.
 */
export async function waitForMigration(page: Page, timeoutMs = 30_000): Promise<void> {
    await page.waitForFunction(
        () =>
            (window as unknown as { __e2eMigrationEnded?: boolean }).__e2eMigrationEnded ===
            true,
        null,
        { timeout: timeoutMs }
    );
}

/**
 * @deprecated Use `installMigrationSentinel` + `waitForMigration` instead.
 * The previous API installed the listener via `page.evaluate`, which
 * requires the page to already be loaded. That leaves a window where
 * signup (with email confirmation OFF) could fire the migration event
 * before the listener attaches. The new helpers install the listener
 * via `addInitScript`, guaranteeing it runs on every document load.
 *
 * Retained as a thin wrapper for backwards compatibility; new callers
 * should prefer the two-phase helpers.
 */
export async function armMigrationListener(
    page: Page
): Promise<(timeoutMs: number) => Promise<void>> {
    await page.evaluate(() => {
        (window as unknown as { __e2eMigrationEnded?: boolean }).__e2eMigrationEnded = false;
        window.addEventListener(
            'app:migration:end',
            () => {
                (window as unknown as { __e2eMigrationEnded: boolean }).__e2eMigrationEnded =
                    true;
            },
            { once: true }
        );
    });

    return async (timeoutMs: number) => {
        await waitForMigration(page, timeoutMs);
    };
}
