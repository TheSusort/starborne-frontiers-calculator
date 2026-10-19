# Arcade guest leaderboard — design

**Date:** 2026-10-19 · **Branch:** `feat/arcade-leaderboard-ship` (ships in draft PR #705)

## Goal

Anyone can play the arcade and join the global leaderboard, account or not. There is ONE
board: account holders and guests are ranked together; a guest row carries a GUEST tag. A
player without a fleet flies any ship as a bare template and duels bare templates.

## Owner decisions

- One common board; the Supabase shape is the implementer's choice.
- Any signed-out player can join as a guest. They fly their local fleet if they have one.
- Guest names live in their OWN namespace (unique among guests only) and always show a GUEST
  tag. `users.username` stays reserved for accounts.
- A guest who later signs in starts a normal account; the guest entry is NOT carried over or
  linked. It stays on the board until cleanup removes it.
- Fleetless pilots (signed in or not) fly a **bare template**: `ship_templates` base stats, no
  gear, implants, refits or engineering. Duel opponents are bare templates too.
- Cleanup by pg_cron; no CAPTCHA. Supabase's anonymous sign-in rate limit is the only abuse guard.
- Anonymous sign-in is enabled in the Supabase dashboard (owner, 2026-10-19).

## Why the central guard is needed

An anonymous Supabase user has the `authenticated` Postgres role and a normal session; only
the `is_anonymous` JWT claim / `auth.users.is_anonymous` tells it apart, and nothing in the
app checks it today. Unguarded, a guest session would: run the new-user migration and upload
local data under the guest uid; wipe demo data; load an empty fleet from Supabase; show the
account menu and hide Sign in; count in the heartbeat as an authenticated user; and pass every
`TO authenticated` RLS policy (ships, inventory, alts, `users` self-update).

## Architecture

### 1. Client auth guard

- `AuthUser` gains `isAnonymous` (from `user.is_anonymous` in `convertSupabaseUser`).
- `AuthProvider` sets `user = null` for an anonymous session and exposes the guest uid
  separately as `guestUserId` (null otherwise). Everything keyed on `user` — migration, demo
  wipe, Supabase data loads, signout wipes, heartbeat, `LoginButton`, `ProfilePage`,
  `ImportButton`, voting, OAuth consent — then treats a guest as signed out, unchanged.
- `previousUser` never becomes a guest, so a guest session ending never fires `app:signout`.
- `signInAsGuest()` on the auth context calls `supabase.auth.signInAnonymously()`.
- Only arcade code reads `guestUserId`.
- Signing in with Google or email while a guest session exists replaces the session. The guest
  uid is abandoned (accepted: see Owner decisions).

### 2. Database (one migration on top of `20261019000001`)

Guest-ness is READ from `auth.users.is_anonymous` / the JWT claim, never stored. The
`insert_user` trigger on `auth.users` is NOT touched: its live body is not in the repo. A guest
therefore gets a `public.users` row with `email` and `username` NULL, like any new account.

Helper: `public.is_anonymous_session()` → `coalesce((auth.jwt()->>'is_anonymous')::boolean, false)`.

- **`arcade_guest_names`** — `user_id uuid PK REFERENCES public.users(id) ON DELETE CASCADE`,
  `name text NOT NULL` (CHECK same pattern as usernames: `^[a-zA-Z0-9 _-]{3,20}$`),
  `created_at`. Unique index on `lower(name)`. RLS enabled; SELECT own row only
  (`user_id = auth.uid()`); no INSERT/UPDATE/DELETE policies — writes go through the RPC.
- **Shut guests out of user data:**
  - `has_profile_access` gains `AND NOT public.is_anonymous_session()`. That covers every
    user-data table's policies.
  - The `users` self-UPDATE policy and the alt INSERT policy get the same guard, so a guest
    cannot set `users.username`.
- **`submit_arcade_score`** — drop and recreate with a fifth parameter,
  `p_guest_name text DEFAULT NULL`. This is the same overload-ambiguity reasoning as
  `20261019000001`: the drop and the create run in one transaction.
  - An anonymous caller first gets `INSERT INTO public.users (id) VALUES (uid) ON CONFLICT DO
    NOTHING`, so the FKs on the name and score tables hold even if the trigger did not run.
  - Anonymous caller, `p_guest_name` given: upsert the caller's `arcade_guest_names` row. A
    name that another guest already holds (case-insensitive) raises a distinct error
    (`guest_name_taken`, SQLSTATE `23505` passed through) and saves nothing.
  - Anonymous caller with no name row and no `p_guest_name`: raise `guest_name_required`.
  - Non-anonymous caller passing `p_guest_name`: raise. An account never gets a guest name.
  - The score upsert and ranking are otherwise unchanged. Ranking counts players whose display
    name `coalesce(u.username, g.name)` is not null.
- **`get_arcade_leaderboard`** — drop and recreate. It LEFT JOINs `arcade_guest_names` and
  returns `username` = `coalesce(u.username, g.name)` and a new column `is_guest boolean`
  (`g.user_id IS NOT NULL`). The filter is "display name is not null". The deployed parser
  ignores the extra column.
- **Admin counts:** `getTotalUserCount` excludes guests. A guest's `users` row has no email and no
  owner. Guests generate no heartbeat or usage activity, because the client guard keeps `user`
  null. Server-only admin RPCs whose bodies are not in the repo are left as they are.
- **Cleanup:**
  - `public.cleanup_arcade_guests()`, SECURITY DEFINER, deletes anonymous `auth.users` rows
    when either their score's `updated_at` is older than 90 days, or they are more than 1 day
    old with no `arcade_guest_names` row.
  - The existing `handle_auth_user_delete` trigger and the FK cascades remove the
    `public.users`, name and score rows.
  - Execute is revoked from `anon` and `authenticated`.
  - Scheduling is a separate SQL snippet the owner runs once pg_cron is enabled. The repo has no
    pg_cron usage yet, so the migration must not depend on the extension.

**Precondition (owner, before applying):** confirm the current definitions of
`has_profile_access` and the `users` policies match the repo. The migration `CREATE OR REPLACE`s
them:

```sql
select pg_get_functiondef('public.has_profile_access'::regproc);
select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy where polrelid = 'public.users'::regclass;
```

### 3. Arcade submission flow

`useArcadeSubmission` keys on `user?.id ?? guestUserId`:

| State | Condition | UI |
|---|---|---|
| `guest-invite` (was `signed-out`) | no account, no guest session | "Join the leaderboard as a guest" button + "or sign in" link |
| `needs-guest-name` | joining as guest, or a guest session with no name row | Guest-name modal |
| `checking` / `submitting` / `submitted` / `error` / `skipped` | as today | as today |
| `needs-username` | account without a username | existing `ArcadeUsernameModal`, unchanged |

- **Joining:** the guest types a name in a `GuestNameModal` (it reuses `Modal`/`Input`/`Button`;
  it does not reuse `ArcadeUsernameModal`, which writes `users.username`). On submit:
  1. `signInAsGuest()` runs, only if there is no guest session yet. Anonymous sign-in never
     happens on page load.
  2. `submit_arcade_score(..., p_guest_name)` runs, claiming the name and saving the score in
     one call.
  3. If the name is taken, the modal stays open with an inline error and the guest retries on
     the SAME session. No second anonymous user is minted.
- **Returning guest:** the session persists in localStorage. A guest who has a name row (read
  via the own-row SELECT) gets every later run auto-submitted, like an account.
- **Guest dismisses the modal:** the status goes to `skipped`. The anonymous user may already
  exist without a name; the 1-day cleanup removes it.

### 4. Leaderboard UI

- `parseLeaderboardRows` reads `is_guest` (missing → false).
- `ArcadeLeaderboard` and the podium show a `GUEST` tag next to a guest name. The tag is plain
  text with a muted colour class: no emoji, no side-bar accent.
- The row key includes `is_guest`, because a guest name may equal an account username.
- `is_me` works for guests because the RPC runs with the guest's JWT. The refetch key becomes
  `user?.id ?? guestUserId`.

### 5. Fleetless pilots: bare templates

- **Fleetless** means the player's fleet is empty, whether or not they are signed in. Players
  with a fleet are unchanged.
- **Fighter select:** instead of skipping to the neon fighter, it lists every `ship_templates`
  row (via `useShipsData`). `FighterSelect` already has search and a faction filter. The neon fighter stays available.
- **Building the ship:** `useShipsData` already yields bare ships. `transformShipTemplate` sets
  no equipment, refits or implants, so no conversion is needed. An `arcadeFleet(owned, loading,
  templates)` helper picks the fleet. Bare duels use a no-op engineering lookup.
- **Duels:** in template mode the opponent pool is the bare templates other than the flown one.
  `canDuel` and `pickOpponents` take the pool and a template-mode flag; that flag waives the
  gear requirement that `isDuelCandidate` imposes. `runDuel` is unchanged, since bare ships
  carry no gear.
- **Submitting:** the flown template's name is sent as `p_ship`, as for fleet ships.

## Testing

- **Unit:**
  - `arcadeFleet`;
  - the template-mode branches of `pickOpponents` and `canDuel`;
  - `parseLeaderboardRows` with and without `is_guest`;
  - the `useArcadeSubmission` state transitions: guest invite, sign-in-then-submit,
    name-taken retry on the same session, returning-guest auto-submit;
  - `AuthProvider`: an anonymous session yields `user = null` and `guestUserId` set, and does
    not dispatch the migration events.
- **Tripwire:** a test that an anonymous auth event runs neither the migration, nor the
  demo-data wipe, nor the heartbeat user update.
- **SQL:** the owner applies the migration. Verification queries go in the PR body:
  - anonymous submit without a name fails;
  - with a name it succeeds;
  - a duplicate name fails;
  - a guest cannot update `users.username` or insert a ship;
  - the board returns `is_guest`.
- **Manual:** `npm start` on :3000. Play as a fresh guest, then sign in and confirm the guest
  row stays and the account menu shows. Also play fleetless and run a template duel.

## Documentation and changelog

- `DocumentationPage`: the arcade section mentions guest play and bare-template flying.
- `UNRELEASED_CHANGES`: `Arcade: guests can now join the leaderboard without an account.` and
  `Arcade: pilots without a fleet can fly any ship.`

## Out of scope

- Carrying a guest score over to an account, or linking identities.
- Renaming a guest after joining.
- CAPTCHA.
- A guest sign-out button.
