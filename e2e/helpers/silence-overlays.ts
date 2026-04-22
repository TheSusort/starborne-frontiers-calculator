import { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Reads the current app version from `src/constants/changelog.ts` once per
 * process. We parse the raw file text instead of importing the module so
 * the e2e tsconfig doesn't need to include `src/**`.
 */
let cachedVersion: string | null = null;
function readCurrentVersion(): string {
    if (cachedVersion) return cachedVersion;
    const source = readFileSync(
        resolve(__dirname, '..', '..', 'src', 'constants', 'changelog.ts'),
        'utf8'
    );
    const match = source.match(/CURRENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!match) {
        throw new Error(
            'Could not parse CURRENT_VERSION out of src/constants/changelog.ts'
        );
    }
    cachedVersion = match[1];
    return cachedVersion;
}

/**
 * Pre-seeds localStorage in the next page load so tutorial and changelog
 * overlays never render in a fresh Playwright context. Must be called
 * BEFORE `page.goto()` so the init script runs on first load and the
 * overlays never get a chance to mount and intercept clicks.
 *
 * Keys (source of truth):
 * - `tutorial_completed_groups` — src/contexts/TutorialContext.tsx
 *   (STORAGE_KEY constant). Value is a JSON array of completed group ids.
 *   Seeding the known auto-start groups means the check in
 *   `hasCompletedGroup(...)` returns true and the effect never calls
 *   `startGroup`, so TutorialOverlay (z-[100], spotlight z-101) never
 *   mounts over test targets.
 * - `changelog_state` — StorageKey.CHANGELOG_STATE, read in src/App.tsx.
 *   Value is `{ lastSeenVersion: string }`. App.tsx shows the modal iff
 *   `savedState.lastSeenVersion !== CURRENT_VERSION`, so we must seed the
 *   exact current version string. We parse it from
 *   `src/constants/changelog.ts` at helper-init time.
 */
export async function silenceFirstVisitOverlays(page: Page): Promise<void> {
    const currentVersion = readCurrentVersion();

    await page.addInitScript(
        ({ version, groups }: { version: string; groups: string[] }) => {
            try {
                window.localStorage.setItem(
                    'tutorial_completed_groups',
                    JSON.stringify(groups)
                );
            } catch {
                // localStorage may be unavailable on about:blank — ignore.
            }

            try {
                window.localStorage.setItem(
                    'changelog_state',
                    JSON.stringify({ lastSeenVersion: version })
                );
            } catch {
                // ignore
            }
        },
        {
            version: currentVersion,
            // Known group ids that auto-start on first visit. Seeding all of
            // them is defensive; unknown ids are harmless.
            groups: [
                'autogear-initial',
                'autogear-results',
                'home-welcome',
                'ships-overview',
                'gear-overview',
                'sidebar-import',
            ],
        }
    );
}
