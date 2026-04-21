import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './helpers',
    testMatch: /.*\.test\.ts$/,
    timeout: 10_000,
    fullyParallel: true,
    retries: 0,
    workers: undefined, // let Playwright use default parallelism for unit tests
    reporter: [['list']],
});
