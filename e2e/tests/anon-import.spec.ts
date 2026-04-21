import { test, expect } from '@playwright/test';
import { importGameData } from '../helpers/page-actions';

test.describe('anonymous user imports game data', () => {
    test('imports, navigates, runs autogear, persists on reload', async ({ page }) => {
        // 1. Fresh context — Playwright gives us one per test by default.
        await page.goto('/');

        // 2. Upload the fixture
        await importGameData(page);

        // 3. Assert ships show up on the ships page
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5', { timeout: 10_000 });

        // 4. Assert gear shows up on the gear page.
        // Fixture has 13 equipment items: 10 gear + 3 implants.
        // GearPage passes the full inventory (implants included) to GearInventory,
        // and GearInventory's default filters do NOT hide implants, so the
        // `gear-count` testid reflects sortedInventory.length for the full set.
        await page.goto('/gear');
        await expect(page.getByTestId('gear-count')).toHaveText('13', { timeout: 10_000 });

        // 5. Smoke-test autogear — navigate, start a run, wait for suggestions.
        await page.goto('/autogear');
        await page.getByTestId('autogear-start').click();
        await expect(page.getByTestId('autogear-suggestions')).toBeVisible({
            timeout: 30_000,
        });

        // 6. Reload — data must persist via localStorage.
        await page.reload();
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5');
    });
});
