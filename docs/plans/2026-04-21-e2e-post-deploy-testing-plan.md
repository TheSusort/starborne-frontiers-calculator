# E2E Post-Deploy Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright smoke suite that runs against production after every successful Netlify deploy, fails loudly when the anonymous import path, new-account signup + localStorage→Supabase migration, or Google OAuth redirect is broken.

**Architecture:** Separate `e2e/` workspace (own `package.json`, not pulled into the main app bundle) with Playwright chromium-only. Disposable `e2e-<uuid>@<testdomain>` users created via UI, auto-confirmed via Supabase service role, deleted per test + weekly cron sweep for orphans. Triggered by GitHub Actions listening for `deployment_status: success` from Netlify's built-in GitHub integration.

**Tech Stack:** Playwright, `@supabase/supabase-js` (admin API), GitHub Actions, existing Vitest (for helper unit tests).

**Spec reference:** `docs/plans/2026-04-21-e2e-post-deploy-testing-design.md`

---

## Pre-read (codebase touchpoints the implementer needs)

- `src/contexts/AuthProvider.tsx:32-45` — emits `app:migration:start` and `app:migration:end` window events; the signup-migrate test listens for `app:migration:end`. Event fires both on migration success **and** on error — test must check data actually landed, not just that the event fired.
- `src/utils/__tests__/importPlayerData.test.ts:12-101` — factories `makeUnit`, `makeGearItem`, `makeImplantItem`, `makeExportData` used to generate fixture data. These move to a shared module (Task 4).
- `src/components/import/ImportButton.tsx` — the import UI. Needs a `data-testid` added (Task 6).
- `src/components/auth/AuthModal.tsx` — signup form. Needs `data-testid` for email input, password input, submit button, Google OAuth button (Task 6).
- `src/services/auth/supabaseAuth.ts:42` — `signUpWithEmail`. Flagged in spec as adjacent finding; not part of this plan.
- `supabase/migrations/` — existing migration naming convention: `YYYYMMDDNNNNNN_description.sql`. Next sequence: `20260421000001_...`.

---

## Task 1: Audit ON DELETE CASCADE on all user-owned FKs

**Files:**
- Create (if needed): `supabase/migrations/20260421000001_add_missing_user_cascades.sql`

**Why:** Per-test cleanup calls `admin.deleteUser(userId)`. If any user-owned table's FK lacks `ON DELETE CASCADE`, the delete fails (FK violation) or leaves orphan rows (if `SET NULL` / `NO ACTION`). This is a prerequisite for reliable cleanup.

- [ ] **Step 1: Query the live DB for every FK that references `auth.users` or `public.users`**

Run this SQL in the Supabase SQL editor (Dashboard → SQL editor):

```sql
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  rc.delete_rule,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('users')
  AND ccu.table_schema IN ('public', 'auth')
ORDER BY tc.table_name;
```

Expected columns: each FK that points at `users`, with `delete_rule` showing one of `CASCADE`, `SET NULL`, `RESTRICT`, `NO ACTION`.

- [ ] **Step 2: Record the results**

Save the output to the plan execution notes. You are looking for any row where `delete_rule != 'CASCADE'`. Those are the tables the migration must fix.

- [ ] **Step 3: If all rows already say CASCADE — skip to Step 6**

Write a one-line note in the task execution log: "Cascade audit: all user FKs already CASCADE, no migration needed." Then go to Task 2.

- [ ] **Step 4: Write the migration for any non-CASCADE FKs**

Create `supabase/migrations/20260421000001_add_missing_user_cascades.sql`. For each offending `<table>`.`<column>` pair, emit:

```sql
ALTER TABLE public.<table>
  DROP CONSTRAINT <existing_constraint_name>,
  ADD CONSTRAINT <existing_constraint_name>
    FOREIGN KEY (<column>)
    REFERENCES public.users(id)
    ON DELETE CASCADE;
```

Use the `constraint_name` from the Step 1 query output. Wrap the whole migration in `BEGIN;` / `COMMIT;`.

- [ ] **Step 5: Apply the migration via Supabase CLI or dashboard**

If using the CLI:

```bash
npx supabase db push
```

Expected output: migration applied, no errors.

- [ ] **Step 6: Re-run the Step 1 query and confirm every row now shows `CASCADE`**

Paste the result into the task execution log.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260421000001_add_missing_user_cascades.sql
git commit -m "chore(db): add ON DELETE CASCADE on user-owned FKs for E2E cleanup"
```

Skip the commit if no migration was needed.

---

## Task 2: Pick and verify the E2E test email domain

**Files:** None (verification-only task; the domain value lands in Task 15 as a GitHub Secret).

**Why:** The spec tentatively uses `e2e.sbfc.invalid`. RFC-reserved `.invalid` TLDs are sometimes rejected by strict email validators. Supabase Auth uses a conservative validator; we verify before committing the domain.

- [ ] **Step 1: Manually attempt a signup with `e2e-preflight@e2e.sbfc.invalid`**

Open the production site's signup modal and submit with:
- email: `e2e-preflight@e2e.sbfc.invalid`
- password: any 10+ char string

Watch the browser's Network tab for the `/auth/v1/signup` request. Record the response.

- [ ] **Step 2a: If signup returns 200 — the domain works**

Use `admin.deleteUser` (via the Supabase dashboard → Authentication → Users → delete) to remove the preflight user. Record `E2E_TEST_EMAIL_DOMAIN = "e2e.sbfc.invalid"` in the task execution log.

- [ ] **Step 2b: If signup is rejected — fall back to a real-but-unrouted domain**

Use a domain you own with no MX records (or a subdomain like `e2e.<your-domain>.com` with MX records pointed at a black-hole). Re-run Step 1 with the new value. Record the final chosen domain in the execution log.

---

## Task 3: Scaffold the `e2e/` workspace

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/tsconfig.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/.gitignore`
- Modify: `/package.json` (root — add delegating scripts)

- [ ] **Step 1: Create the directory and `package.json`**

```bash
mkdir -p e2e/{fixtures,helpers,scripts,tests}
```

Create `e2e/package.json`:

```json
{
  "name": "starborne-gear-calculator-e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "gen-fixture": "tsx scripts/gen-fixture.ts",
    "cleanup-orphans": "tsx scripts/cleanup-orphans.ts"
  },
  "dependencies": {
    "@playwright/test": "^1.50.0",
    "@supabase/supabase-js": "^2.49.4",
    "dotenv": "^16.0.3",
    "tsx": "^4.19.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `e2e/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "@playwright/test"],
    "allowImportingTsExtensions": false,
    "noEmit": true
  },
  "include": ["**/*.ts", "fixtures/*.json"]
}
```

- [ ] **Step 3: Create `e2e/playwright.config.ts`**

```ts
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
```

- [ ] **Step 4: Create `e2e/.gitignore`**

```
node_modules/
playwright-report/
test-results/
.env
.env.local
```

- [ ] **Step 5: Add root-level delegating scripts**

In `/package.json` (root), add to the `"scripts"` object:

```json
"e2e": "cd e2e && npm test",
"e2e:headed": "cd e2e && npm run test:headed",
"e2e:ui": "cd e2e && npm run test:ui",
"e2e:install": "cd e2e && npm ci && npx playwright install --with-deps chromium"
```

- [ ] **Step 6: Install e2e deps and verify Playwright runs**

```bash
cd e2e && npm install && npx playwright install --with-deps chromium
```

Then run the config smoke:

```bash
cd e2e && E2E_BASE_URL=https://example.com npx playwright test --list
```

Expected output: `Listing tests: Total 0 tests in 0 files.` (no tests yet — but no config errors).

- [ ] **Step 7: Commit**

```bash
git add e2e/ package.json
git commit -m "chore(e2e): scaffold playwright workspace"
```

---

## Task 4: Lift import factories into a shared module

**Files:**
- Create: `src/utils/__tests__/importPlayerData.fixtures.ts`
- Modify: `src/utils/__tests__/importPlayerData.test.ts:12-101`

**Why:** The factories currently live inside the test file. Task 5 needs them to generate the E2E fixture. Moving them into a sibling module lets both the existing Vitest tests and the new fixture generator import from one source of truth.

- [ ] **Step 1: Read the current factory definitions**

Open `src/utils/__tests__/importPlayerData.test.ts` and read lines 1-101. You will move the factory functions (`makeBaseWithLevelAndRank`, `makeUnit`, `makeGearItem`, `makeImplantItem`, `makeExportData`, and any helpers they depend on) into the new file. Leave actual test cases (`describe`/`it` blocks) in place.

- [ ] **Step 2: Create `src/utils/__tests__/importPlayerData.fixtures.ts`**

Copy the factory functions verbatim into the new file. Preserve all type imports. Export each factory.

- [ ] **Step 3: Update `importPlayerData.test.ts` to import from the new module**

Replace the in-file factory definitions with:

```ts
import {
    makeBaseWithLevelAndRank,
    makeUnit,
    makeGearItem,
    makeImplantItem,
    makeExportData,
} from './importPlayerData.fixtures';
```

(Adjust the import list to match what was actually in the original file — read before writing.)

- [ ] **Step 4: Run the existing tests to confirm nothing broke**

```bash
npm test -- importPlayerData
```

Expected: all existing tests pass, same count as before the refactor.

- [ ] **Step 5: Commit**

```bash
git add src/utils/__tests__/importPlayerData.fixtures.ts src/utils/__tests__/importPlayerData.test.ts
git commit -m "refactor(test): extract import fixtures to shared module"
```

---

## Task 5: Generate and commit the E2E fixture JSON

**Files:**
- Create: `e2e/scripts/gen-fixture.ts`
- Create: `e2e/fixtures/gameData.json` (generated, committed)

**Why:** The anon-import test uploads a fixture JSON through the file input. A generated-and-committed JSON is diffable in PRs and avoids cross-project TypeScript imports from `e2e/` into `src/`.

- [ ] **Step 1: Write `e2e/scripts/gen-fixture.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    makeUnit,
    makeGearItem,
    makeImplantItem,
    makeExportData,
} from '../../src/utils/__tests__/importPlayerData.fixtures';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'fixtures', 'gameData.json');

const units = [
    makeUnit({ Id: 'e2e-ship-1', Level: 60 }),
    makeUnit({ Id: 'e2e-ship-2', Level: 45 }),
    makeUnit({ Id: 'e2e-ship-3', Level: 20 }),
    makeUnit({ Id: 'e2e-ship-4', Level: 10 }),
    makeUnit({ Id: 'e2e-ship-5', Level: 1 }),
];

const equipment = [
    makeGearItem({ Id: 'e2e-gear-1' }),
    makeGearItem({ Id: 'e2e-gear-2' }),
    makeGearItem({ Id: 'e2e-gear-3' }),
    makeGearItem({ Id: 'e2e-gear-4' }),
    makeGearItem({ Id: 'e2e-gear-5' }),
    makeGearItem({ Id: 'e2e-gear-6' }),
    makeGearItem({ Id: 'e2e-gear-7' }),
    makeGearItem({ Id: 'e2e-gear-8' }),
    makeGearItem({ Id: 'e2e-gear-9' }),
    makeGearItem({ Id: 'e2e-gear-10' }),
    makeImplantItem({ Id: 'e2e-implant-1' }),
    makeImplantItem({ Id: 'e2e-implant-2' }),
    makeImplantItem({ Id: 'e2e-implant-3' }),
];

const data = makeExportData({ Units: units, Equipment: equipment });

writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`  Units: ${data.Units.length}`);
console.log(`  Equipment: ${data.Equipment.length}`);
```

If the factory signatures differ from what's shown above (verify by reading Task 4's output), adjust the calls to match. The goal is a JSON that:
- Has ≥1 ship at Level 60 (exercises the template-proposal branch)
- Has 3–5 ships of varied levels
- Has ≥2 implants (tests implant import branch)
- Has ≥8 gear pieces across varied slots (tests gear-slot assignment)

- [ ] **Step 2: Run the generator**

```bash
cd e2e && npm run gen-fixture
```

Expected output: path, Units count, Equipment count.

- [ ] **Step 3: Sanity-inspect the JSON**

Open `e2e/fixtures/gameData.json`. Confirm `Units` has 5 entries and `Equipment` has 13 entries. Confirm at least one unit has `Level: 60` in its `Attributes.BaseWithLevelAndRank`.

- [ ] **Step 4: Commit**

```bash
git add e2e/scripts/gen-fixture.ts e2e/fixtures/gameData.json
git commit -m "chore(e2e): add fixture generator and sample game data"
```

---

## Task 6: Add `data-testid` attributes to UI touchpoints

**Files:**
- Modify: `src/components/import/ImportButton.tsx`
- Modify: `src/components/auth/AuthModal.tsx`
- Modify: the ships-count display (locate via grep — likely in a page under `src/pages/`)
- Modify: the gear-count display (same approach)
- Modify: the autogear run entry point (locate via grep)

**Why:** Per spec reviewer recommendation, pinning a `data-testid` selector strategy now prevents brittle text-based matching. Current codebase has only ~19 `data-testid` usages — we're standardising.

- [ ] **Step 1: Identify the exact elements needed**

The tests need selectors for:

| testid | Purpose |
|---|---|
| `import-game-data-input` | The `<input type="file">` that accepts the import JSON |
| `ship-count` | Element whose text content is the number of ships, on `/ships` |
| `gear-count` | Element whose text content is the number of gear pieces, on `/gear` |
| `autogear-start` | The button that starts an autogear run |
| `autogear-suggestions` | The container that renders suggestions after a run completes |
| `open-auth-modal` | The header/sidebar button that opens the auth modal |
| `auth-email-input` | Email input in the auth modal |
| `auth-password-input` | Password input in the auth modal |
| `auth-signup-submit` | The "Sign up" submit button |
| `auth-signin-submit` | The "Sign in" submit button |
| `auth-toggle-mode` | The "Already have an account?" / "Need an account?" toggle in the auth modal |
| `auth-google-button` | The Google OAuth button |

If a count element (`ship-count`, `gear-count`) does not yet exist on `/ships` or `/gear`, this task is authorised to add a minimal element — e.g. `<span data-testid="ship-count">{count}</span>` — alongside the existing UI. Keep it visible (don't hide with CSS) so the test exercises the real render path.

- [ ] **Step 2: For each element, locate the current markup and add the testid**

Use `Grep` to find the relevant files. For the import file input:

```bash
# inside ImportButton.tsx
<input type="file" data-testid="import-game-data-input" ... />
```

For the count displays, search for ships count / gear count rendering. Likely `src/pages/ShipsPage.tsx` and `src/pages/GearPage.tsx`. Add the testid to the element whose **text content** is the number only (so `.textContent` parses cleanly). If the count lives inside a sentence, wrap the number in a `<span data-testid="ship-count">{count}</span>`.

For the auth modal, grep for `AuthModal` or `signInWithGoogle`.

- [ ] **Step 3: Run lint and existing tests**

```bash
npm run lint
npm test
```

Expected: no new errors. `max-warnings: 0` — failures here mean something about the JSX was introduced that ESLint rejects.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "chore(ui): add data-testid attributes for e2e selectors"
```

---

## Task 7: Build the `supabaseAdmin` helper (TDD on the safety regex)

**Files:**
- Create: `e2e/helpers/supabaseAdmin.ts`
- Create: `e2e/helpers/supabaseAdmin.test.ts`

**Why:** This is the only helper that touches the service role key. A bug here could delete real users. The safety regex is unit-testable in isolation and deserves TDD treatment — the rest of the file (HTTP calls) doesn't need unit tests.

- [ ] **Step 1: Write the failing test for the safety regex**

Create `e2e/helpers/supabaseAdmin.test.ts`. Note: this runs under Playwright's test runner (not Vitest) since it lives inside `e2e/` — Playwright supports `test.describe` and `expect` natively.

```ts
import { test, expect } from '@playwright/test';
import { assertIsTestEmail } from './supabaseAdmin';

test.describe('assertIsTestEmail', () => {
    const domain = 'e2e.sbfc.invalid';

    test('accepts a well-formed test email', () => {
        expect(() =>
            assertIsTestEmail('e2e-550e8400-e29b-41d4-a716-446655440000@e2e.sbfc.invalid', domain)
        ).not.toThrow();
    });

    test('rejects a non-prefixed email', () => {
        expect(() => assertIsTestEmail('real-user@e2e.sbfc.invalid', domain)).toThrow(
            /refusing to operate/i
        );
    });

    test('rejects a wrong-domain email', () => {
        expect(() =>
            assertIsTestEmail('e2e-abc@gmail.com', domain)
        ).toThrow(/refusing to operate/i);
    });

    test('rejects a subdomain attempt', () => {
        expect(() =>
            assertIsTestEmail('e2e-abc@attacker.e2e.sbfc.invalid', domain)
        ).toThrow(/refusing to operate/i);
    });

    test('rejects an empty string', () => {
        expect(() => assertIsTestEmail('', domain)).toThrow(/refusing to operate/i);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd e2e && npx playwright test helpers/supabaseAdmin.test.ts
```

Expected: FAIL — "Cannot find module './supabaseAdmin'" or similar.

- [ ] **Step 3: Implement the helper with the safety regex**

Create `e2e/helpers/supabaseAdmin.ts`:

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error('SUPABASE_URL is required');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
    _client = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    return _client;
}

export function assertIsTestEmail(email: string, domain: string): void {
    // Safety rail: this helper must never touch non-test users.
    // Pattern: e2e-<uuid>@<exact test domain>
    const pattern = new RegExp(
        `^e2e-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@${escapeRegex(domain)}$`
    );
    if (!pattern.test(email)) {
        throw new Error(
            `refusing to operate on non-test email: ${email} (expected match for ${pattern})`
        );
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
    const client = getAdminClient();
    // admin.listUsers is paginated; for our scale (one signup per run),
    // the target user is always on page 1 when filtering by recent creation.
    // If auth.users ever exceeds 1000, switch to a direct SQL query via an RPC.
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    return user?.id ?? null;
}

export async function confirmUserEmail(userId: string): Promise<void> {
    const client = getAdminClient();
    const { error } = await client.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw error;
}

export async function deleteTestUser(email: string, domain: string): Promise<void> {
    assertIsTestEmail(email, domain);
    const client = getAdminClient();
    const userId = await findUserIdByEmail(email);
    if (!userId) return; // already gone
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw error;
}

export async function listOrphanTestUsers(
    domain: string,
    olderThan: Date
): Promise<Array<{ id: string; email: string; created_at: string }>> {
    const client = getAdminClient();
    const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users
        .filter((u) => {
            if (!u.email) return false;
            try {
                assertIsTestEmail(u.email, domain);
            } catch {
                return false;
            }
            return new Date(u.created_at) < olderThan;
        })
        .map((u) => ({ id: u.id, email: u.email!, created_at: u.created_at }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd e2e && npx playwright test helpers/supabaseAdmin.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/supabaseAdmin.ts e2e/helpers/supabaseAdmin.test.ts
git commit -m "feat(e2e): supabase admin helper with email safety rail"
```

---

## Task 8: Build the `disposableEmail` helper (TDD)

**Files:**
- Create: `e2e/helpers/disposableEmail.ts`
- Create: `e2e/helpers/disposableEmail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from '@playwright/test';
import { generateTestCredentials } from './disposableEmail';

test.describe('generateTestCredentials', () => {
    const domain = 'e2e.sbfc.invalid';

    test('email starts with e2e- prefix and uses the given domain', () => {
        const { email } = generateTestCredentials(domain);
        expect(email.startsWith('e2e-')).toBe(true);
        expect(email.endsWith(`@${domain}`)).toBe(true);
    });

    test('email body between prefix and @ is a uuid', () => {
        const { email } = generateTestCredentials(domain);
        const body = email.slice('e2e-'.length, email.indexOf('@'));
        expect(body).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    test('two calls return different emails and passwords', () => {
        const a = generateTestCredentials(domain);
        const b = generateTestCredentials(domain);
        expect(a.email).not.toBe(b.email);
        expect(a.password).not.toBe(b.password);
    });

    test('password is at least 16 characters', () => {
        const { password } = generateTestCredentials(domain);
        expect(password.length).toBeGreaterThanOrEqual(16);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd e2e && npx playwright test helpers/disposableEmail.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `e2e/helpers/disposableEmail.ts`:

```ts
import { randomUUID, randomBytes } from 'node:crypto';

export interface TestCredentials {
    email: string;
    password: string;
}

export function generateTestCredentials(domain: string): TestCredentials {
    const email = `e2e-${randomUUID()}@${domain}`;
    const password = randomBytes(16).toString('base64url'); // ~22 chars
    return { email, password };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd e2e && npx playwright test helpers/disposableEmail.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/disposableEmail.ts e2e/helpers/disposableEmail.test.ts
git commit -m "feat(e2e): disposable test credentials helper"
```

---

## Task 9: Build the `wait-for-migration` helper

**Files:**
- Create: `e2e/helpers/wait-for-migration.ts`

**Why:** `src/contexts/AuthProvider.tsx:40-45` dispatches `app:migration:end` on both success and error paths. The helper must be attached *before* sign-in triggers the migration, or the race drops the event.

- [ ] **Step 1: Implement**

Create `e2e/helpers/wait-for-migration.ts`:

```ts
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
```

No unit test — this requires a real browser context; it's validated through the spec that uses it (Task 12).

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/wait-for-migration.ts
git commit -m "feat(e2e): migration-end listener helper"
```

---

## Task 10: Build the `page-actions` helper

**Files:**
- Create: `e2e/helpers/page-actions.ts`

**Why:** The three specs share UI flows — importing game data, opening signup, submitting signup, signing in. Centralising avoids copy-paste drift.

- [ ] **Step 1: Implement**

Create `e2e/helpers/page-actions.ts`:

```ts
import { Page, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..', 'fixtures', 'gameData.json');

export async function importGameData(page: Page): Promise<void> {
    const input = page.getByTestId('import-game-data-input');
    await input.setInputFiles(FIXTURE_PATH);
    // Import is async — wait for the UI to settle. The import button
    // re-enables after completion; if a notification shows up, confirm it.
    await expect(input).toBeEnabled({ timeout: 30_000 });
}

export async function openAuthModal(page: Page): Promise<void> {
    await page.getByTestId('open-auth-modal').click();
    await expect(page.getByTestId('auth-email-input')).toBeVisible();
}

export async function ensureSignupMode(page: Page): Promise<void> {
    // The modal may default to sign-in. If the signup submit isn't already
    // visible, click the mode toggle.
    const signupSubmit = page.getByTestId('auth-signup-submit');
    if (!(await signupSubmit.isVisible().catch(() => false))) {
        await page.getByTestId('auth-toggle-mode').click();
        await expect(signupSubmit).toBeVisible();
    }
}

export async function ensureSigninMode(page: Page): Promise<void> {
    const signinSubmit = page.getByTestId('auth-signin-submit');
    if (!(await signinSubmit.isVisible().catch(() => false))) {
        await page.getByTestId('auth-toggle-mode').click();
        await expect(signinSubmit).toBeVisible();
    }
}

export async function submitSignup(page: Page, email: string, password: string): Promise<void> {
    await ensureSignupMode(page);
    await page.getByTestId('auth-email-input').fill(email);
    await page.getByTestId('auth-password-input').fill(password);
    await page.getByTestId('auth-signup-submit').click();
}

export async function submitSignin(page: Page, email: string, password: string): Promise<void> {
    await ensureSigninMode(page);
    await page.getByTestId('auth-email-input').fill(email);
    await page.getByTestId('auth-password-input').fill(password);
    await page.getByTestId('auth-signin-submit').click();
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/helpers/page-actions.ts
git commit -m "feat(e2e): shared UI actions helper"
```

---

## Task 11: Write the anon-import spec

**Files:**
- Create: `e2e/tests/anon-import.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { importGameData } from '../helpers/page-actions';

test.describe('anonymous user imports game data', () => {
    test('imports, navigates, runs autogear, persists on reload', async ({ page }) => {
        // 1. Fresh context (Playwright gives us one per test by default)
        await page.goto('/');

        // 2. Upload the fixture
        await importGameData(page);

        // 3. Assert ships show up on the ships page
        await page.goto('/ships');
        const shipCount = page.getByTestId('ship-count');
        await expect(shipCount).toHaveText('5', { timeout: 10_000 });

        // 4. Assert gear shows up on the gear page
        await page.goto('/gear');
        const gearCount = page.getByTestId('gear-count');
        await expect(gearCount).toHaveText('10', { timeout: 10_000 });

        // 5. Smoke-test autogear (navigate, pick the first ship, run)
        //    Route and interaction pattern depends on the current autogear UI.
        //    Pin selectors after inspecting the real pages; assert suggestions
        //    render rather than asserting exact content.
        await page.goto('/autogear');
        await page.getByTestId('autogear-start').click();
        await expect(page.getByTestId('autogear-suggestions')).toBeVisible({
            timeout: 30_000,
        });

        // 6. Reload — data must persist via localStorage
        await page.reload();
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5');
    });
});
```

- [ ] **Step 2: Run against production to verify it passes**

```bash
cd e2e && E2E_BASE_URL=https://<your-production-url> npx playwright test tests/anon-import.spec.ts
```

Expected: PASS. If the autogear UI selectors don't resolve, add the missing `data-testid` attributes (extending Task 6) and re-run.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/anon-import.spec.ts
git commit -m "test(e2e): anon user import round-trip"
```

---

## Task 12: Write the new-account signup + migrate spec

**Files:**
- Create: `e2e/tests/new-account-signup-migrate.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { importGameData, openAuthModal, submitSignup, submitSignin } from '../helpers/page-actions';
import { generateTestCredentials } from '../helpers/disposableEmail';
import { armMigrationListener } from '../helpers/wait-for-migration';
import {
    confirmUserEmail,
    deleteTestUser,
    findUserIdByEmail,
} from '../helpers/supabaseAdmin';

const DOMAIN = process.env.E2E_TEST_EMAIL_DOMAIN;
if (!DOMAIN) throw new Error('E2E_TEST_EMAIL_DOMAIN is required');

test.describe('new account: signup → confirm → signin → migrate', () => {
    const created: Array<{ email: string }> = [];

    test.afterEach(async () => {
        for (const { email } of created) {
            try {
                await deleteTestUser(email, DOMAIN!);
            } catch (err) {
                console.warn(`cleanup failed for ${email}:`, err);
            }
        }
        created.length = 0;
    });

    test('anon import, sign up, confirm, sign in, migration fires, data persists', async ({
        page,
    }) => {
        const { email, password } = generateTestCredentials(DOMAIN!);
        created.push({ email });

        // 1. Fresh context
        await page.goto('/');

        // 2. Import as anon (populates localStorage)
        await importGameData(page);
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5');

        // 3. Sign up (opens modal, switches to signup mode if needed, submits)
        await openAuthModal(page);
        await submitSignup(page, email, password);

        // 4. Confirm the email via admin API (no email service involved)
        //    The user row should exist immediately after signUp resolves.
        let userId: string | null = null;
        for (let attempt = 0; attempt < 10 && !userId; attempt++) {
            userId = await findUserIdByEmail(email);
            if (!userId) await page.waitForTimeout(500);
        }
        expect(userId, 'user row should exist in auth.users after signup').not.toBeNull();
        await confirmUserEmail(userId!);

        // 5. Arm the migration listener BEFORE signin
        const awaitMigration = await armMigrationListener(page);

        // 6. Sign in (the app may still show the signup modal; ensure we're
        //    on the sign-in affordance first — adjust selectors as needed)
        await submitSignin(page, email, password);

        // 7. Wait for migration to finish
        await awaitMigration(30_000);

        // 8. Reload — data must persist via Supabase + RLS
        await page.reload();
        await page.goto('/ships');
        await expect(page.getByTestId('ship-count')).toHaveText('5');
    });
});
```

- [ ] **Step 2: Run against production**

```bash
cd e2e && E2E_BASE_URL=https://<url> SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> E2E_TEST_EMAIL_DOMAIN=<domain> npx playwright test tests/new-account-signup-migrate.spec.ts
```

Expected: PASS. Verify in the Supabase dashboard that the test user was created **and deleted** (check `auth.users` — should be empty of `e2e-*` users after the run).

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/new-account-signup-migrate.spec.ts
git commit -m "test(e2e): signup + confirm + signin + migration round-trip"
```

---

## Task 13: Write the OAuth sanity spec

**Files:**
- Create: `e2e/tests/oauth-sanity.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';
import { openAuthModal } from '../helpers/page-actions';

test.describe('google oauth redirect sanity', () => {
    test('clicking google signup redirects to accounts.google.com with a client_id', async ({
        page,
    }) => {
        await page.goto('/');
        await openAuthModal(page);

        // Clicking the Google button triggers a top-level navigation to Google,
        // so we wait for the URL to start with accounts.google.com.
        const navigationPromise = page.waitForURL(/accounts\.google\.com/, { timeout: 15_000 });
        await page.getByTestId('auth-google-button').click();
        await navigationPromise;

        const url = new URL(page.url());
        expect(url.hostname).toBe('accounts.google.com');
        expect(url.searchParams.get('client_id')).toBeTruthy();

        // Do not complete the flow. Test ends here.
    });
});
```

- [ ] **Step 2: Run against production**

```bash
cd e2e && E2E_BASE_URL=https://<url> npx playwright test tests/oauth-sanity.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/oauth-sanity.spec.ts
git commit -m "test(e2e): google oauth redirect sanity"
```

---

## Task 14: Write the orphan-cleanup script

**Files:**
- Create: `e2e/scripts/cleanup-orphans.ts`

- [ ] **Step 1: Implement**

```ts
import 'dotenv/config';
import { listOrphanTestUsers, deleteTestUser } from '../helpers/supabaseAdmin';

async function main() {
    const domain = process.env.E2E_TEST_EMAIL_DOMAIN;
    if (!domain) throw new Error('E2E_TEST_EMAIL_DOMAIN is required');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await listOrphanTestUsers(domain, cutoff);

    console.log(`Found ${orphans.length} orphan test user(s) older than 24h`);
    let deleted = 0;
    for (const { email } of orphans) {
        try {
            await deleteTestUser(email, domain);
            deleted++;
            console.log(`  deleted ${email}`);
        } catch (err) {
            console.error(`  FAILED ${email}:`, err);
        }
    }
    console.log(`Deleted ${deleted}/${orphans.length}`);

    if (deleted < orphans.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
```

- [ ] **Step 2: Manual run to verify (against prod, but dry — no orphans expected yet)**

```bash
cd e2e && SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> E2E_TEST_EMAIL_DOMAIN=<domain> npm run cleanup-orphans
```

Expected output: `Found 0 orphan test user(s) older than 24h` / `Deleted 0/0`. Exit 0.

- [ ] **Step 3: Commit**

```bash
git add e2e/scripts/cleanup-orphans.ts
git commit -m "feat(e2e): orphan user cleanup script"
```

---

## Task 15: GitHub Actions — post-deploy workflow

**Files:**
- Create: `.github/workflows/e2e-post-deploy.yml`

**Prerequisite:** Add the following GitHub Secrets (repo Settings → Secrets and variables → Actions) **before** running the workflow:

- `SUPABASE_URL` — production Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — production service role key
- `E2E_TEST_EMAIL_DOMAIN` — the domain chosen in Task 2

- [ ] **Step 1: Write the workflow**

```yaml
name: E2E — post-deploy smoke

on:
    deployment_status:
    workflow_dispatch:
        inputs:
            base_url:
                description: 'Target URL (defaults to production)'
                required: false

concurrency:
    group: e2e-post-deploy
    cancel-in-progress: false

jobs:
    smoke:
        # For deployment_status: only run on production success events.
        # For workflow_dispatch: always run.
        if: >-
            github.event_name == 'workflow_dispatch' ||
            (github.event.deployment_status.state == 'success' &&
             github.event.deployment.environment == 'production')
        runs-on: ubuntu-latest
        timeout-minutes: 15
        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
                  cache: 'npm'
                  cache-dependency-path: e2e/package-lock.json

            - name: Install e2e deps
              working-directory: e2e
              run: npm ci

            - name: Install playwright browsers
              working-directory: e2e
              run: npx playwright install --with-deps chromium

            - name: Run playwright
              working-directory: e2e
              env:
                  E2E_BASE_URL: ${{ github.event.deployment_status.environment_url || github.event.inputs.base_url || 'https://starborne-frontiers-calculator.netlify.app' }}
                  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
                  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
                  E2E_TEST_EMAIL_DOMAIN: ${{ secrets.E2E_TEST_EMAIL_DOMAIN }}
              run: npm test

            - name: Upload playwright report
              if: failure()
              uses: actions/upload-artifact@v4
              with:
                  name: playwright-report-${{ github.run_id }}
                  path: e2e/playwright-report/
                  retention-days: 14
```

Replace the fallback `https://starborne-frontiers-calculator.netlify.app` with the actual production URL.

- [ ] **Step 2: Generate `e2e/package-lock.json`**

```bash
cd e2e && npm install
git add package-lock.json
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-post-deploy.yml e2e/package-lock.json
git commit -m "ci: post-deploy e2e smoke workflow"
```

- [ ] **Step 4: Trigger the workflow manually to verify it runs**

Push the branch, open the repo's Actions tab, select "E2E — post-deploy smoke" → Run workflow → leave inputs blank → Run.

Expected: all three specs pass. If a spec fails, download the `playwright-report-<run_id>` artifact and inspect the trace.

---

## Task 16: GitHub Actions — weekly orphan cleanup

**Files:**
- Create: `.github/workflows/e2e-cleanup-orphans.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: E2E — weekly orphan cleanup

on:
    schedule:
        - cron: '0 4 * * 0' # Sunday 04:00 UTC
    workflow_dispatch:

jobs:
    cleanup:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        steps:
            - uses: actions/checkout@v4

            - uses: actions/setup-node@v4
              with:
                  node-version: '20'
                  cache: 'npm'
                  cache-dependency-path: e2e/package-lock.json

            - name: Install e2e deps
              working-directory: e2e
              run: npm ci

            - name: Run cleanup
              working-directory: e2e
              env:
                  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
                  SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
                  E2E_TEST_EMAIL_DOMAIN: ${{ secrets.E2E_TEST_EMAIL_DOMAIN }}
              run: npm run cleanup-orphans
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/e2e-cleanup-orphans.yml
git commit -m "ci: weekly e2e orphan user cleanup"
```

- [ ] **Step 3: Trigger the cleanup workflow manually to verify**

Actions tab → "E2E — weekly orphan cleanup" → Run workflow.

Expected: `Found 0 orphan test user(s) older than 24h` and success.

---

## Task 17: Verify Netlify → GitHub deployment events are wired

**Files:** None (configuration verification).

- [ ] **Step 1: Confirm Netlify's GitHub integration is active**

In Netlify: Site settings → Build & deploy → Continuous deployment → Deploy contexts. If the repo is linked via the Netlify GitHub App, `deployment_status` events should already flow to GitHub.

Verify at: GitHub repo → Insights → Network / Settings → Webhooks. Look for Netlify's webhook entry and confirm `deployment` / `deployment_status` events are enabled.

- [ ] **Step 2: If no deployment events exist — add an outgoing webhook fallback**

In Netlify: Site settings → Build & deploy → Deploy notifications → Add notification → Outgoing webhook. Event: "Deploy succeeded". URL: `https://api.github.com/repos/<owner>/<repo>/dispatches`. JSON body:

```json
{ "event_type": "netlify-deploy-succeeded", "client_payload": { "deploy_url": "$DEPLOY_URL", "deploy_id": "$DEPLOY_ID" } }
```

Header `Authorization: Bearer <fine-grained PAT>` with `Contents: read-write` on this repo, no other scopes.

Then update `e2e-post-deploy.yml` to also trigger on `repository_dispatch`:

```yaml
on:
    deployment_status:
    repository_dispatch:
        types: [netlify-deploy-succeeded]
    workflow_dispatch:
        ...
```

And extend the job `if:` expression to include `github.event_name == 'repository_dispatch'`.

- [ ] **Step 3: Deploy a trivial no-op change and observe**

Push a commit that only updates a comment. Wait for Netlify to deploy successfully. Watch the Actions tab: the "E2E — post-deploy smoke" workflow should start within 30 seconds of Netlify reporting "Deploy succeeded".

Expected: workflow runs and all three specs pass.

---

## Task 18: Final end-to-end smoke

- [ ] **Step 1: Confirm all three specs pass in CI on a real deploy**

After Task 17, any merged change to main that causes a deploy should trigger the workflow. Verify by merging this plan's PR and watching Actions.

- [ ] **Step 2: Inject a deliberate regression and confirm CI catches it**

On a throwaway branch, change `src/components/import/ImportButton.tsx` to throw an error immediately inside the import handler. Push to a feature branch, manually run the `e2e-post-deploy` workflow against the deployed preview (override `base_url` input).

Expected: `anon-import.spec.ts` fails; workflow fails; the HTML report artifact contains a readable trace pointing at the import step. Revert the regression.

- [ ] **Step 3: Confirm cleanup is working**

After the signup test has run at least once, query Supabase:

```sql
SELECT email, created_at FROM auth.users WHERE email LIKE 'e2e-%' ORDER BY created_at DESC;
```

Expected: zero rows (the `afterEach` cleanup removed them).

- [ ] **Step 4: Add a runbook header comment to the workflow files**

Per CLAUDE.md ("NEVER create documentation files unless explicitly requested"), do not create a new `.md`. Instead, add a comment block at the top of `.github/workflows/e2e-post-deploy.yml` covering:

- What the E2E suite tests and doesn't test
- Local run: `npm run e2e:install`, then `E2E_BASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... E2E_TEST_EMAIL_DOMAIN=... npm run e2e`
- The three required GitHub Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL_DOMAIN`
- Where the weekly cleanup cron lives: `.github/workflows/e2e-cleanup-orphans.yml`
- Link to the spec: `docs/plans/2026-04-21-e2e-post-deploy-testing-design.md`
- Note: the post-signup confirmation UI gap is a separate issue, not handled here

Also add `CLAUDE.md` an entry under a "Testing" section — if none exists, ask before creating it — pointing future Claude sessions at the `e2e/` workspace and the two workflows.

- [ ] **Step 5: Commit the runbook comment**

```bash
git add .github/workflows/e2e-post-deploy.yml
git commit -m "docs(ci): runbook comment for e2e workflow"
```

---

## Done when

- [ ] All 18 tasks marked complete
- [ ] A production deploy has triggered the workflow and all three specs passed
- [ ] The deliberate-regression smoke (Task 18 Step 2) confirmed failures are caught
- [ ] Supabase `auth.users` has no `e2e-*` rows after a full test run
- [ ] Adjacent finding (post-signup confirmation UI) is filed as a separate issue
