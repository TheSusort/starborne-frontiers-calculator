# OAuth Read-Only Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every token Supabase issues to an OAuth client (JWT carries `client_id`) can read but not write over the Data API, enforced by one PostgREST pre-request hook.

**Architecture:** A migration defines `public.check_request()` and registers it as `pgrst.db_pre_request` on the `authenticator` role. The function raises SQLSTATE `PT403` when the JWT claims contain the key `client_id` and the request method is not `GET`/`HEAD`. A vitest tripwire reads the migrations directory and pins the contract so a later migration cannot silently weaken it.

**Tech Stack:** Postgres / PostgREST (Supabase), vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md`

## Global Constraints

- **Never run the Supabase CLI** in any form (`supabase`, `npx supabase`, package scripts, `--help`). The user applies the migration.
- Migration file name: `supabase/migrations/20260925000001_oauth_clients_read_only.sql`.
- No changelog entry, no `DocumentationPage.tsx` edit (no user-visible change).
- Comments follow CLAUDE.md "Code Comments": present-tense contracts only; no task numbers, no change history.
- Fresh worktree setup before running the suite: `.env`, `docs/*.json`, `docs/*.csv`, `.husky/_/husky.sh` copied from the main checkout (already done in `.claude/worktrees/mcp-oauth-readonly`).

---

### Task 1: Pre-request hook migration + tripwire test

**Files:**
- Create: `supabase/migrations/20260925000001_oauth_clients_read_only.sql`
- Create: `src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts`

**Interfaces:**
- Produces: SQL function `public.check_request() RETURNS void`, registered as `pgrst.db_pre_request`. Spec 2 extends this function (one allowlisted RPC) in a NEW migration; the test below reads the latest definition across all migrations, so it keeps guarding after that.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for the Data API rule "a token issued to an OAuth client is read-only"
 * (#562). The rule lives in `public.check_request()`, PostgREST's pre-request hook.
 * No local database exists, so this pins the SQL text of the LATEST migration that
 * defines or registers the hook; prod behaviour is checked by the verification
 * snippet in docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const DEFINES_HOOK = /create\s+or\s+replace\s+function\s+public\.check_request\s*\(/i;
const REGISTERS_HOOK = /pgrst\.db_pre_request/i;

const latest = (re: RegExp) => [...migrations].reverse().find((m) => re.test(code(m.sql)));

describe('OAuth client tokens are read-only (pre-request hook)', () => {
    it('some migration defines public.check_request()', () => {
        expect(latest(DEFINES_HOOK)).toBeDefined();
    });

    it('the latest definition rejects non-GET/HEAD requests from tokens carrying client_id', () => {
        const body = code(latest(DEFINES_HOOK)!.sql);
        expect(body).toMatch(/request\.jwt\.claims/);
        expect(body).toMatch(/request\.method/);
        expect(body).toMatch(/\?\s*'client_id'/);
        expect(body).toMatch(/not\s+in\s*\(\s*'GET'\s*,\s*'HEAD'\s*\)/i);
        expect(body).toMatch(/raise\s+sqlstate\s+'PT403'/i);
    });

    it('the latest registration points the hook at public.check_request and reloads config', () => {
        const reg = latest(REGISTERS_HOOK);
        expect(reg).toBeDefined();
        const sql = code(reg!.sql);
        expect(sql).toMatch(
            /alter\s+role\s+authenticator\s+set\s+pgrst\.db_pre_request\s*=\s*'public\.check_request'/i
        );
        expect(sql).toMatch(/notify\s+pgrst\s*,\s*'reload config'/i);
    });

    it('no migration resets or repoints the hook', () => {
        for (const m of migrations) {
            const sql = code(m.sql);
            expect(sql, m.file).not.toMatch(/reset\s+pgrst\.db_pre_request/i);
            const targets = [...sql.matchAll(/pgrst\.db_pre_request\s*=\s*'([^']+)'/gi)].map((x) => x[1]);
            for (const t of targets) expect(t, m.file).toBe('public.check_request');
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts`
Expected: FAIL — "some migration defines public.check_request()" (expected undefined to be defined), and the two dependent tests fail with a TypeError on `!.sql`. "no migration resets or repoints the hook" passes vacuously.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000001_oauth_clients_read_only.sql`:

```sql
-- A token Supabase Auth issues to an OAuth client (#562: MCP clients) carries a `client_id`
-- claim; a website session does not. This PostgREST pre-request hook makes such a token
-- read-only on the Data API: any request other than GET/HEAD is rejected with HTTP 403.
--
-- GET/HEAD are sufficient to allow because PostgREST runs them in a read-only transaction,
-- so a GET can neither write a table nor run a volatile function. That covers RLS-bypassing
-- SECURITY DEFINER RPCs too, which is why the rule lives here and not in table policies.
--
-- Scope: the Data API only. Auth, Storage and Realtime do not run this hook.
--
-- Registering replaces any existing pgrst.db_pre_request; check
--   select rolconfig from pg_roles where rolname = 'authenticator';
-- before applying. Verification snippet and rollback: the spec,
-- docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md.
-- Tripwire: src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts.

CREATE OR REPLACE FUNCTION public.check_request()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  method text := current_setting('request.method', true);
BEGIN
  -- Key presence, not value: a null or empty client_id is still an OAuth token.
  IF claims ? 'client_id' AND method NOT IN ('GET', 'HEAD') THEN
    RAISE SQLSTATE 'PT403'
      USING MESSAGE = 'OAuth client tokens are read-only',
            HINT = 'Sign in to the website to make changes.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_request() TO anon, authenticated;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_request';
NOTIFY pgrst, 'reload config';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Mutation check (prove the tripwire can fail)**

Temporarily edit the migration's `NOT IN ('GET', 'HEAD')` to `NOT IN ('GET', 'HEAD', 'POST')`, run the test, confirm the second test FAILS, then revert. Repeat with `? 'client_id'` commented out (prefix the IF line with `--` and add `IF false THEN` below it) and confirm it fails. Revert and re-run: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260925000001_oauth_clients_read_only.sql src/__tests__/supabase/oauthReadOnlyPreRequest.test.ts
git commit -m "feat(security): OAuth client tokens are read-only on the Data API (#562)

A PostgREST pre-request hook rejects non-GET/HEAD requests whose JWT carries
client_id, so an MCP client approved over Supabase OAuth can read the user's
data but cannot write tables or call writing/admin RPCs.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

The pre-commit hook runs the full suite; expect all green.

---

## After merge (the user)

1. Run `select rolconfig from pg_roles where rolname = 'authenticator';` — stop if a `pgrst.db_pre_request` is already set.
2. Apply the migration.
3. Run the four-case verification snippet from the spec.
4. Smoke-test the live site: sign in, save a loadout, import data.
