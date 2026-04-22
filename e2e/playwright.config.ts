import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
    throw new Error('E2E_BASE_URL is required (e.g. https://starborne-frontiers-calculator.netlify.app)');
}

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    retries: 1,
    workers: 1,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
