# Arcade Guest Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can play the arcade and join ONE global leaderboard: guests through Supabase anonymous sign-in with a GUEST-tagged name, and fleetless pilots fly and duel bare ship templates.

**Architecture:**
- An anonymous Supabase session is hidden from `AuthContext.user`, which stays `null`, and exposed only as `guestUserId`. Every existing `user`-keyed path therefore treats a guest as signed out.
- The database reads guest-ness from the `is_anonymous` JWT claim. Guest names live in a new `arcade_guest_names` table, and the two arcade RPCs are recreated to accept and return guest data.
- The arcade gets a derived "arcade fleet": the player's ships, or bare `ship_templates` ships when the player has none. Duels take a candidate predicate instead of a gear lookup.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, Supabase (Postgres RPCs, RLS, anonymous auth).

**Spec:** `docs/superpowers/specs/2026-10-19-arcade-guest-leaderboard-design.md`

## Global Constraints

- **Worktree and branch:** `.worktrees/arcade-lb-ship`, branch `feat/arcade-leaderboard-ship`, draft PR #705. Its upstream may not be what you expect. Push only with `git push -u origin feat/arcade-leaderboard-ship`.
- **Node:** prefix every test and commit command with `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`.
- **Supabase CLI:** NEVER run it in any form. The owner applies migrations.
- **Snapshots:** never run `vitest -u`.
- **Guest names:** they match `/^[a-zA-Z0-9 _-]{3,20}$/`, the same as usernames. Uniqueness is case-insensitive and among guests only.
- **GUEST tag:** plain text with a colour class. No emoji, no `border-l-*` side accent.
- **UI primitives:** use the ones in `src/components/ui/` (`Button`, `Modal`, `Input`, `Chip`). No raw `<button>`.
- **Code comments:** present-tense behaviour only. No task numbers and no change history. See CLAUDE.md "Code Comments".
- **Changelog:** one entry per user-visible change, area prefix plus 8–12 words.

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20261019000002_arcade_guests.sql`
- Create: `docs/superpowers/plans/2026-10-19-arcade-guest-leaderboard.sql-checks.md`. This holds the verification SQL for the PR body, and is force-added because `docs/` is gitignored.

**Interfaces:**
- Produces (SQL):
  - `public.is_anonymous_session() → boolean`.
  - Table `public.arcade_guest_names(user_id uuid PK, name text, created_at timestamptz)`. The only policy is an own-row SELECT.
  - `public.submit_arcade_score(p_score int, p_credits int, p_distance int, p_ship text DEFAULT NULL, p_guest_name text DEFAULT NULL) → TABLE(best int, player_rank int)`.
  - Error contract:
    - name held by another guest → SQLSTATE `23505`, message `guest_name_taken`;
    - anonymous caller with no name → message `guest_name_required` (SQLSTATE `P0001`);
    - account caller passing a guest name → message `guest_name_for_account` (`P0001`).
  - `public.get_arcade_leaderboard(p_limit int DEFAULT 20) → TABLE(player_rank int, username text, best_score int, is_me boolean, best_ship text, is_guest boolean)`.
  - `public.cleanup_arcade_guests() → integer` (rows deleted). Executable only by `postgres` and `service_role`.

- [ ] **Step 1: Write the migration**

```sql
-- Arcade guests: anyone can join the arcade leaderboard through Supabase anonymous sign-in.
--
-- A guest is an anonymous auth user. Guest-ness is read from the JWT claim (is_anonymous) and
-- from auth.users.is_anonymous; it is never stored. The insert_user trigger on auth.users still
-- gives a guest a public.users row (email and username NULL); submit_arcade_score also inserts
-- that row if it is missing, so the foreign keys below hold either way.
--
-- A guest's display name lives in arcade_guest_names, unique among guests (case-insensitive) and
-- separate from users.username, which stays reserved for accounts. The leaderboard shows
-- coalesce(username, guest name) and flags guest rows with is_guest.
--
-- Guests are shut out of user data: has_profile_access, the users self-update policy and the
-- alt-insert policy all reject an anonymous session.
--
-- Compatibility with the deployed client:
--   * submit_arcade_score gains p_guest_name text DEFAULT NULL. The 4-argument function is dropped
--     first so a call sending 3 or 4 argument names matches exactly one function (PGRST203
--     otherwise); see 20261019000001_arcade_scores_ship.sql.
--   * get_arcade_leaderboard returns one more column, is_guest; the deployed parser ignores
--     fields it does not know.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_anonymous_session()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

GRANT EXECUTE ON FUNCTION public.is_anonymous_session() TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guest names
-- ---------------------------------------------------------------------------------------------

CREATE TABLE public.arcade_guest_names (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT arcade_guest_names_name_format
    CHECK (name ~ '^[a-zA-Z0-9 _-]{3,20}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX arcade_guest_names_name_lower_idx ON public.arcade_guest_names (lower(name));

ALTER TABLE public.arcade_guest_names ENABLE ROW LEVEL SECURITY;

-- Writes go through submit_arcade_score only; there are no INSERT/UPDATE/DELETE policies.
CREATE POLICY "Guests can read own arcade name" ON public.arcade_guest_names
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Shut guests out of user data
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_profile_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NOT public.is_anonymous_session()
     AND EXISTS (
       SELECT 1 FROM public.users
       WHERE id = target_user_id
         AND (id = auth.uid() OR owner_auth_user_id = auth.uid())
     );
$$;

DROP POLICY IF EXISTS "Users can update own profile or owned alts" ON public.users;
CREATE POLICY "Users can update own profile or owned alts" ON public.users
  FOR UPDATE TO authenticated
  USING ((auth.uid() = id OR owner_auth_user_id = auth.uid()) AND NOT public.is_anonymous_session())
  WITH CHECK ((auth.uid() = id OR owner_auth_user_id = auth.uid()) AND NOT public.is_anonymous_session());

DROP POLICY IF EXISTS "Users can insert alt profiles they own" ON public.users;
CREATE POLICY "Users can insert alt profiles they own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_auth_user_id = auth.uid()
    AND id != auth.uid()
    AND is_admin = false
    AND NOT public.is_anonymous_session()
  );

-- ---------------------------------------------------------------------------------------------
-- Leaderboard RPCs
-- ---------------------------------------------------------------------------------------------

DROP FUNCTION public.submit_arcade_score(integer, integer, integer, text);

CREATE FUNCTION public.submit_arcade_score(
  p_score integer,
  p_credits integer,
  p_distance integer,
  p_ship text DEFAULT NULL,
  p_guest_name text DEFAULT NULL
)
RETURNS TABLE (best integer, player_rank integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  guest boolean := public.is_anonymous_session();
  guest_name text := nullif(btrim(p_guest_name), '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF guest THEN
    INSERT INTO public.users (id) VALUES (uid) ON CONFLICT (id) DO NOTHING;

    IF guest_name IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.arcade_guest_names
         WHERE lower(name) = lower(guest_name) AND user_id <> uid
      ) THEN
        RAISE EXCEPTION 'guest_name_taken' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.arcade_guest_names (user_id, name)
      VALUES (uid, guest_name)
      ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name;
    ELSIF NOT EXISTS (SELECT 1 FROM public.arcade_guest_names WHERE user_id = uid) THEN
      RAISE EXCEPTION 'guest_name_required';
    END IF;
  ELSIF guest_name IS NOT NULL THEN
    RAISE EXCEPTION 'guest_name_for_account';
  END IF;

  INSERT INTO public.arcade_scores AS a
    (user_id, best_score, best_credits, best_distance, best_ship, updated_at)
  VALUES (uid, p_score, p_credits, p_distance, NULLIF(p_ship, ''), now())
  ON CONFLICT (user_id) DO UPDATE
    SET best_score = EXCLUDED.best_score,
        best_credits = EXCLUDED.best_credits,
        best_distance = EXCLUDED.best_distance,
        best_ship = EXCLUDED.best_ship,
        updated_at = now()
    WHERE EXCLUDED.best_score > a.best_score;

  -- Rank uses the leaderboard's definition: players with a display name, ties share a rank.
  RETURN QUERY
  SELECT s.best_score,
         (SELECT count(*)::integer + 1
            FROM public.arcade_scores o
            JOIN public.users u ON u.id = o.user_id
            LEFT JOIN public.arcade_guest_names g ON g.user_id = o.user_id
           WHERE coalesce(u.username, g.name) IS NOT NULL AND o.best_score > s.best_score)
    FROM public.arcade_scores s
   WHERE s.user_id = uid;
END;
$$;

DROP FUNCTION public.get_arcade_leaderboard(integer);

CREATE FUNCTION public.get_arcade_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (
  player_rank integer,
  username text,
  best_score integer,
  is_me boolean,
  best_ship text,
  is_guest boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT coalesce(u.username, g.name) AS display_name,
           (u.username IS NULL AND g.user_id IS NOT NULL) AS guest,
           a.best_score,
           a.best_ship,
           a.user_id,
           rank() OVER (ORDER BY a.best_score DESC)::integer AS player_rank
      FROM public.arcade_scores a
      JOIN public.users u ON u.id = a.user_id
      LEFT JOIN public.arcade_guest_names g ON g.user_id = a.user_id
     WHERE coalesce(u.username, g.name) IS NOT NULL
  )
  SELECT r.player_rank, r.display_name, r.best_score,
         coalesce(r.user_id = auth.uid(), false), r.best_ship, r.guest
    FROM ranked r
   WHERE r.player_rank <= LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
      OR r.user_id = auth.uid()
   ORDER BY r.player_rank, r.display_name;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by default,
-- so both are revoked explicitly before the intended grants.
REVOKE ALL ON FUNCTION public.submit_arcade_score(integer, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_arcade_score(integer, integer, integer, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(integer) TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------------------------

-- Deletes anonymous auth users whose best score has not improved in 90 days, and those more than
-- a day old that never claimed a name. handle_auth_user_delete and the FK cascades remove their
-- users, name and score rows. Scheduled with pg_cron outside this migration.
CREATE OR REPLACE FUNCTION public.cleanup_arcade_guests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM auth.users au
   WHERE au.is_anonymous
     AND (
       EXISTS (SELECT 1 FROM public.arcade_scores s
                WHERE s.user_id = au.id AND s.updated_at < now() - interval '90 days')
       OR (au.created_at < now() - interval '1 day'
           AND NOT EXISTS (SELECT 1 FROM public.arcade_guest_names g WHERE g.user_id = au.id))
     );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_arcade_guests() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the verification SQL file for the PR body**

Create `docs/superpowers/plans/2026-10-19-arcade-guest-leaderboard.sql-checks.md` with:

````markdown
# Arcade guests: SQL checks

## Before applying: the replaced definitions must match the repo
```sql
select pg_get_functiondef('public.has_profile_access'::regproc);
select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy where polrelid = 'public.users'::regclass;
```
Expected: `has_profile_access` is the `20260424000003_alt_accounts_rls.sql` body. The policies
"Users can update own profile or owned alts" and "Users can insert alt profiles they own" match
that file.

## After applying: from the app, as a fresh guest (browser devtools)
- Submit without a name → error message `guest_name_required`.
- Submit with `p_guest_name: 'Tester'` → returns `best`, `player_rank`.
- A second guest submitting `p_guest_name: 'tester'` → code `23505`.
- As the guest: `supabase.from('users').update({ username: 'x' }).eq('id', uid)` → 0 rows.
- As the guest: `supabase.from('ships').insert({ user_id: uid, ... })` → RLS error.
- `get_arcade_leaderboard` → the guest row has `is_guest: true`.

## Schedule the cleanup (after enabling pg_cron in the dashboard)
```sql
select cron.schedule('cleanup-arcade-guests', '17 3 * * *', $$select public.cleanup_arcade_guests()$$);
```
````

- [ ] **Step 3: Self-check the SQL**

Re-read the migration against these items:
- every `DROP FUNCTION` names the exact signature currently live: `(integer, integer, integer, text)` and `(integer)`;
- the policy names match `20260424000003_alt_accounts_rls.sql`;
- `is_guest` is false for an account row even when a stale guest-name row exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261019000002_arcade_guests.sql
git add -f docs/superpowers/plans/2026-10-19-arcade-guest-leaderboard.sql-checks.md
git commit -m "feat(arcade): guest names and anonymous-session guards in the database"
```

---

### Task 2: Client auth guard (anonymous session ≠ `user`)

**Files:**
- Modify: `src/services/auth/types.ts`. Add `isAnonymous` to `AuthUser`, and `signInAnonymously` to `AuthService`.
- Modify: `src/services/auth/supabaseAuth.ts`
- Create: `src/services/auth/splitAuthUser.ts`
- Modify: `src/contexts/AuthProvider.tsx`
- Test: `src/services/auth/__tests__/splitAuthUser.test.ts`
- Test: `src/contexts/__tests__/AuthProvider.anonymous.test.tsx`

**Interfaces:**
- Produces:
  - `AuthUser.isAnonymous?: boolean`.
  - `splitAuthUser(u: AuthUser | null): { user: AuthUser | null; guestUserId: string | null }`.
  - `useAuth()` gains `guestUserId: string | null` and `signInAsGuest: () => Promise<string>`, which resolves to the guest uid.

- [ ] **Step 1: Write the failing pure test**

```ts
// src/services/auth/__tests__/splitAuthUser.test.ts
import { describe, it, expect } from 'vitest';
import { splitAuthUser } from '../splitAuthUser';

const base = { id: 'u1', email: null, displayName: null, photoURL: null };

describe('splitAuthUser', () => {
    it('keeps an account as the user', () => {
        expect(splitAuthUser({ ...base, email: 'a@b.c' })).toEqual({
            user: { ...base, email: 'a@b.c' },
            guestUserId: null,
        });
    });
    it('moves an anonymous session to guestUserId and leaves user null', () => {
        expect(splitAuthUser({ ...base, isAnonymous: true })).toEqual({
            user: null,
            guestUserId: 'u1',
        });
    });
    it('maps no session to neither', () => {
        expect(splitAuthUser(null)).toEqual({ user: null, guestUserId: null });
    });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/services/auth/__tests__/splitAuthUser.test.ts`
Expected: FAIL, because the module `../splitAuthUser` is not found.

- [ ] **Step 3: Implement the types, the converter and `splitAuthUser`**

In `types.ts`, add the following to `AuthUser`:

```ts
    /** An anonymous Supabase session (an arcade guest). Never exposed as `useAuth().user`. */
    isAnonymous?: boolean;
```

Add the following to `AuthService`:

```ts
    signInAnonymously: () => Promise<AuthUser>;
```

In `supabaseAuth.ts`, add `isAnonymous: user.is_anonymous === true,` to the `convertSupabaseUser` return, and add the method:

```ts
    async signInAnonymously(): Promise<AuthUser> {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        const user = this.convertSupabaseUser(data.user);
        if (!user) throw new Error('Anonymous sign-in returned no user');
        return user;
    }
```

Then create the new module:

```ts
// src/services/auth/splitAuthUser.ts
import type { AuthUser } from './types';

/**
 * An anonymous session is an arcade guest, not a signed-in user: it is reported as
 * `guestUserId` and `user` stays null, so sign-in migration, Supabase data loads, the account
 * menu and every other `user`-keyed path treat a guest as signed out.
 */
export function splitAuthUser(u: AuthUser | null): {
    user: AuthUser | null;
    guestUserId: string | null;
} {
    if (!u) return { user: null, guestUserId: null };
    if (u.isAnonymous) return { user: null, guestUserId: u.id };
    return { user: u, guestUserId: null };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Write the failing provider tripwire**

```tsx
// src/contexts/__tests__/AuthProvider.anonymous.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { AuthUser } from '../../services/auth/types';

let emit: (u: AuthUser | null) => void = () => {};
vi.mock('../../services/auth/supabaseAuth', () => ({
    SupabaseAuthService: class {
        onAuthStateChanged(cb: (u: AuthUser | null) => void) {
            emit = cb;
            return () => {};
        }
        signInAnonymously = vi.fn();
    },
}));
const usersSelect = vi.fn();
vi.mock('../../config/supabase', () => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: usersSelect }) }) }) },
}));
const heartbeat = vi.fn();
vi.mock('../../services/heartbeatService', () => ({ updateHeartbeatUser: (id: string | null) => heartbeat(id) }));
const migrate = vi.fn();
vi.mock('../../utils/migratePlayerData', () => ({
    migratePlayerData: (...a: unknown[]) => migrate(...a),
    syncMigratedDataToSupabase: vi.fn(),
}));
vi.mock('../../hooks/useNotification', () => ({ useNotification: () => ({ addNotification: vi.fn() }) }));
vi.mock('../../hooks/useStorage', () => ({ removeFromIndexedDB: vi.fn() }));

import { AuthProvider, useAuth } from '../AuthProvider';

const Probe = () => {
    const { user, guestUserId } = useAuth();
    return <div>{`user=${user?.id ?? 'none'} guest=${guestUserId ?? 'none'}`}</div>;
};

describe('AuthProvider with an anonymous session', () => {
    beforeEach(() => {
        localStorage.clear();
        heartbeat.mockClear();
        migrate.mockClear();
        usersSelect.mockReset();
    });

    it('exposes the guest uid, keeps user null, and runs no account side effects', async () => {
        localStorage.setItem('demoDataLoaded', 'true');
        const events: string[] = [];
        const record = (e: Event) => events.push(e.type);
        window.addEventListener('app:migration:start', record);
        window.addEventListener('app:signout', record);
        render(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );
        await act(async () => emit({ id: 'g1', email: null, displayName: null, photoURL: null, isAnonymous: true }));
        await waitFor(() => expect(screen.getByText('user=none guest=g1')).toBeTruthy());
        expect(usersSelect).not.toHaveBeenCalled();
        expect(migrate).not.toHaveBeenCalled();
        expect(heartbeat).not.toHaveBeenCalledWith('g1');
        expect(localStorage.getItem('demoDataLoaded')).toBe('true');
        expect(events).toEqual([]);

        // The guest session ending is not a sign-out of an account.
        await act(async () => emit(null));
        await waitFor(() => expect(screen.getByText('user=none guest=none')).toBeTruthy());
        expect(events).toEqual([]);
        window.removeEventListener('app:migration:start', record);
        window.removeEventListener('app:signout', record);
    });
});
```

Before running it, confirm the real key for `StorageKey.DEMO_DATA_LOADED` in `src/constants/storage.ts`. If it differs, replace `'demoDataLoaded'` in the test with that value, or import `StorageKey` and use `StorageKey.DEMO_DATA_LOADED`.

- [ ] **Step 6: Run the tripwire and confirm it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/contexts/__tests__/AuthProvider.anonymous.test.tsx`
Expected: FAIL. Today the provider shows `user=g1` and calls `usersSelect`.

- [ ] **Step 7: Wire the guard into `AuthProvider`**

1. In `AuthContextType`, add:

```ts
    /** The arcade guest's uid while an anonymous session is active; null otherwise. */
    guestUserId: string | null;
    /** Starts an anonymous session (an arcade guest) and resolves to its uid. */
    signInAsGuest: () => Promise<string>;
```

2. Add the state `const [guestUserId, setGuestUserId] = useState<string | null>(null);`.

3. Change the start of the `onAuthStateChanged` callback from `(user) => {` to `(sessionUser) => {`, and split the session user at the top of the async body:

```ts
        const unsubscribe = authService.onAuthStateChanged((sessionUser) => {
            void (async () => {
                const { user, guestUserId: guestId } = splitAuthUser(sessionUser);
                setGuestUserId(guestId);
                const previousUser = currentUser;
                // ...the rest of the body is unchanged and keeps using `user`
```

4. Add the method:

```ts
    const signInAsGuest = async () => {
        const guest = await authService.signInAnonymously();
        setGuestUserId(guest.id);
        return guest.id;
    };
```

5. Add `guestUserId` and `signInAsGuest` to the provider `value`.

6. Add the import `import { splitAuthUser } from '../services/auth/splitAuthUser';`.

- [ ] **Step 8: Run both tests, then the full suite, and confirm they pass**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/services/auth src/contexts/__tests__/AuthProvider.anonymous.test.tsx`
Expected: PASS.

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit`
Expected: no errors. Any test mock of `useAuth` that is typed against `AuthContextType` may need `guestUserId: null`. Fix each one the compiler names.

- [ ] **Step 9: Commit**

```bash
git add src/services/auth src/contexts/AuthProvider.tsx src/contexts/__tests__/AuthProvider.anonymous.test.tsx
git commit -m "feat(auth): treat an anonymous session as an arcade guest, not a signed-in user"
```

---

### Task 3: Arcade service and row parser — guest fields and errors

**Files:**
- Modify: `src/utils/arcade/leaderboardRows.ts`
- Modify: `src/services/arcadeService.ts`
- Test: `src/utils/arcade/__tests__/leaderboardRows.test.ts` (extend)
- Test: `src/services/__tests__/arcadeService.guest.test.ts` (new)

**Interfaces:**
- Produces:
  - `ArcadeLeaderboardEntry.isGuest: boolean`.
  - `GUEST_NAME_PATTERN` and `isValidGuestName(v: string): boolean`, both exported from `leaderboardRows.ts`.
  - `class GuestNameTakenError extends Error`.
  - `class GuestNameRequiredError extends Error`.
  - `submitArcadeScore(run, shipName?, guestName?: string | null)`. It throws `GuestNameTakenError` and `GuestNameRequiredError`.
  - `getOwnGuestName(userId: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `leaderboardRows.test.ts`:

```ts
describe('parseLeaderboardRows is_guest', () => {
    const row = { player_rank: 1, username: 'Ace', best_score: 10, is_me: false, best_ship: null };
    it('reads is_guest', () => {
        expect(parseLeaderboardRows([{ ...row, is_guest: true }])[0].isGuest).toBe(true);
    });
    it('treats a missing or non-boolean is_guest as an account', () => {
        expect(parseLeaderboardRows([row])[0].isGuest).toBe(false);
        expect(parseLeaderboardRows([{ ...row, is_guest: 'yes' }])[0].isGuest).toBe(false);
    });
});

describe('isValidGuestName', () => {
    it('accepts the username alphabet at 3-20 characters', () => {
        expect(isValidGuestName('Ace Pilot_1')).toBe(true);
        expect(isValidGuestName('ab')).toBe(false);
        expect(isValidGuestName('a'.repeat(21))).toBe(false);
        expect(isValidGuestName('bad!')).toBe(false);
    });
});
```

Add `isValidGuestName` to that file's import. Then create the service test:

```ts
// src/services/__tests__/arcadeService.guest.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../../config/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { submitArcadeScore, GuestNameTakenError, GuestNameRequiredError } from '../arcadeService';

const run = { score: 100, credits: 5, distance: 50 } as never;

describe('submitArcadeScore guest name', () => {
    beforeEach(() => rpc.mockReset());

    it('sends p_guest_name when given', async () => {
        rpc.mockResolvedValue({ data: [{ best: 100, player_rank: 3 }], error: null });
        await submitArcadeScore(run, null, 'Ace');
        expect(rpc).toHaveBeenCalledWith('submit_arcade_score', {
            p_score: 100,
            p_credits: 5,
            p_distance: 50,
            p_guest_name: 'Ace',
        });
    });

    it('maps 23505 to GuestNameTakenError', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'guest_name_taken' } });
        await expect(submitArcadeScore(run, null, 'Ace')).rejects.toBeInstanceOf(GuestNameTakenError);
    });

    it('maps guest_name_required to GuestNameRequiredError', async () => {
        rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'guest_name_required' } });
        await expect(submitArcadeScore(run)).rejects.toBeInstanceOf(GuestNameRequiredError);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/utils/arcade/__tests__/leaderboardRows.test.ts src/services/__tests__/arcadeService.guest.test.ts`
Expected: FAIL, because `isGuest`, `isValidGuestName` and the errors are undefined.

- [ ] **Step 3: Implement**

In `leaderboardRows.ts`:
- add `isGuest: boolean;` to `ArcadeLeaderboardEntry`, with the doc `/** A guest (anonymous) player; shown with a GUEST tag. */`;
- destructure `is_guest` in `parseLeaderboardRows` and emit `isGuest: is_guest === true`;
- add:

```ts
/** Mirrors the `arcade_guest_names.name` CHECK constraint. */
export const GUEST_NAME_PATTERN = /^[a-zA-Z0-9 _-]{3,20}$/;
export const isValidGuestName = (v: string): boolean => GUEST_NAME_PATTERN.test(v);
```

In `arcadeService.ts`, add:

```ts
/** Another guest already holds the name (case-insensitive). Nothing was saved. */
export class GuestNameTakenError extends Error {}
/** The guest has no name yet; the score needs one before it can be saved. */
export class GuestNameRequiredError extends Error {}
```

Then change `submitArcadeScore`:

```ts
export async function submitArcadeScore(
    run: RunResult,
    shipName?: string | null,
    guestName?: string | null
): Promise<ArcadeSubmitResult | null> {
    const base = {
        p_score: run.score,
        p_credits: run.credits,
        p_distance: run.distance,
        ...(guestName ? { p_guest_name: guestName } : {}),
    };
    const withShip = isValidShipName(shipName);
    let { data, error } = await supabase.rpc(
        'submit_arcade_score',
        withShip ? { ...base, p_ship: shipName } : base
    );
    // PGRST202: no function matches the sent argument names, i.e. the database has not
    // gained `p_ship` yet. The score still saves, without its ship.
    if (error?.code === 'PGRST202' && withShip) {
        ({ data, error } = await supabase.rpc('submit_arcade_score', base));
    }
    if (error?.code === '23505') throw new GuestNameTakenError(error.message);
    if (error?.message === 'guest_name_required') throw new GuestNameRequiredError(error.message);
    if (error) throw error;
    return parseSubmitResult(data);
}

/** The signed-in guest's own name, read through the own-row SELECT policy; null if unset. */
export async function getOwnGuestName(userId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('arcade_guest_names')
        .select('name')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return typeof data?.name === 'string' ? data.name : null;
}
```

Update the doc comment on `submitArcadeScore` so it also says: "`guestName` claims or renames the anonymous caller's guest name in the same call."

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 2 command, plus `src/components/arcade/__tests__/ArcadeLeaderboard.test.tsx`. Expected: PASS. If an existing fixture is typed `ArcadeLeaderboardEntry` and fails `tsc`, add `isGuest: false` to it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/arcade src/services/arcadeService.ts src/services/__tests__/arcadeService.guest.test.ts
git commit -m "feat(arcade): guest name field, errors and lookup in the arcade service"
```

---

### Task 4: Submission flow for guests (hook, modal, game-over line)

**Files:**
- Modify: `src/components/arcade/useArcadeSubmission.ts`
- Create: `src/components/arcade/GuestNameModal.tsx`
- Modify: `src/components/arcade/FlightGame.tsx`. This covers `SubmissionLine` (~line 114), `escapeBlockedRef` (~248) and the modal render (~994).
- Test: `src/components/arcade/__tests__/useArcadeSubmission.guest.test.tsx`

**Interfaces:**
- Consumes:
  - `useAuth().guestUserId` and `useAuth().signInAsGuest` (Task 2);
  - `submitArcadeScore(run, ship, guestName)`, `getOwnGuestName`, `GuestNameTakenError`, `GuestNameRequiredError` and `isValidGuestName` (Task 3).
- Produces:
  - `SubmissionStatus` replaces `'signed-out'` with `'guest-invite'` and adds `'needs-guest-name'`.
  - The hook returns `joinAsGuest(): void` and `saveGuestName(name: string): Promise<'saved' | 'taken'>`. `saveGuestName` throws on any other failure.

- [ ] **Step 1: Write the failing hook tests**

```tsx
// src/components/arcade/__tests__/useArcadeSubmission.guest.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const auth = { user: null as null | { id: string }, guestUserId: null as string | null, signInAsGuest: vi.fn() };
vi.mock('../../../contexts/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../../services/userProfileService', () => ({ getUserProfile: vi.fn() }));
const submit = vi.fn();
const ownName = vi.fn();
vi.mock('../../../services/arcadeService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/arcadeService')>(
        '../../../services/arcadeService'
    );
    return {
        ...actual,
        submitArcadeScore: (...a: unknown[]) => submit(...a),
        getOwnGuestName: (...a: unknown[]) => ownName(...a),
    };
});

import { useArcadeSubmission } from '../useArcadeSubmission';
import { GuestNameTakenError } from '../../../services/arcadeService';

const finished = { result: { score: 10, credits: 1, distance: 5 } as never, shipName: 'Atlas' };

describe('useArcadeSubmission (guests)', () => {
    beforeEach(() => {
        auth.user = null;
        auth.guestUserId = null;
        auth.signInAsGuest.mockReset();
        submit.mockReset();
        ownName.mockReset();
    });

    it('invites a visitor with no session, and only signs in when a name is saved', async () => {
        const { result } = renderHook(() => useArcadeSubmission(finished));
        expect(result.current.status).toBe('guest-invite');
        act(() => result.current.joinAsGuest());
        expect(result.current.status).toBe('needs-guest-name');
        expect(auth.signInAsGuest).not.toHaveBeenCalled();

        auth.signInAsGuest.mockResolvedValue('g1');
        submit.mockResolvedValue({ bestScore: 10, rank: 4 });
        let outcome: string | undefined;
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace');
        });
        expect(outcome).toBe('saved');
        expect(auth.signInAsGuest).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(finished.result, 'Atlas', 'Ace');
        expect(result.current.status).toBe('submitted');
        expect(result.current.rank).toBe(4);
    });

    it('keeps the same guest session when the name is taken', async () => {
        const { result } = renderHook(() => useArcadeSubmission(finished));
        act(() => result.current.joinAsGuest());
        auth.signInAsGuest.mockImplementation(async () => {
            auth.guestUserId = 'g1';
            return 'g1';
        });
        submit.mockRejectedValueOnce(new GuestNameTakenError('guest_name_taken'));
        let outcome: string | undefined;
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace');
        });
        expect(outcome).toBe('taken');
        expect(result.current.status).toBe('needs-guest-name');

        submit.mockResolvedValue({ bestScore: 10, rank: 1 });
        await act(async () => {
            outcome = await result.current.saveGuestName('Ace2');
        });
        expect(outcome).toBe('saved');
        expect(auth.signInAsGuest).toHaveBeenCalledTimes(1);
    });

    it('auto-submits a returning guest who has a name', async () => {
        auth.guestUserId = 'g1';
        ownName.mockResolvedValue('Ace');
        submit.mockResolvedValue({ bestScore: 10, rank: 2 });
        const { result } = renderHook(() => useArcadeSubmission(finished));
        await waitFor(() => expect(result.current.status).toBe('submitted'));
        expect(submit).toHaveBeenCalledWith(finished.result, 'Atlas');
    });

    it('asks a guest session with no name for one', async () => {
        auth.guestUserId = 'g1';
        ownName.mockResolvedValue(null);
        const { result } = renderHook(() => useArcadeSubmission(finished));
        await waitFor(() => expect(result.current.status).toBe('needs-guest-name'));
        expect(submit).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade/__tests__/useArcadeSubmission.guest.test.tsx`
Expected: FAIL, because the status is `'signed-out'` and `joinAsGuest` is undefined.

- [ ] **Step 3: Implement the hook changes**

In `useArcadeSubmission.ts`:

1. Change the status type:

```ts
export type SubmissionStatus =
    | 'guest-invite'
    | 'needs-guest-name'
    | 'checking'
    | 'needs-username'
    | 'submitting'
    | 'submitted'
    | 'skipped'
    | 'error';
```

2. Read the guest identity:

```ts
    const { user, guestUserId, signInAsGuest } = useAuth();
    const userId = user?.id ?? null;
    const identity = userId ?? guestUserId;
```

Replace every `userId ? 'checking' : 'signed-out'` with `identity ? 'checking' : 'guest-invite'`.

3. Add `const signedInGuestRef = useRef<string | null>(null);`, which holds the uid `signInAsGuest` returned. Also add `const joiningRef = useRef(false);`. It is true while `saveGuestName` is signing in and submitting, so the identity change that sign-in causes does not start a second check or submit.

4. Change `submit` to take an optional guest name and to report the outcome. Have it return `Promise<'saved' | 'taken' | 'failed'>`:

```ts
    const submit = useCallback(
        async (guestName?: string): Promise<'saved' | 'taken' | 'failed'> => {
            if (!finished) return 'failed';
            const { result } = finished;
            if (liveResultRef.current === result) setStatus('submitting');
            try {
                const saved = guestName
                    ? await submitArcadeScore(result, finished.shipName, guestName)
                    : await submitArcadeScore(result, finished.shipName);
                if (liveResultRef.current !== result) return 'saved';
                setRank(saved?.rank ?? null);
                setStatus('submitted');
                setLeaderboardVersion((v) => v + 1);
                return 'saved';
            } catch (error) {
                if (error instanceof GuestNameTakenError) {
                    if (liveResultRef.current === result) setStatus('needs-guest-name');
                    return 'taken';
                }
                if (error instanceof GuestNameRequiredError) {
                    if (liveResultRef.current === result) setStatus('needs-guest-name');
                    return 'failed';
                }
                console.error('Error submitting arcade score:', error);
                if (liveResultRef.current === result) {
                    errorSourceRef.current = 'submit';
                    setStatus('error');
                }
                return 'failed';
            }
        },
        [finished]
    );
```

5. In the check effect:
   - Branch on account versus guest: an account keeps the existing `getUserProfile` path, and a guest uses `getOwnGuestName`.
   - Return early while `joiningRef.current` is true.
   - Use `[result, userId, guestUserId, submit, profileAttempt]` as the deps.

```ts
    useEffect(() => {
        setRank(null);
        if (!result) {
            setStatus(identity ? 'checking' : 'guest-invite');
            return;
        }
        if (!identity) {
            setStatus('guest-invite');
            return;
        }
        if (joiningRef.current) return;
        let cancelled = false;
        setStatus('checking');
        const check = userId
            ? getUserProfile(userId).then((p) => (p?.username ? 'ready' : 'needs-username'))
            : getOwnGuestName(guestUserId!).then((n) => (n ? 'ready' : 'needs-guest-name'));
        check
            .then((next) => {
                if (next === 'ready') {
                    void submit();
                    return;
                }
                if (!cancelled) setStatus(next);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Error loading the arcade identity:', error);
                errorSourceRef.current = 'profile';
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [result, userId, guestUserId, identity, submit, profileAttempt]);
```

6. Add the guest actions:

```ts
    /** Opens the guest-name prompt; no anonymous session is created until a name is saved. */
    const joinAsGuest = useCallback(() => setStatus('needs-guest-name'), []);

    /** Signs in as a guest if needed, then claims `name` and saves the run in one call. A taken
     *  name leaves the session in place, so a retry reuses it. */
    const saveGuestName = useCallback(
        async (name: string): Promise<'saved' | 'taken'> => {
            joiningRef.current = true;
            try {
                // The ref covers a retry that runs before the new guestUserId has re-rendered.
                if (!guestUserId && !signedInGuestRef.current) {
                    signedInGuestRef.current = await signInAsGuest();
                }
                const outcome = await submit(name);
                if (outcome === 'failed') throw new Error('Could not save the score');
                return outcome;
            } finally {
                joiningRef.current = false;
            }
        },
        [guestUserId, signInAsGuest, submit]
    );
```

7. Make the existing `retry` and `onUsernameSaved` call `void submit()`; their behaviour is unchanged. Return `{ status, rank, leaderboardVersion, retry, onUsernameSaved, skip, joinAsGuest, saveGuestName }`.

8. Update the hook's doc comment: "Submits every finished run for an account or a named guest. A visitor with no session is invited to join as a guest; an account without a username, or a guest without a name, is asked for one first. ..." Keep the rest of the existing text.

Imports: `getOwnGuestName`, `GuestNameTakenError` and `GuestNameRequiredError` from `../../services/arcadeService`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Create `GuestNameModal`**

```tsx
// src/components/arcade/GuestNameModal.tsx
import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { isValidGuestName } from '../../utils/arcade/leaderboardRows';

interface Props {
    isOpen: boolean;
    onSave: (name: string) => Promise<'saved' | 'taken'>;
    onCancel: () => void;
}

/** Guest names are their own namespace: unique among guests, shown with a GUEST tag. */
export const GuestNameModal: React.FC<Props> = ({ isOpen, onSave, onCancel }) => {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setValue('');
        setError(null);
    }, [isOpen]);

    const save = async () => {
        if (saving) return;
        const name = value.trim();
        if (!isValidGuestName(name)) {
            setError('3-20 characters: letters, numbers, spaces, dashes and underscores');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            if ((await onSave(name)) === 'taken') setError('Another guest already uses that name');
        } catch (e) {
            console.error('Error joining the arcade leaderboard as a guest:', e);
            setError('Could not save your score, please try again');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onCancel} title="Join as a guest" maxWidth="max-w-md">
            <div className="space-y-4">
                <p className="text-theme-text">
                    Pick a name for the leaderboard. Guest scores show a GUEST tag and stay on
                    this device. Sign in instead to use your account name.
                </p>
                <Input
                    label="Guest name"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void save();
                    }}
                    error={error ?? undefined}
                    maxLength={20}
                    autoFocus
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onCancel}>
                        Skip
                    </Button>
                    <Button onClick={() => void save()} disabled={saving}>
                        Join
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
```

- [ ] **Step 6: Wire `FlightGame`**

1. `SubmissionLine` gains an `onJoinGuest: () => void` prop. Replace the `'signed-out'` case with:

```tsx
        case 'guest-invite':
            return (
                <div className="space-y-2">
                    <Button size="sm" onClick={onJoinGuest}>
                        Join the leaderboard as a guest
                    </Button>
                    <p className="text-xs text-theme-text-secondary">
                        or sign in to use your account name.
                    </p>
                </div>
            );
```

Treat `'needs-guest-name'` like `'needs-username'`: it falls to `default` and renders `null`.

2. Change `escapeBlockedRef.current = phase === 'over' && submission.status === 'needs-username';` to:

```ts
        escapeBlockedRef.current =
            phase === 'over' &&
            (submission.status === 'needs-username' || submission.status === 'needs-guest-name');
```

3. Pass `onJoinGuest={submission.joinAsGuest}` to `<SubmissionLine>`.

4. After the `{user && (<ArcadeUsernameModal ... />)}` block, render:

```tsx
            {!user && (
                <GuestNameModal
                    isOpen={phase === 'over' && submission.status === 'needs-guest-name'}
                    onSave={submission.saveGuestName}
                    onCancel={submission.skip}
                />
            )}
```

5. Add the import for `GuestNameModal`.

- [ ] **Step 7: Run the type check and the arcade tests**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade`
Expected: no type errors, and all tests pass. Then `grep -rn "'signed-out'" src`. Expected: no matches.

- [ ] **Step 8: Commit**

```bash
git add src/components/arcade
git commit -m "feat(arcade): join the leaderboard as a guest with a typed name"
```

---

### Task 5: Leaderboard GUEST tag and guest-aware refetch

**Files:**
- Modify: `src/components/arcade/ArcadeLeaderboard.tsx`
- Test: `src/components/arcade/__tests__/ArcadeLeaderboard.test.tsx` (extend)

**Interfaces:**
- Consumes:
  - `ArcadeLeaderboardEntry.isGuest` (Task 3);
  - `useAuth().guestUserId` (Task 2).

- [ ] **Step 1: Write the failing test**

The existing mock at line 19 is `useAuth: () => ({ user: null })`. Change it to `({ user: null, guestUserId: null })`. Then add a test that follows the file's existing pattern for mocking `getArcadeLeaderboard`. Read the top of the file first, and reuse its mock variable name. It should resolve the following rows:

```ts
[
    { rank: 1, username: 'Ace', bestScore: 900, isMe: false, ship: null, isGuest: false },
    { rank: 2, username: 'Ace', bestScore: 800, isMe: false, ship: null, isGuest: true },
    { rank: 3, username: 'Bo', bestScore: 700, isMe: false, ship: null, isGuest: false },
    { rank: 4, username: 'Cy', bestScore: 600, isMe: false, ship: null, isGuest: true },
]
```

It should assert:
- `await screen.findAllByText('GUEST')` has length 2. One is on the podium (rank 2), and one is in the table (rank 4).
- No React duplicate-key warning: spy on `console.error` and expect it not to have been called with a message containing `same key`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade/__tests__/ArcadeLeaderboard.test.tsx`
Expected: FAIL, because no GUEST text is rendered.

- [ ] **Step 3: Implement**

- Add a tag component next to `YouChip`:

```tsx
/** Marks a guest (anonymous) player's row; guest names are a separate namespace from usernames. */
const GuestTag: React.FC = () => (
    <span className="text-[10px] font-semibold tracking-wider text-theme-text-secondary">GUEST</span>
);
```

- On the podium card, render the badge as `badge={entry.isMe || entry.isGuest ? <>{entry.isGuest && <GuestTag />}{entry.isMe && <YouChip />}</> : undefined}`. Check the podium component's `badge` prop type accepts a fragment; it is `React.ReactNode` if it mirrors `YouChip` usage.
- In the table username cell, add `{r.isGuest && <GuestTag />}` before `{r.isMe && <YouChip />}`.
- Change the podium key and `getRowKey` to include guest-ness: `` `${entry.rank}-${entry.isGuest ? 'g' : 'u'}-${entry.username}` ``. Apply the same to `r` in `getRowKey`.
- Get the guest id with `const { user, guestUserId } = useAuth();`. Change the effect deps from `user?.id` to `user?.id ?? guestUserId`, so `is_me` refreshes after a guest joins.

- [ ] **Step 4: Run the test and confirm it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/arcade/ArcadeLeaderboard.tsx src/components/arcade/__tests__/ArcadeLeaderboard.test.tsx
git commit -m "feat(arcade): tag guest players on the leaderboard"
```

---

### Task 6: Fleetless pilots fly and duel bare templates

**Files:**
- Create: `src/components/arcade/ships/arcadeFleet.ts`
- Modify: `src/components/arcade/duel/pickOpponents.ts`
- Modify: `src/components/arcade/FlightGame.tsx`. The affected call sites are near lines 163–190, 349, 410, 443, 647, 700 and 944. Find them by `grep -n "canDuel\|pickOpponents\|isDuelCandidate\|useShips()\|ships={ships}" src/components/arcade/FlightGame.tsx`.
- Test: `src/components/arcade/ships/__tests__/arcadeFleet.test.ts`
- Test: `src/components/arcade/duel/__tests__/pickOpponents.test.ts` (update)

**Interfaces:**
- Consumes: `useShipsData()` (`src/hooks/useShipsData.ts`), which returns `{ ships: Ship[] }` of bare templates. `transformShipTemplate` already yields no equipment, refits or implants, so no conversion function is needed.
- Produces:
  - `arcadeFleet(owned: Ship[], ownedLoading: boolean, templates: Ship[]): { fleet: Ship[]; bare: boolean }`.
  - `type DuelCandidateTest = (ship: Ship) => boolean`.
  - `gearedCandidate(getGearPiece: GearLookup): DuelCandidateTest`.
  - `anyCandidate: DuelCandidateTest`.
  - `pickOpponents(fleet, flownId, random, isCandidate: DuelCandidateTest)`.
  - `canDuel(fleet, flownId, isCandidate: DuelCandidateTest)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/arcade/ships/__tests__/arcadeFleet.test.ts
import { describe, it, expect } from 'vitest';
import { arcadeFleet } from '../arcadeFleet';
import type { Ship } from '../../../../types/ship';

const s = (id: string) => ({ id, name: id }) as Ship;

describe('arcadeFleet', () => {
    it('flies the owned fleet when there is one', () => {
        expect(arcadeFleet([s('a')], false, [s('t')])).toEqual({ fleet: [s('a')], bare: false });
    });
    it('falls back to bare templates when the fleet is empty', () => {
        expect(arcadeFleet([], false, [s('t1'), s('t2')])).toEqual({
            fleet: [s('t1'), s('t2')],
            bare: true,
        });
    });
    it('does not fall back while the owned fleet is still loading', () => {
        expect(arcadeFleet([], true, [s('t')])).toEqual({ fleet: [], bare: false });
    });
});
```

In `pickOpponents.test.ts`:
- replace every `getGearPiece` passed to `pickOpponents`/`canDuel` with `gearedCandidate(getGearPiece)`;
- add `gearedCandidate` and `anyCandidate` to the import;
- append:

```ts
describe('anyCandidate (bare templates)', () => {
    const bare = ['a', 'b', 'c'].map((id) => ship(id, []));
    it('lets gearless ships duel', () => {
        expect(canDuel(bare, 'a', anyCandidate)).toBe(true);
        const pick = pickOpponents(bare, 'a', seq(0, 0), anyCandidate)!;
        expect(pick.map((p) => p.id).sort()).toEqual(['b', 'c']);
    });
    it('still needs two ships besides the flown one', () => {
        expect(canDuel(bare.slice(0, 2), 'a', anyCandidate)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade/ships/__tests__/arcadeFleet.test.ts src/components/arcade/duel/__tests__/pickOpponents.test.ts`
Expected: FAIL, because the modules and exports are missing.

- [ ] **Step 3: Implement `arcadeFleet` and the predicate refactor**

```ts
// src/components/arcade/ships/arcadeFleet.ts
import type { Ship } from '../../../types/ship';

/**
 * The ships the arcade offers: the player's fleet, or, for a player with no fleet (signed in or
 * not), every ship template flown bare (no gear, implants, refits or engineering). While the
 * owned fleet is still loading the arcade waits on it rather than flashing the templates.
 */
export function arcadeFleet(
    owned: Ship[],
    ownedLoading: boolean,
    templates: Ship[]
): { fleet: Ship[]; bare: boolean } {
    if (owned.length > 0 || ownedLoading) return { fleet: owned, bare: false };
    return { fleet: templates, bare: true };
}
```

In `pickOpponents.ts`:
- keep `GearLookup` and `isDuelCandidate`;
- add:

```ts
/** Decides whether a ship may be a duel opponent. */
export type DuelCandidateTest = (ship: Ship) => boolean;

/** Fleet ships duel only when geared (see `isDuelCandidate`). */
export const gearedCandidate =
    (getGearPiece: GearLookup): DuelCandidateTest =>
    (ship) =>
        isDuelCandidate(ship, getGearPiece);

/** Bare templates carry no gear, so every one may duel. */
export const anyCandidate: DuelCandidateTest = () => true;
```

- change the internal `candidates`, `pickOpponents` and `canDuel` to take `isCandidate: DuelCandidateTest` in place of `getGearPiece: GearLookup`, filtering with `isCandidate(s)`;
- update the doc comments:
  - `pickOpponents`: "Two distinct ships passing `isCandidate`, other than the flown ship, uniformly at random; `null` when the fleet cannot field two."
  - `canDuel`: "Whether a run with `flownId` gets duel checkpoints: the fleet fields two candidates besides it."

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Wire `FlightGame`**

1. Replace `const { ships } = useShips();` with:

```ts
    const { ships: ownedShips, loading: ownedLoading } = useShips();
    const { ships: templateShips } = useShipsData();
    const { fleet: ships, bare } = useMemo(
        () => arcadeFleet(ownedShips, ownedLoading, templateShips),
        [ownedShips, ownedLoading, templateShips]
    );
```

Keep the name `ships` so the rest of the component reads the arcade fleet unchanged. Import `useShipsData` from `../../hooks/useShipsData` and `arcadeFleet` from `./ships/arcadeFleet`. `useMemo` may already be imported; check.

2. Bare ships fly without engineering, so set up the stats deps and the candidate test:

```ts
    const noEngineering = useCallback(() => undefined, []);
    const isCandidate = useMemo(
        () => (bare ? anyCandidate : gearedCandidate(getGearPiece)),
        [bare, getGearPiece]
    );
    const statsDepsRef = useRef({
        getGearPiece,
        getEngineeringStatsForShipType: bare ? noEngineering : getEngineeringStatsForShipType,
        isCandidate,
    });
    statsDepsRef.current = {
        getGearPiece,
        getEngineeringStatsForShipType: bare ? noEngineering : getEngineeringStatsForShipType,
        isCandidate,
    };
```

Check how `statsDepsRef.current` is passed to `runDuel`. If it is spread or passed whole as `CombatStatsDeps`, the extra `isCandidate` field is harmless. If the type is checked strictly, pass `{ getGearPiece, getEngineeringStatsForShipType }` explicitly at that call.

3. Replace each gear-lookup argument:
   - `canDuel(ships, flown?.id ?? null, getGearPiece)` in the `initial` state → `canDuel(ships, flown?.id ?? null, isCandidate)`;
   - `pickOpponents(shipsRef.current, flown.id, Math.random, statsDepsRef.current.getGearPiece)`, at both sites → `... statsDepsRef.current.isCandidate)`;
   - `canDuel(ships, flown.id, getGearPiece)` in the intro effect → `canDuel(ships, flown.id, isCandidate)`. Change that effect's deps to `[ships, isCandidate]`;
   - `canDuel(shipsRef.current, flown.id, statsDepsRef.current.getGearPiece)` in `restart` → `... statsDepsRef.current.isCandidate)`;
   - `isDuelCandidate(s, statsDepsRef.current.getGearPiece)` in `takePrepared` → `statsDepsRef.current.isCandidate(s)`. Drop the now-unused `isDuelCandidate` import if nothing else uses it.

4. The initial phase stays `startOrigin ? 'intro' : ships.length > 0 ? 'select' : 'running'`. A fleetless player with cached templates therefore opens on the select screen. If templates are not cached yet at mount, the run starts with the neon fighter, exactly as a fleetless player does today. Add no loading gate.

5. `FighterSelect` already has search and a faction filter, so it needs no change. It shows `Level ?` for a template, which has no level. Pass the level as-is.

- [ ] **Step 6: Run the type check and the arcade tests**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run src/components/arcade`
Expected: no errors, and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/arcade
git commit -m "feat(arcade): pilots without a fleet fly and duel bare ship templates"
```

---

### Task 7: Admin user count, docs and changelog

**Files:**
- Modify: `src/services/adminService.ts:93-110` (`getTotalUserCount`)
- Modify: `src/pages/DocumentationPage.tsx` (the `<section id="arcade">` near line 2521)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Exclude guests from the admin total**

A guest's `users` row has neither an email nor an owner. Main accounts sign in with Google or email+password, so they always have an email, and alts have `owner_auth_user_id`. Change the query to:

```ts
        // Arcade guests (anonymous sessions) have a users row with neither an email nor an owner.
        const { count, error } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .or('email.not.is.null,owner_auth_user_id.not.is.null');
```

Then check that nothing else counts users: run `grep -rn "from('users')" src/services src/components/admin`. Report any other count you find in the task report, but do not change server-only admin RPCs; their bodies are not in the repo.

- [ ] **Step 2: Update the docs**

In the arcade section of `DocumentationPage.tsx`, add a paragraph in the section's existing style. Read the neighbouring `<p>` elements first and match their classes:

> Anyone can join the leaderboard. Without an account, choose Join as a guest after a run and pick a name; guest scores carry a GUEST tag and stay tied to that browser. Pilots without a fleet can fly any ship, without gear, and duel other bare ships.

- [ ] **Step 3: Update the changelog**

Append to `UNRELEASED_CHANGES`:

```ts
    'Arcade: guests can now join the leaderboard without an account.',
    'Arcade: pilots without a fleet can now fly any ship.',
```

- [ ] **Step 4: Run the full verification**

Run: `PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx tsc --noEmit && PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npm run lint && PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" npx vitest run`
Expected: no type errors, no lint errors, and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/adminService.ts src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "feat(arcade): document guest play and keep guests out of the admin user count"
```

---

### Task 8: Manual verification (orchestrator, not a subagent)

The migration must be applied first, by the owner.

- [ ] In a private window, run `npm start` on :3000 and open `/arcade`. Without signing in, play a run. Click **Join the leaderboard as a guest**, type a name, and Join. Expect a rank, and the row shows GUEST and YOU.
- [ ] Reload and play again. The score auto-submits with no prompt.
- [ ] The sidebar still shows **Sign in**, not the account menu, and the fleet and demo data are untouched.
- [ ] Sign in with Google. The guest row stays on the board, and the account flow (migration, profile) is unchanged.
- [ ] As a user with no ships, the select screen lists every ship. Launch one and pass a checkpoint; a duel runs against bare templates.
- [ ] Use a second private window and the same guest name, and confirm the "Another guest already uses that name" error.
