# Alt Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one logged-in human own a Main profile plus up to 5 Alt profiles (separate game-account data containers under the same auth identity), with a sidebar switcher and per-profile data isolation.

**Architecture:** Add `owner_auth_user_id` column to `public.users` (NULL = main, set = alt). Drop FK from `public.users.id → auth.users(id)` and replace its cascade behavior with a DELETE trigger on `auth.users`. Rewrite all user-owned RLS policies to call a new `has_profile_access(target_user_id)` helper. Client-side, introduce `ActiveProfileProvider` exposing `activeProfileId`; data contexts and game-data services switch from `useAuth().user.id` to `useActiveProfile().activeProfileId`. Auth-identity callers (heartbeat, admin, votes) keep using `user.id`.

**Tech Stack:** Supabase (PostgreSQL + RLS), React 18, TypeScript, Vite, TailwindCSS, Vitest.

**Spec:** `docs/plans/2026-04-24-alt-accounts-design.md` — read this first.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260424000001_alt_accounts_users_schema.sql` | Schema changes on `public.users` |
| `supabase/migrations/20260424000002_alt_accounts_triggers.sql` | DELETE-on-auth trigger + soft-cap trigger |
| `supabase/migrations/20260424000003_alt_accounts_rls.sql` | `has_profile_access()` + every RLS policy rewrite |
| `src/services/altAccountService.ts` | Supabase CRUD for alts (create/list/rename/togglePublic/delete) |
| `src/contexts/ActiveProfileProvider.tsx` | Provider exposing `activeProfileId`, `profiles`, switcher, alt CRUD |
| `src/components/ui/icons/AltAccountIcon.tsx` | Small icon used in switcher and badges |
| `src/components/profile/AltAccountsSection.tsx` | Card on profile page listing alts + soft-cap counter |
| `src/components/profile/CreateAltModal.tsx` | Modal for creating an alt |
| `src/components/profile/RenameAltModal.tsx` | Modal for renaming an alt |
| `src/components/ui/layout/ProfileSwitcher.tsx` | Sidebar badge + dropdown |
| `src/__tests__/services/altAccountService.test.ts` | Unit tests for the service |
| `src/__tests__/contexts/activeProfile.test.ts` | Unit tests for pure helpers extracted from the provider |

### Modified files

| Path | Change |
|---|---|
| `src/App.tsx` | Wrap data context tree with `ActiveProfileProvider` between `AuthProvider` and the rest |
| `src/contexts/ShipsContext.tsx` | Swap `user.id` → `activeProfileId`, listen for `app:profile:switch` |
| `src/contexts/InventoryProvider.tsx` | Same + IndexedDB cache key includes profile id |
| `src/contexts/EngineeringStatsProvider.tsx` | Same |
| `src/contexts/AutogearConfigContext.tsx` | Same |
| `src/contexts/TutorialContext.tsx` | Same (resets on switch) |
| `src/utils/migratePlayerData.ts` | Already takes `userId` — confirm callers pass `activeProfileId` |
| `src/services/usageTracking.ts` | Record events against active profile |
| `src/services/statisticsSnapshotService.ts` | Snapshots scoped to active profile |
| `src/services/shipTemplateProposalService.ts` | `submitted_by_user_id` is active profile |
| `src/services/communityRecommendations.ts` | `created_by` is active profile; votes still pass auth user id |
| `src/services/userProfileService.ts` | New helpers for alt-profile shape (extends existing `UserProfile` with `owner_auth_user_id`) |
| `src/hooks/useLoadouts.ts` | Use `activeProfileId` |
| `src/hooks/useEncounterNotes.ts` | Use `activeProfileId` (notes are per-profile per spec) |
| `src/hooks/useStatisticsSnapshot.ts` | Use `activeProfileId` |
| `src/hooks/useSharedEncounters.ts` | Audit — keep on auth user if it represents identity-level activity, otherwise switch |
| `src/hooks/useStorage.ts` | IndexedDB key includes profile id; one-time wipe of legacy unkeyed entries |
| `src/components/import/ImportButton.tsx` | Pass `activeProfileId` into import pipeline |
| `src/components/import/BackupRestoreData.tsx` | Same |
| `src/components/encounters/EncounterList.tsx` | Audit — vote casting uses `user.id`, note authoring uses `activeProfileId` |
| `src/components/autogear/CommunityActions.tsx` | `created_by` = active profile; votes = auth user |
| `src/components/admin/AllUsersTable.tsx` | No change required (admin-scoped via SECURITY DEFINER RPC) — verify |
| `src/components/ui/layout/Sidebar.tsx` | Mount `ProfileSwitcher` near user/auth section |
| `src/pages/ProfilePage.tsx` | Render `AltAccountsSection` |

### Files explicitly **not** changing

| Path | Reason |
|---|---|
| `src/contexts/AuthProvider.tsx` (auth-identity surface only) | Auth identity stays on auth.user; provider mounts above the new ActiveProfileProvider |
| `src/services/heartbeatService.ts` | One human = one session |
| `src/services/adminService.ts` | Admin RPCs run as SECURITY DEFINER and read `auth.uid()` directly |
| `src/services/auth/supabaseAuth.ts` | Auth flow unchanged |

---

## Implementation Order

The order is chosen so each phase leaves the app in a working state:

1. **DB migrations** — backwards-compatible; nothing in the app uses the new column yet.
2. **Provider + service layer** — provider mounted but defaulting to main; no user-visible change.
3. **Data context migration** — contexts read `activeProfileId` (= `auth.uid()` while no alts exist).
4. **Service & import pipeline** — non-data-context callers swapped.
5. **Hooks + audit** — catch-all sweep.
6. **UI: sidebar switcher** — feature becomes visible (but with only Main, dropdown is just one item).
7. **UI: profile page alt management** — users can create/rename/delete alts.
8. **QA + ship** — manual verification per spec, single commit/PR for the whole feature.

---

## Phase 1 — Database Migrations

### Task 1: Schema migration on `public.users`

**Files:**
- Create: `supabase/migrations/20260424000001_alt_accounts_users_schema.sql`

**Reference:** `supabase/migrations/20260221000002_rls_user_owned_tables.sql` (existing user-table policies — for context only).

- [ ] **Step 1: Write the migration**

```sql
-- Alt accounts: schema changes to public.users.
-- Adds owner_auth_user_id (NULL = main, set = alt owned by that auth user).
-- Drops the FK to auth.users so alts can exist without an auth row.
-- Sets a uuid default on id so alt INSERTs can omit it.
-- Relaxes email to nullable + partial unique.

-- 1. Drop the FK from public.users.id -> auth.users.id.
--    The constraint name varies by environment; discover it dynamically.
DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'f'
      AND con.confrelid = 'auth.users'::regclass
      AND (SELECT array_agg(attname) FROM pg_attribute
           WHERE attrelid = con.conrelid
             AND attnum = ANY(con.conkey)) = ARRAY['id'::name];

    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

-- 2. Default uuid generation for alt INSERTs that omit `id`.
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3. Make email nullable.
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- 4. Replace the email unique constraint with a partial unique index
--    that ignores NULLs. Discover the existing constraint name dynamically.
DO $$
DECLARE
    uq_name text;
BEGIN
    SELECT con.conname INTO uq_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'users'
      AND con.contype = 'u'
      AND (SELECT array_agg(attname) FROM pg_attribute
           WHERE attrelid = con.conrelid
             AND attnum = ANY(con.conkey)) = ARRAY['email'::name];

    IF uq_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', uq_name);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_when_present
    ON public.users(email)
    WHERE email IS NOT NULL;

-- 5. Add owner_auth_user_id column (NULL for main accounts).
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS owner_auth_user_id uuid NULL
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- 6. Partial index for the alt lookup pattern.
CREATE INDEX IF NOT EXISTS users_owner_auth_user_id_idx
    ON public.users(owner_auth_user_id)
    WHERE owner_auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.users.owner_auth_user_id IS
    'NULL = main account (id matches auth.users.id). Non-NULL = alt account owned by that auth user.';
```

- [ ] **Step 2: Apply locally and verify**

Run via Supabase CLI (or paste into the Supabase SQL editor for the local/dev project):

```bash
supabase db push
```

Expected: migration applies clean, no errors.

Verify:

```sql
-- Should show owner_auth_user_id column with default NULL.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
ORDER BY ordinal_position;

-- Should show NO FK from public.users.id -> auth.users.
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.users'::regclass AND contype = 'f';

-- Should show one partial unique index for email.
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'users';
```

Expected: column present, FK absent, partial unique index present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000001_alt_accounts_users_schema.sql
git commit -m "feat(db): alt accounts schema — owner_auth_user_id column, drop auth FK"
```

---

### Task 2: Triggers — auth-delete cascade + soft cap

**Files:**
- Create: `supabase/migrations/20260424000002_alt_accounts_triggers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Alt accounts: triggers for cascade-on-auth-delete and soft cap of 5 alts.

-- Replaces the cascade behavior previously provided by the FK
-- public.users.id -> auth.users(id), AND extends it to clean up alts.
CREATE OR REPLACE FUNCTION public.handle_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Delete the user's main profile (cascades through ships/inventory/etc).
    DELETE FROM public.users WHERE id = OLD.id;
    -- Delete all alts owned by this auth user.
    DELETE FROM public.users WHERE owner_auth_user_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
    AFTER DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_delete();

-- Soft cap: max 5 alts per owner. Enforced at the DB so nothing can bypass.
CREATE OR REPLACE FUNCTION public.enforce_alt_account_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    existing_alts integer;
BEGIN
    IF NEW.owner_auth_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO existing_alts
    FROM public.users
    WHERE owner_auth_user_id = NEW.owner_auth_user_id;

    IF existing_alts >= 5 THEN
        RAISE EXCEPTION 'Alt account limit reached (max 5 per owner)'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_alt_account_cap_trigger ON public.users;
CREATE TRIGGER enforce_alt_account_cap_trigger
    BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.enforce_alt_account_cap();
```

- [ ] **Step 2: Apply and smoke test**

```bash
supabase db push
```

Verify with this smoke test in the SQL editor (use a real auth user id from your local DB):

```sql
-- Replace <auth-uid> with an actual auth user id in your local dev DB.
DO $$
DECLARE
    test_owner uuid := '<auth-uid>';
    i integer;
BEGIN
    -- Should succeed 5 times.
    FOR i IN 1..5 LOOP
        INSERT INTO public.users (owner_auth_user_id, username, is_public)
        VALUES (test_owner, 'cap-test-' || i, false);
    END LOOP;

    -- The 6th should raise.
    BEGIN
        INSERT INTO public.users (owner_auth_user_id, username, is_public)
        VALUES (test_owner, 'cap-test-6', false);
        RAISE EXCEPTION 'soft cap was not enforced!';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'soft cap correctly blocked 6th alt';
    END;

    -- Cleanup.
    DELETE FROM public.users WHERE owner_auth_user_id = test_owner AND username LIKE 'cap-test-%';
END $$;
```

Expected: notice "soft cap correctly blocked 6th alt".

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424000002_alt_accounts_triggers.sql
git commit -m "feat(db): alt accounts — auth delete cascade and soft cap triggers"
```

---

### Task 3: RLS policies — `has_profile_access()` + full rewrite

**Files:**
- Create: `supabase/migrations/20260424000003_alt_accounts_rls.sql`

**Reference (read first):**
- `supabase/migrations/20260221000002_rls_user_owned_tables.sql` (direct `auth.uid() = user_id` policies)
- `supabase/migrations/20260221000003_rls_child_tables.sql` (subquery patterns: `parent.user_id = auth.uid()`)
- `supabase/migrations/20260221000004_rls_public_reference_tables.sql` (community tables using `created_by`)

- [ ] **Step 1: Audit grep — confirm the table list before writing the migration**

Run all of these and list the full set of policies that match. The migration must address every one.

```bash
# Direct user_id policies
grep -rn "auth.uid() = user_id\|user_id = auth.uid()" supabase/migrations/

# Direct created_by policies
grep -rn "auth.uid() = created_by\|created_by = auth.uid()" supabase/migrations/

# Subquery patterns in child tables (the full file is the source of truth)
grep -rn "user_id = auth.uid()" supabase/migrations/20260221000003_rls_child_tables.sql

# Catchall for any policy referencing auth.uid() against a user-owned column
grep -rn "auth.uid()" supabase/migrations/
```

Build a checklist (table name + policy name) of every policy that needs swapping before writing the migration. Anything in `is_public = true` branches, `is_admin()` branches, or referencing `auth.uid()` for the row's identity (e.g., `auth.uid() = id` on `users`) does NOT need swapping unless explicitly called out in the spec.

- [ ] **Step 2: Write the migration**

```sql
-- Alt accounts: RLS rewrite.
-- Replace `auth.uid() = user_id` (and `created_by` variants, including subqueries)
-- with has_profile_access() so owners can access alt-owned rows transparently.

-- 1. Helper: returns true if the current auth user owns or is the target user_id.
CREATE OR REPLACE FUNCTION public.has_profile_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = target_user_id
          AND (id = auth.uid() OR owner_auth_user_id = auth.uid())
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_profile_access(uuid) TO authenticated;

-- 2. public.users SELECT — extended to include owned alts.
DROP POLICY IF EXISTS "Users can view own or public profiles" ON public.users;
DROP POLICY IF EXISTS "Users can view own, owned alts, or public profiles" ON public.users;
CREATE POLICY "Users can view own, owned alts, or public profiles" ON public.users
    FOR SELECT TO authenticated
    USING (
        auth.uid() = id
        OR owner_auth_user_id = auth.uid()
        OR is_public = true
    );

-- 3. public.users UPDATE — owner can update own row and owned alts.
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile or owned alts" ON public.users;
CREATE POLICY "Users can update own profile or owned alts" ON public.users
    FOR UPDATE TO authenticated
    USING (auth.uid() = id OR owner_auth_user_id = auth.uid())
    WITH CHECK (auth.uid() = id OR owner_auth_user_id = auth.uid());

-- 4. public.users INSERT — alts only (owner inserting an alt for themselves).
DROP POLICY IF EXISTS "Users can insert alt profiles they own" ON public.users;
CREATE POLICY "Users can insert alt profiles they own" ON public.users
    FOR INSERT TO authenticated
    WITH CHECK (
        owner_auth_user_id = auth.uid()
        AND id != auth.uid()
        AND is_admin = false
    );

-- 5. public.users DELETE — owner can delete owned alts.
--    Main-account deletion still goes through the existing delete_user() flow.
DROP POLICY IF EXISTS "Users can delete owned alts" ON public.users;
CREATE POLICY "Users can delete owned alts" ON public.users
    FOR DELETE TO authenticated
    USING (owner_auth_user_id = auth.uid());

-- 6. Per-table swaps. Pattern (repeat for every user-owned table):
--    DROP POLICY ... CREATE POLICY ... USING (has_profile_access(user_id))
--                                       WITH CHECK (has_profile_access(user_id));
--
--    AT MINIMUM these tables (verify against the audit grep in Step 1):
--      - ships
--      - inventory_items
--      - engineering_stats
--      - autogear_configs
--      - loadouts
--      - team_loadouts
--      - statistics_snapshots
--      - user_activity_log
--      - encounter_notes  (keep its is_public branch on SELECT)
--      - community_recommendations  (uses created_by, not user_id)
--
--    PLUS every child-table policy in 20260221000003_rls_child_tables.sql
--    (ship_base_stats, ship_equipment, ship_implants, ship_implant_stats,
--     ship_refits, ship_refit_stats, loadout_equipment, team_loadout_ships,
--     team_loadout_equipment, encounter_formations, etc.) — these use the
--     subquery form and must become:
--       WHERE EXISTS (SELECT 1 FROM parent WHERE parent.id = child.parent_id
--                     AND public.has_profile_access(parent.user_id))
--
--    INTENTIONALLY EXCLUDED (one-vote-per-human):
--      - encounter_votes  (keep auth.uid() = user_id)
--      - community_recommendation_votes  (keep auth.uid() = user_id)

-- ===== Direct user_id tables =====
-- ships
DROP POLICY IF EXISTS "Users can view own ships" ON public.ships;
CREATE POLICY "Users can view own ships" ON public.ships
    FOR SELECT TO authenticated USING (public.has_profile_access(user_id));
DROP POLICY IF EXISTS "Users can insert own ships" ON public.ships;
CREATE POLICY "Users can insert own ships" ON public.ships
    FOR INSERT TO authenticated WITH CHECK (public.has_profile_access(user_id));
DROP POLICY IF EXISTS "Users can update own ships" ON public.ships;
CREATE POLICY "Users can update own ships" ON public.ships
    FOR UPDATE TO authenticated
    USING (public.has_profile_access(user_id))
    WITH CHECK (public.has_profile_access(user_id));
DROP POLICY IF EXISTS "Users can delete own ships" ON public.ships;
CREATE POLICY "Users can delete own ships" ON public.ships
    FOR DELETE TO authenticated USING (public.has_profile_access(user_id));

-- TODO: repeat the four-policy swap (SELECT/INSERT/UPDATE/DELETE) for each of:
--   inventory_items, engineering_stats, autogear_configs, loadouts,
--   team_loadouts, statistics_snapshots, user_activity_log
-- The names match the existing policies in 20260221000002.

-- encounter_notes — also has an is_public branch on SELECT; preserve it.
DROP POLICY IF EXISTS "Users can view own or public encounter notes" ON public.encounter_notes;
CREATE POLICY "Users can view own or public encounter notes" ON public.encounter_notes
    FOR SELECT TO authenticated
    USING (public.has_profile_access(user_id) OR is_public = true);
-- ... and INSERT/UPDATE/DELETE on encounter_notes use has_profile_access(user_id).

-- community_recommendations — created_by, not user_id.
DROP POLICY IF EXISTS "Authenticated users can create community recommendations" ON public.community_recommendations;
CREATE POLICY "Authenticated users can create community recommendations" ON public.community_recommendations
    FOR INSERT TO authenticated WITH CHECK (public.has_profile_access(created_by));
DROP POLICY IF EXISTS "Users can update own community recommendations" ON public.community_recommendations;
CREATE POLICY "Users can update own community recommendations" ON public.community_recommendations
    FOR UPDATE TO authenticated
    USING (public.has_profile_access(created_by))
    WITH CHECK (public.has_profile_access(created_by));
DROP POLICY IF EXISTS "Users can delete own community recommendations" ON public.community_recommendations;
CREATE POLICY "Users can delete own community recommendations" ON public.community_recommendations
    FOR DELETE TO authenticated USING (public.has_profile_access(created_by));
-- "Anyone can view" SELECT policy unchanged.

-- ===== Child-table subquery swaps =====
-- For every policy in 20260221000003_rls_child_tables.sql that does
--   EXISTS (SELECT 1 FROM parent WHERE parent.id = child.parent_id AND parent.user_id = auth.uid())
-- swap to
--   EXISTS (SELECT 1 FROM parent WHERE parent.id = child.parent_id AND public.has_profile_access(parent.user_id))
--
-- Each child table needs the full SELECT/INSERT/UPDATE/DELETE swap. Walk the
-- file end-to-end; do not rely on grep alone (some policies span lines).
```

> **Note for the implementer:** the migration above is a template + checklist. Expand the `-- TODO` and `-- ... and ...` sections into full DDL by mirroring the patterns in the existing migrations. Do NOT skip any table on the audit checklist.

- [ ] **Step 3: Apply and smoke-test as a real user**

```bash
supabase db push
```

Smoke test (run as an authenticated session, e.g., from the app or an authed SQL session):

```sql
-- As yourself, you should see your ships.
SELECT count(*) FROM public.ships;
-- Expected: > 0 (assuming you have ships).

-- The has_profile_access helper should return true for your own id.
SELECT public.has_profile_access(auth.uid());
-- Expected: true.

-- And false for a random uuid.
SELECT public.has_profile_access(gen_random_uuid());
-- Expected: false.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424000003_alt_accounts_rls.sql
git commit -m "feat(db): alt accounts — has_profile_access helper and RLS rewrite"
```

---

## Phase 2 — Provider + Service Layer

### Task 4: `altAccountService.ts` (with TDD)

**Files:**
- Create: `src/services/altAccountService.ts`
- Create: `src/__tests__/services/altAccountService.test.ts`

**Reference:** `src/services/userProfileService.ts` for the existing `UserProfile` shape and Supabase usage patterns.

- [ ] **Step 1: Write failing tests for the service shape**

```ts
// src/__tests__/services/altAccountService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    listProfiles,
    createAlt,
    renameAlt,
    setAltPublic,
    deleteAlt,
} from '../../services/altAccountService';
import { supabase } from '../../config/supabase';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

describe('altAccountService', () => {
    beforeEach(() => vi.clearAllMocks());

    it('listProfiles fetches main + owned alts for an auth user', async () => {
        const rows = [
            { id: 'auth-id', username: 'main', owner_auth_user_id: null, is_public: true },
            { id: 'alt-1', username: 'alt-one', owner_auth_user_id: 'auth-id', is_public: false },
        ];
        const orFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const select = vi.fn().mockReturnValue({ or: orFn });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ select });

        const profiles = await listProfiles('auth-id');

        expect(supabase.from).toHaveBeenCalledWith('users');
        expect(select).toHaveBeenCalled();
        expect(orFn).toHaveBeenCalledWith('id.eq.auth-id,owner_auth_user_id.eq.auth-id');
        expect(profiles).toEqual(rows);
    });

    it('createAlt inserts a row with owner_auth_user_id and omits id', async () => {
        const inserted = { id: 'new-uuid', username: 'newalt', owner_auth_user_id: 'auth-id', is_public: false };
        const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
        const select = vi.fn().mockReturnValue({ single });
        const insert = vi.fn().mockReturnValue({ select });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

        const profile = await createAlt('auth-id', 'newalt');

        expect(insert).toHaveBeenCalledWith({
            owner_auth_user_id: 'auth-id',
            username: 'newalt',
            is_public: false,
        });
        expect(profile).toEqual(inserted);
    });

    it('renameAlt updates username only on the alt row', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const update = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update });

        await renameAlt('alt-1', 'auth-id', 'newname');

        expect(update).toHaveBeenCalledWith({ username: 'newname' });
        expect(eq1).toHaveBeenCalledWith('id', 'alt-1');
        expect(eq2).toHaveBeenCalledWith('owner_auth_user_id', 'auth-id');
    });

    it('setAltPublic flips is_public on an alt the user owns', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const update = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update });

        await setAltPublic('alt-1', 'auth-id', true);

        expect(update).toHaveBeenCalledWith({ is_public: true });
    });

    it('deleteAlt removes only an owned alt row', async () => {
        const eq2 = vi.fn().mockResolvedValue({ error: null });
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
        const del = vi.fn().mockReturnValue({ eq: eq1 });
        (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ delete: del });

        await deleteAlt('alt-1', 'auth-id');

        expect(del).toHaveBeenCalled();
        expect(eq1).toHaveBeenCalledWith('id', 'alt-1');
        expect(eq2).toHaveBeenCalledWith('owner_auth_user_id', 'auth-id');
    });
});
```

- [ ] **Step 2: Run tests, expect failure**

```bash
npx vitest --run src/__tests__/services/altAccountService.test.ts
```

Expected: all 5 tests fail with module-not-found.

- [ ] **Step 3: Implement the service**

```ts
// src/services/altAccountService.ts
import { supabase } from '../config/supabase';

export interface ProfileRow {
    id: string;
    username: string | null;
    is_public: boolean;
    owner_auth_user_id: string | null;
    in_game_id: string | null;
    email: string | null;
    is_admin: boolean;
    created_at: string;
    updated_at: string;
}

export const listProfiles = async (authUserId: string): Promise<ProfileRow[]> => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .or(`id.eq.${authUserId},owner_auth_user_id.eq.${authUserId}`);
    if (error) throw error;
    return (data ?? []) as ProfileRow[];
};

export const createAlt = async (
    authUserId: string,
    username: string,
): Promise<ProfileRow> => {
    const { data, error } = await supabase
        .from('users')
        .insert({
            owner_auth_user_id: authUserId,
            username,
            is_public: false,
        })
        .select()
        .single();
    if (error) throw error;
    return data as ProfileRow;
};

export const renameAlt = async (
    altId: string,
    authUserId: string,
    username: string,
): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .update({ username })
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};

export const setAltPublic = async (
    altId: string,
    authUserId: string,
    isPublic: boolean,
): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .update({ is_public: isPublic })
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};

export const deleteAlt = async (altId: string, authUserId: string): Promise<void> => {
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', altId)
        .eq('owner_auth_user_id', authUserId);
    if (error) throw error;
};
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest --run src/__tests__/services/altAccountService.test.ts
```

Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/altAccountService.ts src/__tests__/services/altAccountService.test.ts
git commit -m "feat(profile): altAccountService for CRUD on alt accounts"
```

---

### Task 5: `ActiveProfileProvider` with extracted pure helper

**Files:**
- Create: `src/contexts/ActiveProfileProvider.tsx`
- Create: `src/__tests__/contexts/activeProfile.test.ts` — pure-helper tests

**Storage key:** add `ACTIVE_PROFILE_ID = 'active_profile_id'` to `src/constants/storage.ts`.

- [ ] **Step 1: Add the storage key constant**

Edit `src/constants/storage.ts`:

```ts
// inside the StorageKey enum/object
ACTIVE_PROFILE_ID = 'active_profile_id',
```

- [ ] **Step 2: Write failing tests for the pure helper**

```ts
// src/__tests__/contexts/activeProfile.test.ts
import { describe, it, expect } from 'vitest';
import { resolveActiveProfileId } from '../../contexts/ActiveProfileProvider';
import type { ProfileRow } from '../../services/altAccountService';

const main: ProfileRow = {
    id: 'auth-id', username: 'me', is_public: true,
    owner_auth_user_id: null, in_game_id: null, email: 'x@y',
    is_admin: false, created_at: '', updated_at: '',
};
const alt: ProfileRow = {
    id: 'alt-1', username: 'alt', is_public: false,
    owner_auth_user_id: 'auth-id', in_game_id: null, email: null,
    is_admin: false, created_at: '', updated_at: '',
};

describe('resolveActiveProfileId', () => {
    it('returns auth.uid() when no stored id', () => {
        expect(resolveActiveProfileId('auth-id', null, [main])).toBe('auth-id');
    });

    it('returns the stored id when it appears in the list', () => {
        expect(resolveActiveProfileId('auth-id', 'alt-1', [main, alt])).toBe('alt-1');
    });

    it('falls back to auth.uid() when stored id is missing from the list', () => {
        expect(resolveActiveProfileId('auth-id', 'alt-deleted', [main])).toBe('auth-id');
    });

    it('falls back to auth.uid() when stored id equals auth.uid()', () => {
        expect(resolveActiveProfileId('auth-id', 'auth-id', [main])).toBe('auth-id');
    });

    it('returns null when no auth user', () => {
        expect(resolveActiveProfileId(null, 'whatever', [])).toBeNull();
    });
});
```

- [ ] **Step 3: Run tests, expect failure**

```bash
npx vitest --run src/__tests__/contexts/activeProfile.test.ts
```

Expected: tests fail with module-not-found.

- [ ] **Step 4: Implement the provider**

```tsx
// src/contexts/ActiveProfileProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { useNotification } from '../hooks/useNotification';
import { StorageKey } from '../constants/storage';
import {
    listProfiles,
    createAlt as createAltApi,
    renameAlt as renameAltApi,
    setAltPublic as setAltPublicApi,
    deleteAlt as deleteAltApi,
    type ProfileRow,
} from '../services/altAccountService';

export const PROFILE_SWITCH_EVENT = 'app:profile:switch';

export const resolveActiveProfileId = (
    authUserId: string | null,
    storedId: string | null,
    profiles: ProfileRow[],
): string | null => {
    if (!authUserId) return null;
    if (storedId && profiles.some((p) => p.id === storedId)) return storedId;
    return authUserId;
};

interface ActiveProfileContextType {
    activeProfileId: string | null;
    activeProfile: ProfileRow | null;
    profiles: ProfileRow[];
    isOnAlt: boolean;
    profilesLoading: boolean;
    switchProfile: (id: string) => void;
    createAlt: (username: string) => Promise<ProfileRow>;
    renameAlt: (id: string, username: string) => Promise<void>;
    togglePublicAlt: (id: string, isPublic: boolean) => Promise<void>;
    deleteAlt: (id: string) => Promise<void>;
    refreshProfiles: () => Promise<void>;
}

const ActiveProfileContext = createContext<ActiveProfileContextType | undefined>(undefined);

export const ActiveProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const { addNotification } = useNotification();
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [profilesLoading, setProfilesLoading] = useState(true);
    const [storedId, setStoredId] = useState<string | null>(
        () => localStorage.getItem(StorageKey.ACTIVE_PROFILE_ID),
    );
    const lastNotifiedStaleRef = useRef<string | null>(null);

    const activeProfileId = useMemo(
        () => resolveActiveProfileId(user?.id ?? null, storedId, profiles),
        [user?.id, storedId, profiles],
    );

    // Notify when a stored alt id is no longer accessible (deleted elsewhere).
    useEffect(() => {
        if (!user?.id || profilesLoading) return;
        if (storedId && !profiles.some((p) => p.id === storedId) && lastNotifiedStaleRef.current !== storedId) {
            lastNotifiedStaleRef.current = storedId;
            localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
            setStoredId(null);
            addNotification('info', 'Alt no longer exists — switched to main.');
        }
    }, [user?.id, storedId, profiles, profilesLoading, addNotification]);

    const activeProfile = useMemo(
        () => profiles.find((p) => p.id === activeProfileId) ?? null,
        [profiles, activeProfileId],
    );

    const refreshProfiles = useCallback(async () => {
        if (!user?.id) {
            setProfiles([]);
            setProfilesLoading(false);
            return;
        }
        setProfilesLoading(true);
        try {
            const rows = await listProfiles(user.id);
            setProfiles(rows);
        } catch (err) {
            console.error('Failed to load profiles', err);
            addNotification('error', 'Failed to load profiles');
        } finally {
            setProfilesLoading(false);
        }
    }, [user?.id, addNotification]);

    useEffect(() => { void refreshProfiles(); }, [refreshProfiles]);

    // Sign-out: clear the stored profile id so a different account on the same device starts fresh.
    useEffect(() => {
        const onSignout = () => {
            localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
            setStoredId(null);
            setProfiles([]);
        };
        window.addEventListener('app:signout', onSignout);
        return () => window.removeEventListener('app:signout', onSignout);
    }, []);

    const switchProfile = useCallback((id: string) => {
        if (id === activeProfileId) return;
        const isMain = id === user?.id;
        if (isMain) {
            localStorage.removeItem(StorageKey.ACTIVE_PROFILE_ID);
            setStoredId(null);
        } else {
            localStorage.setItem(StorageKey.ACTIVE_PROFILE_ID, id);
            setStoredId(id);
        }
        window.dispatchEvent(new CustomEvent(PROFILE_SWITCH_EVENT, { detail: { profileId: id } }));
    }, [activeProfileId, user?.id]);

    const createAlt = useCallback(async (username: string): Promise<ProfileRow> => {
        if (!user?.id) throw new Error('Not authenticated');
        const row = await createAltApi(user.id, username);
        await refreshProfiles();
        return row;
    }, [user?.id, refreshProfiles]);

    const renameAlt = useCallback(async (id: string, username: string) => {
        if (!user?.id) throw new Error('Not authenticated');
        await renameAltApi(id, user.id, username);
        await refreshProfiles();
    }, [user?.id, refreshProfiles]);

    const togglePublicAlt = useCallback(async (id: string, isPublic: boolean) => {
        if (!user?.id) throw new Error('Not authenticated');
        await setAltPublicApi(id, user.id, isPublic);
        await refreshProfiles();
    }, [user?.id, refreshProfiles]);

    const deleteAlt = useCallback(async (id: string) => {
        if (!user?.id) throw new Error('Not authenticated');
        // Switch off the alt before deleting to avoid an "active profile vanished" race.
        if (activeProfileId === id) {
            switchProfile(user.id);
        }
        await deleteAltApi(id, user.id);
        await refreshProfiles();
    }, [user?.id, activeProfileId, switchProfile, refreshProfiles]);

    const value: ActiveProfileContextType = {
        activeProfileId,
        activeProfile,
        profiles,
        isOnAlt: activeProfileId !== null && activeProfileId !== user?.id,
        profilesLoading,
        switchProfile,
        createAlt,
        renameAlt,
        togglePublicAlt,
        deleteAlt,
        refreshProfiles,
    };

    return (
        <ActiveProfileContext.Provider value={value}>
            {children}
        </ActiveProfileContext.Provider>
    );
};

export const useActiveProfile = () => {
    const ctx = useContext(ActiveProfileContext);
    if (!ctx) throw new Error('useActiveProfile must be used within ActiveProfileProvider');
    return ctx;
};
```

- [ ] **Step 5: Run tests, expect pass**

```bash
npx vitest --run src/__tests__/contexts/activeProfile.test.ts
```

Expected: all 5 helper tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/contexts/ActiveProfileProvider.tsx src/__tests__/contexts/activeProfile.test.ts src/constants/storage.ts
git commit -m "feat(profile): ActiveProfileProvider with switch and CRUD wiring"
```

---

### Task 6: Wire `ActiveProfileProvider` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Inspect current provider order**

```bash
grep -n "Provider" src/App.tsx
```

Identify where `AuthProvider` mounts and where data contexts mount.

- [ ] **Step 2: Add `ActiveProfileProvider` between `AuthProvider` and the data contexts**

Wrap the data-context tree (`ShipsContext`, `InventoryProvider`, `EngineeringStatsProvider`, `AutogearConfigContext`, `TutorialContext`) with `ActiveProfileProvider`. Order matters: `AuthProvider` → `NotificationProvider` (already present) → `ActiveProfileProvider` → data contexts.

```tsx
<AuthProvider>
    <NotificationProvider>
        <ActiveProfileProvider>
            <ShipsProvider>
                <InventoryProvider>
                    {/* ... rest of tree */}
                </InventoryProvider>
            </ShipsProvider>
        </ActiveProfileProvider>
    </NotificationProvider>
</AuthProvider>
```

(Adjust to the actual provider stack — this is the structural intent, not literal code.)

- [ ] **Step 3: Verify the app still loads**

```bash
npm start
```

Open the app. You should see no visual change. Check the browser console for errors. Verify a logged-in user can still see their ships.

- [ ] **Step 4: Verify type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(profile): mount ActiveProfileProvider in app tree"
```

---

## Phase 3 — Data Context Migration

Each context follows the same recipe: import `useActiveProfile`, replace `useAuth().user.id` with `activeProfileId`, listen for `app:profile:switch` to reset local state, gate initial fetch on `activeProfileId !== null && !profilesLoading` to avoid the refresh-on-alt race.

### Task 7: `ShipsContext`

**Files:**
- Modify: `src/contexts/ShipsContext.tsx`

- [ ] **Step 1: Read the file and locate every `user.id` reference**

```bash
grep -n "user.id\|user?\.id\|useAuth" src/contexts/ShipsContext.tsx
```

The audit grep at the start of the project showed lines: 13, 258, 312, 417, 535, 656, 947, 1058. Verify against current state.

- [ ] **Step 2: Refactor to use `activeProfileId`**

Add the import and hook usage:

```tsx
import { useActiveProfile, PROFILE_SWITCH_EVENT } from './ActiveProfileProvider';

// inside the provider component:
const { activeProfileId, profilesLoading } = useActiveProfile();
```

Replace every `user.id` (and `user?.id`) in Supabase queries with `activeProfileId`. The `useAuth()` import should be removed if `user` is no longer referenced for any other reason.

Gate the initial-load `useEffect` on `activeProfileId && !profilesLoading`.

Add a profile-switch listener that wipes local ship state and triggers a refetch:

```tsx
useEffect(() => {
    const onSwitch = () => {
        setShips([]); // reset to whatever the empty state is
        // The activeProfileId-keyed effect will refetch automatically.
    };
    window.addEventListener(PROFILE_SWITCH_EVENT, onSwitch);
    return () => window.removeEventListener(PROFILE_SWITCH_EVENT, onSwitch);
}, []);
```

Make sure the load `useEffect` depends on `activeProfileId` so a switch triggers reload.

- [ ] **Step 3: Verify in the browser**

```bash
npm start
```

- Sign in. Confirm ships still appear.
- Open dev console; no errors related to undefined ids or RLS denials.

- [ ] **Step 4: Type-check + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ShipsContext.tsx
git commit -m "feat(profile): scope ShipsContext to activeProfileId"
```

---

### Task 8: `InventoryProvider` (+ IndexedDB cache key)

**Files:**
- Modify: `src/contexts/InventoryProvider.tsx`
- Modify: `src/hooks/useStorage.ts` (or wherever the IndexedDB cache key is derived for inventory)

- [ ] **Step 1: Locate the cache key**

```bash
grep -n "INVENTORY\|inventory_items\|getFromIndexedDB\|saveToIndexedDB" src/hooks/useStorage.ts src/contexts/InventoryProvider.tsx
```

Identify how the IndexedDB key string is built today.

- [ ] **Step 2: Make the cache key include profile id**

The key should become `inventory_items:<profileId>`. Two options:
- (a) The cache helper takes the key string verbatim — pass `\`inventory_items:${activeProfileId}\`` from the provider.
- (b) The cache helper derives the key from a constant — extend the helper to accept a suffix.

Prefer (a) (less coupling). On the read/write paths, prepend the active profile id.

Add a one-time wipe of legacy unkeyed entries on first load post-deploy:

```ts
// In an init block reachable on first mount of InventoryProvider:
if (!localStorage.getItem('inventory_cache_v2_migrated')) {
    await removeFromIndexedDB(StorageKey.INVENTORY); // wipe legacy unkeyed entry
    localStorage.setItem('inventory_cache_v2_migrated', 'true');
}
```

- [ ] **Step 3: Refactor InventoryProvider to use `activeProfileId`**

Same pattern as Task 7: import `useActiveProfile`, swap `user.id` → `activeProfileId`, add profile-switch listener, gate initial fetch.

On profile switch, also clear the in-memory inventory state AND the IndexedDB cache for the previous profile if you keep per-profile caches (or just clear local state and let the next read repopulate from Supabase).

- [ ] **Step 4: Verify**

```bash
npm start
```

Sign in, browse inventory. Confirm gear list appears. Open dev tools → Application → IndexedDB and verify the key now includes the profile id.

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/contexts/InventoryProvider.tsx src/hooks/useStorage.ts
git commit -m "feat(profile): scope InventoryProvider to activeProfileId; key cache by profile"
```

---

### Task 9: `EngineeringStatsProvider`

**Files:**
- Modify: `src/contexts/EngineeringStatsProvider.tsx`

- [ ] **Step 1: Audit references**

```bash
grep -n "user.id\|user?\.id\|useAuth" src/contexts/EngineeringStatsProvider.tsx
```

- [ ] **Step 2: Apply the standard recipe** (import `useActiveProfile`, swap, listen for switch, gate initial fetch).

- [ ] **Step 3: Verify in browser** — engineering page still loads stats.

- [ ] **Step 4: Type-check + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/contexts/EngineeringStatsProvider.tsx
git commit -m "feat(profile): scope EngineeringStatsProvider to activeProfileId"
```

---

### Task 10: `AutogearConfigContext`

**Files:**
- Modify: `src/contexts/AutogearConfigContext.tsx`

- [ ] **Step 1: Audit references**

```bash
grep -n "user.id\|user?\.id\|useAuth" src/contexts/AutogearConfigContext.tsx
```

- [ ] **Step 2: Apply the standard recipe.**

- [ ] **Step 3: Verify** — saved autogear configs still appear; creating a new config saves under active profile.

- [ ] **Step 4: Type-check + lint + commit**

```bash
git add src/contexts/AutogearConfigContext.tsx
git commit -m "feat(profile): scope AutogearConfigContext to activeProfileId"
```

---

### Task 11: `TutorialContext`

**Files:**
- Modify: `src/contexts/TutorialContext.tsx`

- [ ] **Step 1: Audit references**

```bash
grep -n "user.id\|user?\.id\|useAuth\|tutorial_completed_groups" src/contexts/TutorialContext.tsx
```

- [ ] **Step 2: Apply the standard recipe.** On profile switch, additionally cancel any in-progress tutorial overlay (call `cancelTutorial()` or equivalent existing reset method, then refetch completed groups for the new profile).

- [ ] **Step 3: Verify** — tutorial completion state per profile works (completing a group on main does not mark it complete on a freshly-created alt).

- [ ] **Step 4: Type-check + lint + commit**

```bash
git add src/contexts/TutorialContext.tsx
git commit -m "feat(profile): scope TutorialContext to activeProfileId; reset on switch"
```

---

## Phase 4 — Service Layer & Import Pipeline

### Task 12: `migratePlayerData` and `syncMigratedDataToSupabase` audit

**Files:**
- Modify: `src/utils/migratePlayerData.ts` (audit only — already takes `userId`)
- Modify: callers — verify they pass `activeProfileId`

- [ ] **Step 1: Confirm function signatures**

```bash
grep -n "syncMigratedDataToSupabase\|migratePlayerData\|importPlayerData" src/utils/migratePlayerData.ts
```

These functions should already accept a `userId: string` parameter. If any internal helper reads from `useAuth()` or globals, refactor to accept the parameter explicitly.

- [ ] **Step 2: Confirm callers pass active profile**

```bash
grep -rn "syncMigratedDataToSupabase\|migratePlayerData\|importPlayerData" src/
```

For each caller:
- If it's the auth-time migration (in `AuthProvider.tsx`), pass `user.id` (alts can't exist before first sign-in, so main is correct).
- If it's a user-triggered import (`ImportButton`, `BackupRestoreData`), pass `useActiveProfile().activeProfileId`.

- [ ] **Step 3: Verify**

Run a manual import while signed in. Confirm imported data appears under the active profile.

- [ ] **Step 4: Type-check + lint + commit**

```bash
git add src/utils/migratePlayerData.ts src/contexts/AuthProvider.tsx
git commit -m "feat(profile): import pipeline takes targetProfileId explicitly"
```

---

### Task 13: `usageTracking.ts` and `statisticsSnapshotService.ts`

**Files:**
- Modify: `src/services/usageTracking.ts`
- Modify: `src/services/statisticsSnapshotService.ts`
- Modify: callers (autogear page, import flow, snapshot trigger)

- [ ] **Step 1: Audit each service**

```bash
grep -n "user.id\|user?\.id\|user_id" src/services/usageTracking.ts src/services/statisticsSnapshotService.ts
```

- [ ] **Step 2: Refactor each function to accept `userId` as a parameter**

If a function currently reads from `useAuth()` (impossible — services don't use hooks), it likely already accepts `userId`. If it reads a global, refactor to accept the parameter.

- [ ] **Step 3: Update callers to pass `activeProfileId`**

```bash
grep -rn "recordAutogearRun\|recordDataImport\|saveStatisticsSnapshot" src/
```

In each component caller, add `useActiveProfile()` and pass `activeProfileId` instead of `user.id`.

- [ ] **Step 4: Update tests if any**

```bash
ls src/__tests__/services/
```

If `statisticsSnapshotService.test.ts` exists (it does), confirm it still passes with the new signature.

- [ ] **Step 5: Verify**

Run an autogear from the UI, verify a row gets logged in `daily_usage_stats` (or wherever) with the active profile id.

- [ ] **Step 6: Type-check + lint + commit**

```bash
npx vitest --run src/__tests__/services/
npx tsc --noEmit && npm run lint
git add src/services/usageTracking.ts src/services/statisticsSnapshotService.ts
# also: any caller files that changed
git commit -m "feat(profile): scope usage tracking and snapshots to active profile"
```

---

### Task 14: `shipTemplateProposalService.ts`

**Files:**
- Modify: `src/services/shipTemplateProposalService.ts`
- Modify: caller (likely the import pipeline)

- [ ] **Step 1: Audit**

```bash
grep -n "user.id\|user?\.id\|submitted_by\|user_id" src/services/shipTemplateProposalService.ts
```

- [ ] **Step 2: Ensure `submitted_by_user_id` is the active profile id**

If the service takes a `userId` parameter, confirm callers pass `activeProfileId`. Otherwise refactor to accept it.

- [ ] **Step 3: Verify**

After an import, check the `ship_template_proposals` table — `submitted_by_user_id` should match the active profile id, not necessarily the auth user id.

- [ ] **Step 4: Commit**

```bash
git add src/services/shipTemplateProposalService.ts
# + caller(s) modified
git commit -m "feat(profile): ship template proposals attributed to active profile"
```

---

### Task 15: `ImportButton` and `BackupRestoreData`

**Files:**
- Modify: `src/components/import/ImportButton.tsx`
- Modify: `src/components/import/BackupRestoreData.tsx`

- [ ] **Step 1: Audit**

```bash
grep -n "user.id\|user?\.id\|useAuth" src/components/import/ImportButton.tsx src/components/import/BackupRestoreData.tsx
```

- [ ] **Step 2: Add `useActiveProfile()` and pass `activeProfileId` everywhere import calls happen**

Anywhere `user.id` is passed to import or sync helpers, swap to `activeProfileId`. Auth-identity reads (e.g., gating UI on whether the user is signed in) keep using `user`.

- [ ] **Step 3: Verify**

- Switch to an alt (manually for now via DB INSERT — UI doesn't exist yet), import a JSON, confirm ships appear under the alt.
- Switch to main, import a different JSON, confirm main's data is independent.

- [ ] **Step 4: Type-check + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/import/ImportButton.tsx src/components/import/BackupRestoreData.tsx
git commit -m "feat(profile): import flows target the active profile"
```

---

## Phase 5 — Hooks Layer + Catch-All Audit

### Task 16: `useLoadouts`, `useStatisticsSnapshot`, `useEncounterNotes`, `useSharedEncounters`

**Files:**
- Modify: `src/hooks/useLoadouts.ts`
- Modify: `src/hooks/useStatisticsSnapshot.ts`
- Modify: `src/hooks/useEncounterNotes.ts`
- Modify: `src/hooks/useSharedEncounters.ts`

- [ ] **Step 1: Audit each hook**

```bash
grep -n "user.id\|user?\.id\|useAuth" src/hooks/useLoadouts.ts src/hooks/useStatisticsSnapshot.ts src/hooks/useEncounterNotes.ts src/hooks/useSharedEncounters.ts
```

- [ ] **Step 2: Apply the rule to each**

| Hook | Scoping |
|---|---|
| `useLoadouts` | activeProfileId (loadouts are game data) |
| `useStatisticsSnapshot` | activeProfileId (per spec) |
| `useEncounterNotes` | activeProfileId (per spec — notes are per-profile) |
| `useSharedEncounters` | If it represents a "what encounters has the player joined/shared" view tied to game data → activeProfileId. If it represents identity-level shared content → user.id. Read the file to decide. |

For each chosen-as-activeProfileId hook, also subscribe to `app:profile:switch` to refetch.

- [ ] **Step 3: Verify**

Smoke each affected page in the app — loadouts page, statistics page, encounters page. Confirm data still loads.

- [ ] **Step 4: Type-check + lint + commit**

```bash
git add src/hooks/useLoadouts.ts src/hooks/useStatisticsSnapshot.ts src/hooks/useEncounterNotes.ts src/hooks/useSharedEncounters.ts
git commit -m "feat(profile): scope game-data hooks to active profile"
```

---

### Task 17: `communityRecommendations.ts` and related components

**Files:**
- Modify: `src/services/communityRecommendations.ts`
- Modify: `src/components/autogear/CommunityActions.tsx`
- Modify: `src/components/encounters/EncounterList.tsx` (vote casting)

- [ ] **Step 1: Audit**

```bash
grep -n "user.id\|user?\.id\|created_by\|recommendation.*vote" src/services/communityRecommendations.ts src/components/autogear/CommunityActions.tsx src/components/encounters/EncounterList.tsx
```

- [ ] **Step 2: Apply the split**

- Recommendation creation / authorship → `activeProfileId`
- Recommendation votes → `user.id` (auth user) — one vote per human regardless of profile
- Encounter votes → `user.id` (auth user)
- Encounter notes → `activeProfileId`

In each call site, choose the right id source explicitly. Add a comment near each `user.id` use that's intentionally NOT `activeProfileId` so future readers know it's not a miss.

- [ ] **Step 3: Verify**

- Cast a community recommendation vote while on an alt. Verify the row is recorded with `user_id = auth.uid()`, not the alt's id.
- Author a recommendation while on an alt. Verify `created_by` is the alt's id.

- [ ] **Step 4: Commit**

```bash
git add src/services/communityRecommendations.ts src/components/autogear/CommunityActions.tsx src/components/encounters/EncounterList.tsx
git commit -m "feat(profile): split community votes (auth user) vs authorship (active profile)"
```

---

### Task 18: Catch-all audit

**Files:** any file the audit surfaces.

- [ ] **Step 1: Re-grep**

```bash
grep -rn "useAuth().user.id\|useAuth().user?.id\|user\.id\|user?\.id" src/ \
    --include="*.ts" --include="*.tsx" \
    | grep -v "test\|spec\|altAccountService\|userProfileService"
```

- [ ] **Step 2: Triage every match into one of three buckets**

For each remaining match in app code, decide:

1. **Game-data scoping** — switch to `activeProfileId`.
2. **Auth-identity / one-vote-per-human / admin** — keep `user.id`. Add a comment if it's not obvious.
3. **Already correct** (e.g., displaying signed-in user email) — leave alone.

Likely remaining sites to triage:
- `src/pages/ProfilePage.tsx` (loads main profile data — what should this load when on an alt? probably `activeProfile` instead — see Task 22)
- `src/pages/manager/AutogearPage.tsx`
- `src/pages/database/LeaderboardPage.tsx` (leaderboards — likely identity-level)
- `src/pages/admin/AdminPanel.tsx` (admin — keep)
- `src/components/admin/AllUsersTable.tsx` (admin — keep)
- `src/components/engineering/EngineeringLeaderboards.tsx`

- [ ] **Step 3: Apply changes per the triage**

- [ ] **Step 4: Verify**

Smoke the app end-to-end: home, ships, gear, autogear, engineering, encounters, profile, admin (if admin user). No console errors.

- [ ] **Step 5: Commit**

```bash
git add -A # only the audited files; double-check git status first
git commit -m "feat(profile): catch-all audit — classify remaining user.id sites"
```

---

## Phase 6 — UI: Sidebar Switcher

### Task 19: `AltAccountIcon` and `ProfileSwitcher` component

**Files:**
- Create: `src/components/ui/icons/AltAccountIcon.tsx`
- Create: `src/components/ui/layout/ProfileSwitcher.tsx`

**Reference:** existing icons in `src/components/ui/icons/` for SVG patterns. Existing `Dropdown` component for the switcher menu.

- [ ] **Step 1: Add the icon**

Choose any reasonable icon (e.g., a "person-plus" or "users" silhouette). Match the project's existing icon style:

```tsx
// src/components/ui/icons/AltAccountIcon.tsx
import React from 'react';

export const AltAccountIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {/* paths — match existing icon idioms */}
    </svg>
);
```

- [ ] **Step 2: Build the switcher**

```tsx
// src/components/ui/layout/ProfileSwitcher.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveProfile } from '../../../contexts/ActiveProfileProvider';
import { Dropdown, DropdownItem } from '../Dropdown';
import { AltAccountIcon } from '../icons/AltAccountIcon';

export const ProfileSwitcher: React.FC = () => {
    const { profiles, activeProfile, isOnAlt, switchProfile, profilesLoading } = useActiveProfile();
    const navigate = useNavigate();

    if (profilesLoading || !activeProfile) return null;

    const sorted = [...profiles].sort((a, b) => {
        if (a.owner_auth_user_id === null) return -1; // main first
        if (b.owner_auth_user_id === null) return 1;
        return (a.username ?? '').localeCompare(b.username ?? '');
    });

    return (
        <Dropdown
            trigger={
                <span className={`flex items-center gap-2 ${isOnAlt ? 'text-amber-400' : ''}`}>
                    <AltAccountIcon className="w-4 h-4" />
                    {activeProfile.username ?? 'Profile'}
                </span>
            }
        >
            {sorted.map((p) => (
                <DropdownItem
                    key={p.id}
                    onClick={() => switchProfile(p.id)}
                    disabled={p.id === activeProfile.id}
                >
                    {p.owner_auth_user_id === null ? 'Main' : p.username}
                    {p.id === activeProfile.id ? ' (active)' : ''}
                </DropdownItem>
            ))}
            <DropdownItem onClick={() => navigate('/profile')}>
                Manage profiles
            </DropdownItem>
        </Dropdown>
    );
};
```

(Adjust to the actual `Dropdown` API — read `src/components/ui/Dropdown.tsx` first.)

- [ ] **Step 3: Verify in isolation**

Render `<ProfileSwitcher />` somewhere temporary (e.g., the sidebar) and confirm it renders the active profile name. Don't ship the temporary mount; integration happens in Task 20.

- [ ] **Step 4: Type-check + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/ui/icons/AltAccountIcon.tsx src/components/ui/layout/ProfileSwitcher.tsx
git commit -m "feat(profile): ProfileSwitcher component (sidebar badge + dropdown)"
```

---

### Task 20: Integrate `ProfileSwitcher` into the Sidebar

**Files:**
- Modify: `src/components/ui/layout/Sidebar.tsx`

- [ ] **Step 1: Read the sidebar**

```bash
cat src/components/ui/layout/Sidebar.tsx | head -80
```

Identify the user/avatar slot.

- [ ] **Step 2: Mount `ProfileSwitcher`**

Place `<ProfileSwitcher />` near the existing user email/sign-out controls. Render it only when `useAuth().user` is truthy (don't show it for unauthenticated users / demo mode).

```tsx
{user && <ProfileSwitcher />}
```

- [ ] **Step 3: Verify in browser**

```bash
npm start
```

- Sign in. Confirm the switcher shows your username.
- Click it; the dropdown lists "Main" + "Manage profiles".
- (No alts exist yet, so only Main is listed.)

- [ ] **Step 4: Type-check + lint + commit**

```bash
git add src/components/ui/layout/Sidebar.tsx
git commit -m "feat(profile): mount ProfileSwitcher in sidebar"
```

---

## Phase 7 — UI: Profile Page Alt Management

### Task 21: `AltAccountsSection` (list + counter + empty state)

**Files:**
- Create: `src/components/profile/AltAccountsSection.tsx`

- [ ] **Step 1: Build the section**

```tsx
// src/components/profile/AltAccountsSection.tsx
import React, { useState } from 'react';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { CreateAltModal } from './CreateAltModal';
import { RenameAltModal } from './RenameAltModal';
import { ConfirmModal } from '../ui/ConfirmModal';

const MAX_ALTS = 5;

export const AltAccountsSection: React.FC = () => {
    const {
        profiles, activeProfile, switchProfile, togglePublicAlt, deleteAlt,
    } = useActiveProfile();
    const { addNotification } = useNotification();
    const [createOpen, setCreateOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const alts = profiles.filter((p) => p.owner_auth_user_id !== null);
    const atCap = alts.length >= MAX_ALTS;

    const onDelete = async (id: string) => {
        try {
            await deleteAlt(id);
            addNotification('success', 'Alt deleted');
        } catch (err) {
            addNotification('error', `Failed to delete alt: ${err instanceof Error ? err.message : 'unknown'}`);
        } finally {
            setDeleteTarget(null);
        }
    };

    return (
        <div className="card">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Alt accounts</h3>
                <span className="text-sm text-dark-text-secondary">{alts.length} / {MAX_ALTS}</span>
            </div>

            {alts.length === 0 ? (
                <p className="text-sm text-dark-text-secondary mb-4">
                    Manage multiple game accounts under your login. Each alt has its own ships,
                    gear, and engineering, and can have its own public profile.
                </p>
            ) : (
                <ul className="space-y-2 mb-4">
                    {alts.map((alt) => {
                        const isActive = alt.id === activeProfile?.id;
                        return (
                            <li key={alt.id} className="flex items-center gap-3 p-2 border border-dark-border rounded">
                                <div className="flex-1">
                                    <div className="font-medium">{alt.username}</div>
                                </div>
                                <Checkbox
                                    label="Public"
                                    checked={alt.is_public}
                                    onChange={(e) => void togglePublicAlt(alt.id, e.target.checked)}
                                />
                                {isActive ? (
                                    <span className="text-xs text-amber-400">Active</span>
                                ) : (
                                    <Button size="sm" variant="secondary" onClick={() => switchProfile(alt.id)}>
                                        Switch to
                                    </Button>
                                )}
                                <Button size="sm" variant="secondary" onClick={() => setRenameTarget(alt.id)}>
                                    Rename
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setDeleteTarget(alt.id)}>
                                    Delete
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Button
                onClick={() => setCreateOpen(true)}
                disabled={atCap}
                title={atCap ? 'Alt limit reached (5)' : undefined}
            >
                Create alt
            </Button>

            {createOpen && (
                <CreateAltModal onClose={() => setCreateOpen(false)} />
            )}
            {renameTarget && (
                <RenameAltModal
                    altId={renameTarget}
                    currentUsername={alts.find((a) => a.id === renameTarget)?.username ?? ''}
                    onClose={() => setRenameTarget(null)}
                />
            )}
            {deleteTarget && (
                <ConfirmModal
                    isOpen={true}
                    title="Delete alt account?"
                    message={`This will permanently delete "${alts.find((a) => a.id === deleteTarget)?.username}" and all its ships, gear, engineering, loadouts, and autogear configs. This cannot be undone.`}
                    confirmLabel="Delete"
                    onConfirm={() => void onDelete(deleteTarget)}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}
        </div>
    );
};
```

(Adjust `Button`, `Checkbox`, `ConfirmModal` props to match the actual component APIs in `src/components/ui/`.)

- [ ] **Step 2: Type-check + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/components/profile/AltAccountsSection.tsx
git commit -m "feat(profile): AltAccountsSection card listing and managing alts"
```

---

### Task 22: `CreateAltModal` and `RenameAltModal`

**Files:**
- Create: `src/components/profile/CreateAltModal.tsx`
- Create: `src/components/profile/RenameAltModal.tsx`

- [ ] **Step 1: CreateAltModal**

```tsx
// src/components/profile/CreateAltModal.tsx
import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { useNotification } from '../../hooks/useNotification';

interface Props {
    onClose: () => void;
}

export const CreateAltModal: React.FC<Props> = ({ onClose }) => {
    const { createAlt } = useActiveProfile();
    const { addNotification } = useNotification();
    const [username, setUsername] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await createAlt(username.trim());
            addNotification('success', 'Alt created. Switch to it to import game data.');
            onClose();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create alt';
            setError(msg.includes('users_username_key') ? 'Username taken' : msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal isOpen onClose={onClose} title="Create alt account">
            <div className="space-y-4">
                <Input
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    error={error ?? undefined}
                    helpLabel="Used as both display name and public profile URL"
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={() => void onSubmit()} disabled={!username.trim() || submitting}>
                        {submitting ? 'Creating…' : 'Create'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
```

- [ ] **Step 2: RenameAltModal**

Mirror `CreateAltModal` but use `renameAlt(altId, newUsername)`. Pre-fill the input with the current username.

- [ ] **Step 3: Type-check + lint + commit**

```bash
git add src/components/profile/CreateAltModal.tsx src/components/profile/RenameAltModal.tsx
git commit -m "feat(profile): CreateAltModal and RenameAltModal"
```

---

### Task 23: Mount `AltAccountsSection` on `ProfilePage`

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

- [ ] **Step 1: Inspect current layout**

```bash
head -100 src/pages/ProfilePage.tsx
```

- [ ] **Step 2: Render the section**

Add `<AltAccountsSection />` to the profile page. Place it after the user's own profile editor card.

Decide: when on an alt, should the page edit the alt's main fields (username, in_game_id, is_public) or the auth user's? Per spec, alts have their own username + is_public. The simplest behavior: the page always edits the active profile (so switching to an alt and visiting `/profile` lets you edit the alt). The "Alt accounts" section appears only on main, since alts can't own alts.

```tsx
const { activeProfile, isOnAlt } = useActiveProfile();
// ... existing code editing the profile, but use activeProfile instead of fetching by user.id
{!isOnAlt && <AltAccountsSection />}
```

You'll likely need to switch the page's existing `getUserProfile(user.id)` call to use `activeProfileId`, or just consume `activeProfile` directly from the context. Pick the approach that requires the fewest changes to the existing form state.

- [ ] **Step 3: Verify in browser**

- On main → "Alt accounts" section renders, can create alts.
- Switch to an alt → page now edits the alt's username/is_public; "Alt accounts" section is hidden.
- Switch back to main.

- [ ] **Step 4: Type-check + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/pages/ProfilePage.tsx
git commit -m "feat(profile): mount AltAccountsSection on profile page"
```

---

## Phase 8 — Final Passes

### Task 24: Edge cases — explicit checks

**Files:** various, fixes only.

- [ ] **Step 1: Stale active profile fallback**

Already implemented in `ActiveProfileProvider` (the `useEffect` that detects a stored id missing from the fetched list). Smoke-test:

1. Create an alt.
2. Switch to it.
3. From a SQL session: `DELETE FROM public.users WHERE id = '<alt-id>' AND owner_auth_user_id = '<auth-id>';`
4. Refresh the app.
5. Expected: app loads on main, with a notification "Alt no longer exists — switched to main."

- [ ] **Step 2: Sign-out cleanup**

Smoke-test:

1. Sign in, switch to an alt.
2. Sign out.
3. Sign in as a different user.
4. Expected: new user lands on Main (their own), not on the previous user's alt.

(The provider's `app:signout` listener handles this.)

- [ ] **Step 3: Demo mode no-op**

Smoke-test:

1. Sign out, load demo data.
2. Expected: sidebar profile switcher is hidden; profile page does not show alt section.

(Provider returns `activeProfileId = null` when no auth user.)

- [ ] **Step 4: Switch-before-delete race**

Already implemented in `deleteAlt` in the provider. Verify by deleting the currently-active alt from the UI — page should not show "no profile" intermediate state.

- [ ] **Step 5: If any of the above fail, fix and re-verify.**

- [ ] **Step 6: If fixes were needed, commit them.**

```bash
git commit -m "fix(profile): edge cases in alt account handling"
```

---

### Task 25: Apply migrations to dev DB and end-to-end smoke

**Files:** none (pure verification).

- [ ] **Step 1: Apply all three migrations to the dev Supabase project**

```bash
supabase db push
```

If using a remote dev project, ensure migrations land there too.

- [ ] **Step 2: End-to-end happy path**

1. Sign in as your dev user.
2. Confirm sidebar shows your main username with the neutral icon.
3. Open profile page → "Alt accounts" section, 0 / 5.
4. Create alt named "test-alt-1". Toast appears.
5. Switch to it via sidebar dropdown. Sidebar badge turns amber and shows "test-alt-1".
6. Verify ships page is empty for the alt.
7. Import a JSON. Verify ships appear under the alt.
8. Switch back to main. Verify main's ships are unchanged.
9. From profile page, delete the alt. Verify auto-switch to main and confirmation toast.
10. Verify alt's ships are gone (try to query directly, should return 0 rows).

- [ ] **Step 3: Soft cap**

1. Create 5 alts.
2. Confirm "Create alt" button is disabled with tooltip.
3. Force the issue: in dev tools, manually call `createAlt('alt-6')` against the active profile context (or try via SQL). Confirm DB raises with `Alt account limit reached`.

- [ ] **Step 4: Public alt**

1. Mark an alt `is_public = true`.
2. Visit the public profile route for the alt's username (incognito).
3. Confirm it loads the alt's data.

- [ ] **Step 5: Admin tab while on alt**

(Skip if your dev user is not admin.) Switch to alt → admin nav item is still visible and admin panel still works.

- [ ] **Step 6: Multi-tab independence**

Open the app in two tabs. Switch to an alt in tab A. Verify tab B is unaffected (still on main). Documented behavior.

- [ ] **Step 7: If any failure, file a fix as a follow-up task and revisit.**

---

### Task 26: Final cleanup and PR

**Files:** none (commits + PR).

- [ ] **Step 1: Run full verification**

```bash
npm run lint && npx tsc --noEmit && npx vitest --run
```

Expected: lint clean, types clean, all tests pass.

- [ ] **Step 2: Review the diff**

```bash
git log main..HEAD --oneline
git diff main..HEAD --stat
```

Confirm:
- Three migration files added.
- New service, provider, components, icons added.
- Five data contexts modified.
- Service/hook layer updates.
- UI integration (sidebar + profile page).
- No stray debug code or commented-out blocks.

- [ ] **Step 3: Manual QA pass — repeat Task 25 steps 2–6 cleanly.**

- [ ] **Step 4: Push and open PR (only when user explicitly authorizes)**

Do NOT push without the user's explicit go-ahead.

```bash
gh pr create --title "feat(profile): alt accounts" --body "$(cat <<'EOF'
## Summary
- Adds support for one auth user owning a Main profile plus up to 5 Alt profiles
- Each profile has its own ships/gear/engineering/loadouts/autogear configs/tutorial state
- Alts have their own username + public profile toggle (shared username namespace with main)
- Sidebar badge + dropdown for switching; profile page card for managing alts
- DB: owner_auth_user_id column + has_profile_access RLS helper + auth-delete cascade trigger
- Soft cap of 5 alts per owner (DB-enforced)
- Encounter / community-recommendation votes intentionally stay auth-user-scoped (one vote per human)

## Test plan
- [ ] Sign in, create alt, switch to it, import JSON, verify scoped data
- [ ] Switch back to main, confirm independence
- [ ] Create 5 alts, confirm 6th rejected
- [ ] Delete active alt, confirm auto-switch to main
- [ ] Public alt resolves at its public profile URL
- [ ] Admin panel still works while switched into alt
- [ ] Multi-tab tabs are independent (expected)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the Implementer

- **Follow TDD where it pays off:** the service layer and pure helpers have tests. Contexts and UI are verified manually (consistent with the existing project pattern; the codebase notes contexts/UI aren't heavily tested).
- **Commit per task.** Each commit should leave the app in a working state. Phase 1 commits are DB-only and don't affect runtime behavior. Phase 2+ commits incrementally route data contexts through `activeProfileId`, which defaults to `auth.uid()` until alts exist.
- **Don't skip the audit grep in Task 18.** The plan enumerates known sites, but the codebase evolves — re-grep before declaring the swap complete.
- **The RLS migration in Task 3 is template+checklist.** Expand the `-- TODO` and `-- ... and ...` sections by mirroring the patterns in `20260221000002_rls_user_owned_tables.sql` and `20260221000003_rls_child_tables.sql`. Walk those files end-to-end. Do not rely on grep alone — child-table policies can span multiple lines.
- **Watch for behavior changes you didn't intend.** Per-profile usage tracking means admin's "top users" list may show alts as separate rows (intentional, per spec). Per-profile tutorial state means switching to a fresh alt re-runs the tutorial (intentional).
- **One PR for the whole feature.** Migrations are backwards-compatible, so partial rollout is theoretically possible, but there's no value in shipping migrations without UI.
