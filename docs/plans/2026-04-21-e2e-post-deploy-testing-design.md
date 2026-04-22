# E2E Post-Deploy Testing — Design

**Date:** 2026-04-21
**Status:** Design approved, pending implementation plan

## Problem

The app supports two "first-time visitor" journeys that the owner rarely touches on their daily account: (1) pure anonymous use with localStorage, and (2) new email/password signup with the subsequent localStorage→Supabase migration. Regressions in these paths are invisible to the owner and can silently persist for weeks. Recent examples (CSP fix `6d43818`, signout-wipe fix `d5dd936`) illustrate the shape of the bugs: prod-configuration drift or code paths only the unauthenticated / brand-new user exercises.

## Goal

A small, reliable end-to-end smoke suite that runs after every successful production deploy and fails loudly within ~5 minutes when the first-time-visitor flows break.

Explicit non-goals: CI-on-every-PR gating, multi-browser coverage, full Google OAuth automation, preview-deploy coverage.

## Solution summary

A new `e2e/` directory with a Playwright suite executing three specs against the production URL after each Netlify production deploy. Triggered by a GitHub Actions workflow listening for `deployment_status: success` from Netlify's built-in GitHub integration. Tests hit the real production Supabase; disposable `e2e-<uuid>@<testdomain>` users are auto-confirmed via the service role key and deleted after each test. A weekly cron cleans up any orphans.

## Architecture

```
Netlify prod deploy succeeds
   → Netlify GitHub integration posts deployment_status: success
   → GHA workflow e2e-post-deploy.yml triggers
   → Playwright (chromium) hits the deployed URL
   → Test helpers use SUPABASE_SERVICE_ROLE_KEY for email-confirm + cleanup
   → On failure: workflow fails → GitHub emails the owner
   → Playwright HTML report + traces uploaded as workflow artifact
```

**Isolation:** Tests run against production Supabase. Test users are identified by an `e2e-<uuid>@<testdomain>` email prefix and removed after each test. A weekly scheduled workflow deletes any `e2e-*@<testdomain>` users older than 24h as a belt-and-braces safeguard.

**Project layout:**

```
e2e/
  package.json              # separate from root; not installed in Netlify builds
  tsconfig.json
  playwright.config.ts
  fixtures/
    gameData.json           # small sample, generated from existing factories
  helpers/
    supabaseAdmin.ts        # admin client, confirmUser, deleteUser, email safety regex
    disposableEmail.ts      # crypto.randomUUID-based generator
    page-actions.ts         # shared UI flows: importGameData, signUp, signIn
    wait-for-migration.ts   # attaches window listener for 'app:migration:end'
  tests/
    anon-import.spec.ts
    new-account-signup-migrate.spec.ts
    oauth-sanity.spec.ts
  scripts/
    gen-fixture.ts          # regenerates fixtures/gameData.json from factories
    cleanup-orphans.ts      # used by the weekly cleanup workflow
```

The root `package.json` gains an `e2e` script that delegates into `e2e/`. Playwright and its chromium binary stay out of the main app's `node_modules`, keeping Netlify builds unchanged.

## Test scenarios

### anon-import.spec.ts — the pure unauth path

1. Fresh browser context (no storage), navigate to `E2E_BASE_URL`
2. Upload `fixtures/gameData.json` via the import button
3. Assert expected ship count on the ships page
4. Assert expected gear count on the gear page
5. Navigate to autogear, pick a ship, start a run, assert suggestions appear
6. Reload page, assert data still present (localStorage persistence sanity)

Catches: bundle-deploy breakage, CSP regressions affecting import, import pipeline errors, routing breakage.

### new-account-signup-migrate.spec.ts — the money path

1. Fresh context, navigate to `E2E_BASE_URL`
2. Upload fixture as anon (populates localStorage)
3. Attach `window.addEventListener('app:migration:end', ...)` listener via `page.evaluate` before signing up, resolved to a Playwright-awaitable promise
4. Open signup modal, sign up with `e2e-${crypto.randomUUID()}@${E2E_TEST_EMAIL_DOMAIN}` + random 24-char password
5. Test helper locates the user via `admin.listUsers` filtered by email, calls `admin.updateUserById(userId, { email_confirm: true })`
6. Sign in through the UI with the same credentials
7. Await migration-complete promise (30s timeout, fails test if not received)
8. Reload → assert ships still present (exercises Supabase read path through RLS)
9. `afterEach`: safety-checked `admin.deleteUser(userId)`

Catches: signup flow, email-confirm-then-sign-in, the localStorage→Supabase migration, RLS misconfiguration, the `users` insert trigger, auth-state propagation.

### oauth-sanity.spec.ts — cheap OAuth check

1. Navigate to `E2E_BASE_URL`
2. Click the Google signup button
3. Assert navigation to `accounts.google.com/...` with the expected `client_id` query param
4. Do not complete the OAuth flow

Catches: rotated/missing OAuth client config, broken redirect URL, button wiring regressions.

## Fixtures

Existing factories in `src/utils/__tests__/importPlayerData.test.ts:12-101` (`makeUnit`, `makeGearItem`, `makeImplantItem`, `makeExportData`) are lifted into a shared helper module and used by `e2e/scripts/gen-fixture.ts` to produce a static `e2e/fixtures/gameData.json`. The script is idempotent and run manually when the shape changes.

**Contents:** ~5 ships (varied rarities, one level 60 to exercise the template-proposal code path), ~10 gear pieces (varied slots and sets), ~3 implants, ~2 engineering stat entries. Small enough to keep assertions simple, large enough to exercise every import branch.

Checked-in JSON is preferred over runtime generation to keep the E2E tsconfig simple (no cross-project imports from `src/`) and to make the fixture diff-inspectable in PRs.

## User lifecycle

**Test user shape:**

- Email: `e2e-${crypto.randomUUID()}@${E2E_TEST_EMAIL_DOMAIN}` — the domain is an invalid domain we own conceptually (e.g. `e2e.sbfc.invalid`); no mail is ever sent because we auto-confirm via admin API
- Password: random 24-char string, discarded after the test

**Email confirmation bypass:**

After the UI signup completes, the test calls `supabase.auth.admin.listUsers()` (filtering client-side by email — acceptable at this scale) to obtain the `userId`, then calls `supabase.auth.admin.updateUserById(userId, { email_confirm: true })`. The service role key is injected via env only in the GHA workflow; it never touches page code or checked-in files.

**Cleanup tiers:**

1. **Per-test `afterEach`:** `admin.deleteUser(userId)`. Relies on `ON DELETE CASCADE` on user-owned tables (`ships`, `inventory`, `engineering_stats`, `autogear_configs`, loadouts, etc.) to remove child rows.
2. **`afterAll` fallback:** scan `admin.listUsers` for `e2e-*@${E2E_TEST_EMAIL_DOMAIN}` created within the current run's timestamp window; delete any survivors.
3. **Weekly scheduled workflow** (`.github/workflows/e2e-cleanup-orphans.yml`, `cron: '0 4 * * 0'`): runs `e2e/scripts/cleanup-orphans.ts`, which deletes any `e2e-*@${E2E_TEST_EMAIL_DOMAIN}` users older than 24h.

**Cascade audit:** as part of implementation, verify every table with a user FK has `ON DELETE CASCADE`. If any do not, add a migration before shipping the test suite. This is a prerequisite — without it, per-test cleanup will leave orphan rows and break referential hygiene.

**Safety rail:** the `deleteUser` helper in `e2e/helpers/supabaseAdmin.ts` refuses to act on any email that does not match the regex `/^e2e-[0-9a-f-]+@<exact-test-domain>$/`. A bug in a test cannot nuke a real user.

## CI wiring

**Netlify side** (one-time manual setup, recorded in the implementation plan): use Netlify's built-in GitHub integration so successful production deploys post a `deployment_status: success` event to the repo. No outgoing-webhook or PAT management needed.

**Workflow** `.github/workflows/e2e-post-deploy.yml`:

- Triggers: `deployment_status` (filtered to `state == 'success'` and `environment == 'production'`), plus `workflow_dispatch` for manual reruns
- Job: `ubuntu-latest`, Node version matching root `package.json`'s engines
- Steps:
  1. Checkout (shallow)
  2. `cd e2e && npm ci`
  3. `npx playwright install --with-deps chromium`
  4. `npx playwright test` with env: `E2E_BASE_URL` (from the `deployment.environment_url` payload), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL_DOMAIN`
  5. On failure: upload `playwright-report/` as a workflow artifact
- Concurrency: grouped by workflow, `cancel-in-progress: false` — do not cancel an in-flight run when another deploy lands; both should run so we don't mask a regression
- Retries: Playwright `retries: 1`; a double failure is a real signal

**Scheduled cleanup** `.github/workflows/e2e-cleanup-orphans.yml`:

- `cron: '0 4 * * 0'` (Sunday 04:00 UTC)
- Runs `e2e/scripts/cleanup-orphans.ts` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `E2E_TEST_EMAIL_DOMAIN`

**Secrets** (GitHub repo settings → Secrets and variables → Actions):

- `SUPABASE_URL` (non-sensitive but kept with the pair)
- `SUPABASE_SERVICE_ROLE_KEY`
- `E2E_TEST_EMAIL_DOMAIN`

**Failure signal:** GitHub's default workflow-failed email. Slack/Discord alerting explicitly deferred.

## Error handling & flakiness

**Budget:** suite must hold <2% flake rate. Above that, it becomes noise and loses the trust that makes it useful.

**Practices:**

- Use Playwright locator auto-waiting exclusively; never `waitForTimeout`
- Assert on *state* (localStorage entries, Supabase rows via service role) over *UI timing* where both are equivalent
- The migration wait uses an explicit `app:migration:end` event listener attached before sign-in — fails loudly with a 30s timeout rather than silently passing
- `retries: 1` — double failure is a real signal, not flake
- Upload HTML reports + traces on failure so post-mortems don't require local repro

**Known risks accepted:**

- Google's `accounts.google.com` URL shape may shift — assertion is on hostname + `client_id` only, update-once if it breaks
- Production auth has per-IP rate limits — irrelevant at one signup per deploy; revisit only if we parallelize
- A crashed or timed-out run may leak an `e2e-*` user — weekly cron bounds leakage at <7 orphans

## Out of scope

- Google OAuth flow completion (would require real Google account + bot-detection workarounds)
- Preview / branch-deploy testing (only production deploys trigger)
- Firefox / WebKit coverage
- Parallel test execution
- Slack / Discord alerting
- CI-on-every-PR gating
- **Fixing the missing post-signup confirmation UI** — see adjacent findings

## Adjacent findings (not part of this work)

During brainstorming we noticed `SupabaseAuthService.signUpWithEmail` at `src/services/auth/supabaseAuth.ts:42` does not handle the email-confirmation response state, and there is no "check your email" UI after signup. Because Supabase email confirmation is on, a real new user submits the form and receives no feedback that they must click a link before they can sign in. This is a user-facing bug independent of the E2E work; the test suite bypasses it via the admin API and therefore does not block this design.

Recommended follow-up (separate ticket): after successful `signUp`, either redirect to a "Confirm your email" screen or render an inline confirmation-pending state. Covered by its own design; not blocking this spec.

## Success criteria

1. A prod deploy that breaks the anonymous import path fails the workflow within ~5 minutes of deploy completion.
2. A prod deploy that breaks signup or the localStorage→Supabase migration fails the workflow.
3. A prod deploy that breaks the Google OAuth redirect (config / client ID drift) fails the workflow.
4. False-positive rate over the first two weeks is <1 failed run per 20 deploys.
5. No orphan `e2e-*` users persist in `auth.users` for more than a week.

## Prerequisites

1. Audit all user-owned tables for `ON DELETE CASCADE` on the user FK; add migration(s) if any are missing.
2. Provision GitHub Actions secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL_DOMAIN`.
3. Confirm Netlify's GitHub integration is enabled and posting `deployment_status` events (or fall back to an outgoing webhook → `repository_dispatch`).
