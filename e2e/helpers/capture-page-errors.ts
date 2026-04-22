import { Page, TestInfo } from '@playwright/test';

/**
 * Attach listeners that surface browser-side errors in the test log so
 * failures aren't silent. Logs:
 *   - console.error / console.warn messages
 *   - uncaught page exceptions (pageerror)
 *   - failed network requests
 *
 * Call once per test (typically from beforeEach) BEFORE the first page.goto.
 */
export function capturePageErrors(page: Page, testInfo: TestInfo): void {
    const tag = `[page ${testInfo.title}]`;

    page.on('console', (msg) => {
        const type = msg.type();
        if (type === 'error' || type === 'warning') {
            console.log(`${tag} console.${type}: ${msg.text()}`);
        }
    });

    page.on('pageerror', (err) => {
        console.log(`${tag} pageerror: ${err.message}\n${err.stack ?? ''}`);
    });

    page.on('requestfailed', (req) => {
        console.log(`${tag} requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
    });
}
