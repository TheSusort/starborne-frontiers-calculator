import { Page, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', 'fixtures', 'gameData.json');

/**
 * Uploads the committed fixture via the ImportButton's file input.
 * The input is hidden behind a click-to-trigger Button, but Playwright can
 * setInputFiles directly on the hidden <input type="file">.
 */
export async function importGameData(page: Page): Promise<void> {
    const input = page.getByTestId('import-game-data-input');
    await input.setInputFiles(FIXTURE_PATH);
    // Import is async — wait for the button to re-enable after the import
    // pipeline resolves. The input itself is disabled during import.
    await expect(input).toBeEnabled({ timeout: 30_000 });
}

/**
 * Opens the auth modal and clicks "Continue with Email" so the email/password
 * form is visible. Leaves the modal in whichever mode it defaults to (signup
 * or signin) — call ensureSignupMode / ensureSigninMode after this if needed.
 */
export async function openAuthModal(page: Page): Promise<void> {
    await page.getByTestId('open-auth-modal').click();
    await page.getByTestId('auth-continue-with-email').click();
    await expect(page.getByTestId('auth-email-input')).toBeVisible();
}

/**
 * Ensures the modal is in signup mode. If it defaults to signin, clicks the
 * toggle. No-op if already in signup mode.
 */
export async function ensureSignupMode(page: Page): Promise<void> {
    const signupSubmit = page.getByTestId('auth-signup-submit');
    if (!(await signupSubmit.isVisible().catch(() => false))) {
        await page.getByTestId('auth-toggle-mode').click();
        await expect(signupSubmit).toBeVisible();
    }
}

/**
 * Ensures the modal is in signin mode.
 */
export async function ensureSigninMode(page: Page): Promise<void> {
    const signinSubmit = page.getByTestId('auth-signin-submit');
    if (!(await signinSubmit.isVisible().catch(() => false))) {
        await page.getByTestId('auth-toggle-mode').click();
        await expect(signinSubmit).toBeVisible();
    }
}

/**
 * Submits the signup form. Assumes modal is open and email form is visible.
 * Toggles to signup mode if needed.
 */
export async function submitSignup(page: Page, email: string, password: string): Promise<void> {
    await ensureSignupMode(page);
    await page.getByTestId('auth-email-input').fill(email);
    await page.getByTestId('auth-password-input').fill(password);
    await page.getByTestId('auth-signup-submit').click();
}

/**
 * Submits the signin form. Assumes modal is open and email form is visible.
 * Toggles to signin mode if needed.
 */
export async function submitSignin(page: Page, email: string, password: string): Promise<void> {
    await ensureSigninMode(page);
    await page.getByTestId('auth-email-input').fill(email);
    await page.getByTestId('auth-password-input').fill(password);
    await page.getByTestId('auth-signin-submit').click();
}
