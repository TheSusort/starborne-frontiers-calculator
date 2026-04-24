# Alt Accounts — Design

**Date:** 2026-04-24
**Status:** Approved for implementation planning

## Problem

Players often run multiple game accounts in Starborne Frontiers (different factions, alt fleets, etc.). Today the calculator scopes everything to a single Supabase auth user, so a player who wants to track two game accounts must either juggle separate browser logins or repeatedly wipe and re-import data. We want to let one logged-in human manage multiple game-account "profiles" under their single auth identity, with a switcher in the UI and proper data isolation per profile.

## Goals

- One auth user (one human) owns one **main** profile and up to **5 alt** profiles.
- Each profile has its own ships, gear, engineering stats, autogear configs, loadouts, starred ships, tutorial state, and statistics snapshots.
- Each profile has its own username (which also serves as its display name) and `is_public` toggle. Alts are first-class identities for public-facing features (public profile pages, community recommendations).
- A persistent UI badge makes the active profile unmistakable; switching is one click from the sidebar.
- Admin status, heartbeat tracking, and authentication remain tied to the auth user — they do not switch with the profile.

## Non-goals

- Sharing alts between auth users (no co-op ownership).
- Allowing alts to log in with their own credentials.
- Cross-profile views (compare-alts dashboard, sum-across-alts metrics).
- Per-tab profile sync via the `storage` event (tabs are independent for now; can be added later).

## High-level approach

Add a new column `owner_auth_user_id` on `public.users` that points at the owning `auth.users.id` when the row represents an alt (NULL for main accounts). Drop the FK from `public.users.id → auth.users(id)` so alts can exist without an auth row, and replace the cascade behavior it provided with an explicit `auth.users` DELETE trigger.

Client-side, introduce an `ActiveProfileProvider` that wraps `AuthProvider` and exposes an `activeProfileId` (defaulting to `auth.uid()`, or the alt's user id when switched). All data contexts (ships, inventory, engineering, autogear configs, tutorial, statistics) swap their `user.id` reads for `activeProfileId`. Auth-identity callers (heartbeat, admin checks, sign-in/out) keep using `useAuth().user`.

RLS is rewritten via a single helper function `has_profile_access(target_user_id)` that returns true when `auth.uid()` either is the row owner or owns the row's profile.

## Data model

### `public.users` changes

| Change | Detail |
|---|---|
| Add column | `owner_auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE`. NULL = main account. Non-NULL = alt owned by that auth user. |
| Drop FK | `public.users.id → auth.users(id)` is dropped. `id` remains a PK uuid but no longer needs an auth.users row. |
| Default `id` | `ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();`. The existing `insert_user()` trigger explicitly supplies `id` for real users (= `auth.users.id`), so it is unaffected. Alt creation omits `id` on INSERT and the DB generates it, which also satisfies the new INSERT RLS check `id != auth.uid()`. |
| Relax email | `email` becomes nullable. The unique constraint on `email` is replaced with a partial unique index `WHERE email IS NOT NULL` so real users still can't share an email. |
| Username | Unchanged. Stays `UNIQUE NOT NULL`. Alts share the same global username namespace as main accounts (driven by the public profile route). |
| `is_admin` | Default false for alts. Never elevated for alts in the normal flow. RLS admin checks read `auth.uid()`'s row only, so alt `is_admin` values are inert. |
| `is_public` | Alt-controllable; same mechanics as main accounts. |
| Index | `CREATE INDEX users_owner_auth_user_id_idx ON public.users(owner_auth_user_id) WHERE owner_auth_user_id IS NOT NULL;` (partial — most rows are NULL). |
| Soft cap | A `BEFORE INSERT` trigger on `public.users` raises if `owner_auth_user_id IS NOT NULL` and the owner already has 5 alts. App-level validation also gates the create button at 5 for friendlier UX, but the DB is the source of truth. |

### New trigger: `auth.users` DELETE → cascade

Replaces the cascade behavior lost when the `public.users.id → auth.users(id)` FK is dropped. Also extends it to clean up alts owned by the deleted auth user.

```sql
CREATE OR REPLACE FUNCTION public.handle_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.users WHERE id = OLD.id;
  DELETE FROM public.users WHERE owner_auth_user_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_delete();
```

### New RLS helper

```sql
CREATE OR REPLACE FUNCTION public.has_profile_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = target_user_id
      AND (id = auth.uid() OR owner_auth_user_id = auth.uid())
  );
$$;
```

`STABLE` so the planner can cache within a statement. One indexed lookup per row check.

### No data backfill required

Existing `public.users` rows have `owner_auth_user_id = NULL` by default, which correctly identifies them as main accounts. The dropped FK has no migration consequences because all existing rows already have matching `auth.users` rows.

## RLS rewrite

### Mechanical swap on user-owned tables

Across the following tables currently using `auth.uid() = user_id`:

- `ships`
- `inventory_items`
- `engineering_stats`
- `autogear_configs`
- `loadouts`
- `team_loadouts`
- `statistics_snapshots`
- `user_activity_log`
- `encounter_notes` (keeps its `is_public` branch unchanged for the public-view path)
- `community_recommendations` — uses `created_by` (not `user_id`) but follows the same per-profile rule. Swap `auth.uid() = created_by` to `public.has_profile_access(created_by)`.

Apply:

```sql
-- before
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)

-- after
USING (public.has_profile_access(user_id))
WITH CHECK (public.has_profile_access(user_id))
```

Public-visibility branches (`is_public = true`) and admin branches (`public.is_admin()`) are unchanged.

The implementation plan must do a final audit re-grep against `supabase/migrations/` covering every variant of the auth-uid pattern: `auth.uid() = user_id`, `user_id = auth.uid()`, `auth.uid() = created_by`, `created_by = auth.uid()`, and any subquery form `WHERE x.user_id = auth.uid()` / `WHERE x.created_by = auth.uid()`. The grep-only approach catches direct policies but misses child-table subquery patterns — the plan must explicitly walk `20260221000003_rls_child_tables.sql` end-to-end.

### Tables intentionally excluded from the swap

Both kept on `auth.uid() = user_id` for one-vote-per-human community sentiment. Allowing each profile to vote would inflate vote counts up to 6× per user. Client-side voting always passes `user.id` (auth uid), not `activeProfileId`.

- **`encounter_votes`**
- **`community_recommendation_votes`**

### Child tables (subquery-based policies)

Several tables (`ship_base_stats`, `ship_equipment`, `ship_implants`, `ship_implant_stats`, `ship_refits`, `ship_refit_stats`, `loadout_equipment`, `team_loadout_ships`, `team_loadout_equipment`, `encounter_formations`, etc.) currently use the variant pattern `parent.user_id = auth.uid()` via subquery to inherit access from their parent. These must also be swapped to `public.has_profile_access(parent.user_id)`. See `supabase/migrations/20260221000003_rls_child_tables.sql` for the full set — the implementation plan must enumerate every policy in that file and apply the corresponding swap.

### Columns (not tables) that get profile scoping client-side

- `ships.starred` — scoped by the existing `ships` RLS policy, which is already being rewritten above. No separate change needed.
- `users.tutorial_completed_groups` — scoped by the `users` RLS policy update below. Each profile's row carries its own tutorial state column.

### `public.users` policy changes

```sql
-- SELECT: extended to include owned alts
DROP POLICY IF EXISTS "Users can view own or public profiles" ON public.users;
CREATE POLICY "Users can view own, owned alts, or public profiles" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR owner_auth_user_id = auth.uid()
    OR is_public = true
  );

-- UPDATE: owner can update own profile and owned alts
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile or owned alts" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR owner_auth_user_id = auth.uid())
  WITH CHECK (auth.uid() = id OR owner_auth_user_id = auth.uid());

-- INSERT (new): allow inserting alts only
CREATE POLICY "Users can insert alt profiles they own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_auth_user_id = auth.uid()
    AND id != auth.uid()
    AND is_admin = false
  );

-- DELETE (new): owner can delete owned alts
CREATE POLICY "Users can delete owned alts" ON public.users
  FOR DELETE TO authenticated
  USING (owner_auth_user_id = auth.uid());

-- "Admins can view all users" policy unchanged
```

The existing `delete_user()` SECURITY DEFINER flow handles deletion of main accounts via auth — the new DELETE policy above is alts-only.

### Performance note

`has_profile_access` does one indexed PK lookup on `public.users` per row check. For typical result sets (a few hundred ships) this is effectively free. If a future query causes measurable RLS overhead, we can pre-compute accessible profile ids once per request — but no premature optimization here.

## Client-side architecture

### New provider

`src/contexts/ActiveProfileProvider.tsx`, layered above all data contexts.

```ts
interface ActiveProfileContextType {
  activeProfileId: string | null;     // auth.uid() default, or alt's user_id when switched
  activeProfile: UserProfile | null;  // full row for the active profile
  profiles: UserProfile[];            // main + all owned alts
  isOnAlt: boolean;
  switchProfile: (id: string) => void;
  createAlt: (username: string) => Promise<UserProfile>;   // alt display name = alt username; no separate field
  renameAlt: (id: string, username: string) => Promise<void>;
  togglePublicAlt: (id: string, isPublic: boolean) => Promise<void>;
  deleteAlt: (id: string) => Promise<void>;
}
```

### Codebase rule

| Concern | Source |
|---|---|
| Auth identity (email, sign in/out, `is_admin` checks, heartbeat) | `useAuth().user` |
| Game-data scoping (anything currently filtering by `user.id`) | `useActiveProfile().activeProfileId` |

### Consumers that change

Mechanical `user.id` → `activeProfileId` swap:

- `src/contexts/ShipsContext.tsx`
- `src/contexts/InventoryProvider.tsx`
- `src/contexts/EngineeringStatsProvider.tsx`
- `src/contexts/AutogearConfigContext.tsx`
- `src/contexts/TutorialContext.tsx`
- `src/services/shipTemplateProposalService.ts` (`submitted_by_user_id` is the active profile)
- `src/services/usageTracking.ts` (autogear runs / data imports recorded against active profile so admin analytics shows per-alt activity)
- `src/services/statisticsSnapshotService.ts`
- Loadout / team-loadout / starred-ship persistence
- Any other site using `user.id` for game-scoped queries — full audit lives in the implementation plan.

### Consumers that don't change

- `src/contexts/AuthProvider.tsx` itself
- `src/services/heartbeatService.ts` (one human = one session)
- `src/services/adminService.ts` (admin RPCs use `auth.uid()` via SECURITY DEFINER)
- Demo-mode guards
- Anything reading `user.email` or `is_admin` directly
- Encounter vote casting (always uses `user.id`, never `activeProfileId`, per the RLS exclusion above)

### Switching mechanism

`switchProfile(id)` writes the new id to localStorage key `active_profile_id`, then dispatches `app:profile:switch` (mirrors the existing `app:signout` pattern). Every data context listens, resets local state, and refetches under the new `activeProfileId`.

### Initialization sequence

1. Auth state change → `user` hydrates in `AuthProvider`.
2. `ActiveProfileProvider` runs `SELECT * FROM users WHERE id = auth.uid() OR owner_auth_user_id = auth.uid()` (allowed by the extended SELECT policy).
3. If localStorage `active_profile_id` is present **and** appears in the fetched profiles list, that becomes the active profile. Otherwise fall back to main (`auth.uid()`).
4. Data contexts must await profile hydration (i.e., a non-loading `activeProfileId` from `ActiveProfileProvider`) before firing their initial loads. Otherwise a refresh-while-on-alt would race the fetch and load main's data first, then re-load alt's data on hydration. Each data context guards its initial fetch on `activeProfileId !== null && !isProfileLoading`.

### Stale active profile handling

If `active_profile_id` doesn't appear in the freshly-fetched `profiles` (alt deleted from another device, etc.), silently fall back to main, clear the stale localStorage key, and notify the user: "Alt no longer exists — switched to main."

### Sign-out

Clears `active_profile_id` from localStorage. Existing `app:signout` flow is otherwise unchanged.

### Migration events

`app:migration:start` / `app:migration:end` (localStorage → Supabase on first Google sign-in) stay tied to first sign-in only. Profile switches do not trigger them.

### Unauthenticated / demo mode

`ActiveProfileProvider` is a no-op: `activeProfileId = null`, `profiles = []`, alt CRUD methods throw if invoked. Sidebar badge hidden. Demo mode is unchanged.

### Multi-tab behavior

Tabs are independent. Each tab keeps the profile it loaded with; we do not currently sync via `storage` events. (This matches existing behavior — signing out in one tab does not affect others.) Can be added later if needed.

### Client-side caches

The inventory IndexedDB cache key (and any other game-data caches in localStorage) must include `activeProfileId`, e.g. `inventory_items:<profileId>`. A one-time wipe of legacy unkeyed entries runs on first load post-deploy from inside the storage hook init.

## UI

### Sidebar badge / quick switcher

- Lives near the existing user email/avatar slot in the sidebar.
- Shows the active profile's display name with an icon.
- Color-coded: neutral when on main, distinct accent color (e.g., amber) when on an alt — visually unmistakable at a glance.
- Click → `Dropdown` listing all profiles (main first, then alts alphabetically), each row triggers `switchProfile(id)`. Bottom item is a "Manage profiles" link to the profile page.
- Brief toast after switching: "Switched to <display name>".

### Profile page — new "Alt accounts" section

Card on the existing profile page.

- Header: "Alt accounts" + counter "<n> / 5".
- Empty state: short blurb explaining alts + "Create alt" button.
- Populated state: each alt rendered as a row inside the card with:
  - Username (which is also its display name)
  - `is_public` toggle (existing `Checkbox` primitive)
  - "Switch to" button (or disabled "Active" label when current)
  - "Rename" button → `Modal` with one `Input` (username — also serves as display name)
  - "Delete" button → `ConfirmModal`
- "Create alt" button at the bottom, disabled with tooltip when count == 5.
- Username uniqueness enforced by DB; on collision, surface the Supabase error inline as "Username taken." No real-time debounced check needed.

### Create alt flow

1. User submits create form.
2. `createAlt(username)` inserts the `public.users` row (allowed by new INSERT RLS policy). The username also serves as the alt's display name — no separate field.
3. On success, refresh `profiles` list. Toast: "Alt created. Switch to it to import game data."
4. Stay on profile page. User clicks "Switch to" when ready.
5. After switching, the regular `ImportButton` flow on the home page imports against the alt's `user_id` — no new entry point needed.

### Delete alt flow

1. User clicks Delete → `ConfirmModal` with strong warning: "This will permanently delete <name> and all its ships, gear, engineering, loadouts, and autogear configs. This cannot be undone."
2. No typed-username confirm — the confirm modal is enough friction.
3. If the user is currently switched into the alt being deleted, switch back to main *before* the DELETE query fires (avoids "active profile vanished" race).
4. DELETE the `public.users` row → cascades through ships, inventory, engineering, autogear configs, loadouts, etc. via existing FKs. No additional cleanup code.
5. Clear any IndexedDB / localStorage entries keyed on the deleted profile id (belt-and-suspenders).

### Public profile routing for alts

Existing route resolves users by `username`. Alts have rows in `public.users` with usernames, so the public route works for alts with zero changes. The public profile view should show the alt's own data only — verify in the implementation plan that the existing query is keyed by `user_id` / username and not by anything that needs to be alt-aware.

### UI primitives

Per `CLAUDE.md`: use `card` class, `Button`, `Input`, `Modal`, `ConfirmModal`, `Dropdown`, `Checkbox`. New "alt account" icon goes in `src/components/ui/icons/`. No raw HTML buttons or hand-rolled cards.

## Import pipeline & service-layer scoping

### Functions threaded with `targetProfileId`

Currently read `user.id` from auth context internally; refactor to take a parameter:

- `syncMigratedDataToSupabase(userId, ...)` — already takes `userId`; callers pass `activeProfileId`.
- `importPlayerData()` and helpers in `src/utils/migratePlayerData.ts` — accept `targetProfileId`.
- `shipTemplateProposalService.ts` — `submitted_by_user_id` is the active profile.
- `usageTracking.ts` — `recordAutogearRun()`, `recordDataImport()` etc. write against the active profile.
- `statisticsSnapshotService.ts` — snapshots are per-profile.

### Functions that keep using auth user identity

- `heartbeatService.ts`
- Admin RPCs (`get_top_active_users`, etc.)
- Anything reading `user.email` or `is_admin` directly

### UI injection points

- `ImportButton` reads `useActiveProfile().activeProfileId` and passes it down.
- The auth-time migration on first sign-in always targets main (`auth.uid()`); alts can't exist before first sign-in, so there's no ambiguity.
- Autogear save flows in `AutogearConfigContext` swap `user.id` for `activeProfileId`.

### Hangar sharing (`frontiers.cubedweb.net`)

Fires per-import — keep it that way, so an alt's import shares that alt's hangar. No special handling beyond passing the right data through.

## Cross-cutting edge cases

- **Admin tab** — visible whenever `auth.uid()`'s row has `is_admin = true`, regardless of active profile. Admin panel itself needs no profile awareness.
- **Demo mode** — `ActiveProfileProvider` no-ops; sidebar badge hidden; alt CRUD throws if called.
- **Anonymous sentinel (`00000000-…`)** — alts can never have that id (RLS INSERT policy requires `id != auth.uid()`, and the sentinel's `owner_auth_user_id` is NULL, so it's never listed as an alt for any real user). No interaction.
- **Tutorial system** — `TutorialContext` reads `activeProfileId`; alts get their own tutorial state (each alt is a fresh game account, so re-running the tutorial is correct). Switch mid-tutorial cancels the in-progress overlay.
- **Concurrent tabs** — independent (no `storage` event sync).
- **Switch + delete race** — handled by switching back to main before the DELETE query fires.
- **Username collisions** — server-side `UNIQUE` catches it; surface the Supabase error inline.
- **`email` nullability** — audit for code that does `email.toLowerCase()` etc. without null-checking. Any such call is for real users only (alts won't reach those code paths) but defensive null-checks are warranted.
- **Cache invalidation on alt deletion** — clear IndexedDB / localStorage entries keyed on the deleted profile id.

## Migrations & rollout

### Files (in order — schema → triggers → RLS)

1. **`supabase/migrations/20260424000001_alt_accounts_users_schema.sql`**
   - Drop FK `public.users.id → auth.users(id)`
   - Set `DEFAULT gen_random_uuid()` on `public.users.id` so alt INSERTs can omit it
   - Make `public.users.email` nullable
   - Replace email unique constraint with partial unique index `WHERE email IS NOT NULL`
   - Add column `public.users.owner_auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE`
   - Add partial index on `owner_auth_user_id`

2. **`supabase/migrations/20260424000002_alt_accounts_triggers.sql`**
   - `handle_auth_user_delete()` function + trigger on `auth.users` DELETE
   - Soft-cap `BEFORE INSERT` trigger on `public.users` (raises if owner already has 5 alts)

3. **`supabase/migrations/20260424000003_alt_accounts_rls.sql`**
   - `has_profile_access(uuid)` function
   - Replace every `auth.uid() = user_id` policy across all user-owned tables (full table list in implementation plan)
   - Update `public.users` SELECT/UPDATE policies to include owned alts; add INSERT and DELETE policies for alt CRUD

### No data backfill

Existing rows have `owner_auth_user_id = NULL` and satisfy the new constraints.

### Rollout

Single PR — migrations + `ActiveProfileProvider` + UI changes + service-layer scoping all together. The migrations are backwards-compatible (existing app code keeps working with `owner_auth_user_id = NULL`), so there is no broken-in-between state, but there is also no value in the migrations without the UI.

No feature flag required. The feature is additive — existing users see no change until they create an alt.

### Rollback strategy

Roll forward, do not plan to roll back the schema. If the UI needs to be pulled but data has been written, the schema changes are backwards-compatible (existing flows ignore `owner_auth_user_id`). To fully unwind, RLS policies would need to be reverted to the `auth.uid() = user_id` versions and the new column dropped — but only after deleting alt rows or re-attributing them.

### Verification before shipping

- **Manual QA — happy path:** create alt → switch → import a JSON → verify ships scoped to alt → switch back to main → confirm main data unchanged.
- **Manual QA — soft cap:** create 5 alts, attempt to create a 6th, confirm rejection at both UI and DB level.
- **Manual QA — delete-while-active:** delete the currently-active alt, confirm auto-switch back to main and that main data is intact.
- **Manual QA — public alt:** alt with `is_public = true` resolves at its public profile URL.
- **Manual QA — admin:** admin tab still works while switched into an alt.
- **Manual QA — multi-tab:** switching in one tab does not affect the other (expected, documented).
- **Type-check + lint clean.**

## Open items (for the implementation plan)

- Full audit of every file currently reading `useAuth().user.id` for game-data scoping (the list in this doc is representative; the plan should enumerate all sites).
- Confirm the public profile route's exact resolver path so we can verify alts route correctly with no changes.
- Confirm names of any existing localStorage keys that cache game data; each must be re-keyed by profile id with a one-time wipe of legacy entries.
- Re-grep `auth.uid() = user_id` against `supabase/migrations/` as a final audit before writing the RLS migration, in case any new user-owned tables were added after this spec was written.
- Verify that the existing `delete_user()` SECURITY DEFINER flow does not need to be alt-aware. The new `handle_auth_user_delete` trigger already cascades owned alts when the auth user is deleted, so `delete_user()` likely doesn't need changes — but confirm during plan writing.

## Acknowledged trade-offs

- **Admin "top users" analytics inflation:** because usage tracking is per-profile, the admin "top active users" view will count one human as up to 6 rows (main + 5 alts) when their alts are active. This is intentional — it gives the admin true visibility into per-account activity. If aggregation by owner becomes desirable later, the link can be reconstructed via `public.users.owner_auth_user_id`.
