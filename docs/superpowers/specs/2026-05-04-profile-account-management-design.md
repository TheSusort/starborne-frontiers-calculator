# Profile & Account Management Redesign

**Date:** 2026-05-04
**Status:** Approved

## Overview

Consolidate all account and data management actions into the Profile page, make Profile accessible to anonymous users, extend the sidebar navigation to expose Profile to everyone, and add new data management capabilities (Supabase sync toggle, clear cloud data) and a Connected Integrations section.

## Goals

1. Move backup/restore, delete local storage, and delete account from HomePage into Profile
2. Allow anonymous users to access Profile (currently auth-gated)
3. Update sidebar nav so all users can reach Profile
4. Add Supabase sync toggle and "clear cloud data" action
5. Add a Connected Integrations section (placeholder for future integrations)
6. Remove the data management card from HomePage entirely

---

## Section 1: Navigation

### LoginButton (`src/components/auth/LoginButton.tsx`)

**Authenticated (unchanged):** Avatar + username button opens dropdown with "Profile" and "Sign Out".

**Anonymous (new):** Text button reading "Profile / Sign in" (no avatar) opens the same style dropdown with two items:
- "Profile" → navigates to `/profile`
- "Sign in" → opens AuthModal

No other nav changes required. ProfilePage becomes accessible without auth, so the link works for everyone.

---

## Section 2: Profile Page Access

### ProfilePage (`src/pages/ProfilePage.tsx`)

Remove the `if (!user) return <sign-in prompt>` guard at the top of the component.

**Loading state:** Initialize `loading` to `false` when `!user`, so anonymous users don't see a loader flash before the page renders. The `useEffect` that fetches profile data already short-circuits when there is no user — the initial state just needs to reflect this.

Each auth-required section conditionally renders either its content (when `user` is set) or a muted placeholder (when `user` is null). Placeholder: a short message like `"Sign in to view [section name]"` with an inline sign-in button.

Sections that require auth:
- Profile Settings (username, in-game ID, leaderboard visibility)
- Alt Accounts
- App Preferences
- Statistics
- Usage Statistics
- Engineering Leaderboards
- Top Ship Rankings
- Connected Integrations cards (section header visible, cards auth-gated)

Sections always fully visible (no auth required):
- Data Management (backup/restore, delete local storage)

---

## Section 3: Data Management Section

New collapsible section added to ProfilePage, visible to all users.

### Sub-sections (in order)

#### Supabase Sync Toggle *(auth-required, main account only)*
- Hidden entirely for anonymous users and when `isOnAlt === true` (sync is an account-level setting, not per-alt).
- Preference stored in localStorage under key `'supabase_sync_enabled'` (enum key: `SUPABASE_SYNC_ENABLED` in `src/constants/storage.ts`). Defaults to `true` for signed-in users; not relevant for anonymous users.
- Behavior across sign-out: localStorage persists the flag. If a user disables sync, signs out, and signs back in on the same device, the flag remains `false`. On a fresh device (empty localStorage) the flag defaults to `true`.
- The initial sign-in migration path (`syncMigratedDataToSupabase` called from `AuthProvider`) always runs regardless of this flag — it is new-user setup, not a routine sync.

**Toggle OFF flow:**
1. Show `ConfirmModal`: "This will delete all your cloud data and disable sync. Your local data is unaffected. This cannot be undone."
2. On confirm: call `deleteUserSupabaseData(userId)` (see Data Service section).
3. Set `'supabase_sync_enabled' = false` in localStorage.

**Toggle ON flow:**
1. Set `'supabase_sync_enabled' = true` in localStorage.
2. Call `deleteUserSupabaseData(userId)` then `reuploadLocalDataToSupabase(userId)` to ensure Supabase is an exact mirror of current local state. The delete step removes any stale rows (e.g. ships deleted locally while sync was off) that a plain upsert would leave behind.

#### Clear Cloud Data *(auth-required, only shown when sync is ON)*
- Button: "Clear & re-sync" in danger style.
- `ConfirmModal`: "This will delete all your cloud data and immediately re-upload from your local data. Sync remains enabled."
- On confirm: call `deleteUserSupabaseData(userId)` then `reuploadLocalDataToSupabase(userId)`.
- Sync toggle state is unchanged.

#### Backup & Restore
- `BackupRestoreData` component, moved from HomePage. Visible to all users.

#### Delete Local Storage
- Existing button from HomePage, moved here. Visible to all users.

#### Delete Account *(auth-required)*
- Existing button from HomePage, moved here.

---

## Section 4: Connected Integrations Section

New collapsible section on ProfilePage, below Data Management.

Section header visible to all users. Card content auth-gated: anonymous users see "Sign in to manage integrations" placeholder.

### Integration card structure
Each integration is a card showing:
- Name + icon
- Status badge: `Deprecated` | `Coming Soon` | `Connected` | `Available`
- Description text
- Action button (disabled if status is Deprecated or Coming Soon)

### Initial integrations

| Name | Status | Description |
|---|---|---|
| Cubedweb Hangar | Deprecated | Shared hangar viewing — a new system is in development |
| Starborne Frontiers API | Coming Soon | Official game API access for community toolers |

### Implementation
Define integrations as a static array in `src/constants/integrations.ts`. The UI component maps over the array — adding a future integration requires only a new array entry with no structural changes to the component.

---

## Section 5: Homepage Cleanup

Remove the `BackupRestoreData` card section from `HomePage.tsx` entirely — including the component, its import, and any surrounding markup (delete account button, delete local storage button, section header).

No replacement or redirecting link is added.

---

## Data Service

### `deleteUserSupabaseData(userId: string): Promise<void>`

New function in `src/services/userDataService.ts`. Deletes all user game data from Supabase but leaves the `users` row intact.

Tables to delete from, in dependency order (children before parents to avoid FK violations — no CASCADE constraints exist):

1. `team_loadout_equipment`
2. `team_loadout_ships`
3. `team_loadouts`
4. `loadout_equipment`
5. `loadouts`
6. `encounter_formations`
7. `ship_equipment`
8. `ship_implant_stats`
9. `ship_implants`
10. `ship_refit_stats`
11. `ship_refits`
12. `ship_base_stats`
13. `encounter_notes`
14. `inventory_items`
15. `ships`
16. `engineering_stats`
17. `autogear_configs`

All deletes are filtered to the target user. Key implementation notes:

**Direct `user_id` column** (steps 3, 5, 13, 14, 15, 16, 17): filter with `.eq('user_id', userId)`.

**No `user_id` column — must scope via parent FK subquery:**
- `team_loadout_equipment` / `team_loadout_ships`: `team_loadout_id IN (SELECT id FROM team_loadouts WHERE user_id = ?)`
- `loadout_equipment`: `loadout_id IN (SELECT id FROM loadouts WHERE user_id = ?)`
- `encounter_formations`: `note_id IN (SELECT id FROM encounter_notes WHERE user_id = ?)` (also has `ship_id → ships.id`, but formations are already deleted before ships in step ordering)
- `ship_equipment`: `ship_id IN (SELECT id FROM ships WHERE user_id = ?)`
- `ship_implants` / `ship_base_stats` / `ship_refits`: `ship_id IN (SELECT id FROM ships WHERE user_id = ?)`
- `ship_implant_stats`: `implant_id IN (SELECT id FROM ship_implants WHERE ship_id IN (SELECT id FROM ships WHERE user_id = ?))`
- `ship_refit_stats`: `refit_id IN (SELECT id FROM ship_refits WHERE ship_id IN (SELECT id FROM ships WHERE user_id = ?))`

**Key ordering constraints:**
- `inventory_items.calibration_ship_id` → `ships.id`: step 14 before 15
- `encounter_formations.note_id` → `encounter_notes.id` and `encounter_formations.ship_id` → `ships.id`: step 6 before 13 and 15
- `gear_upgrades` is IndexedDB/localStorage only — no Supabase table, intentionally excluded.

### `reuploadLocalDataToSupabase(userId: string): Promise<void>`

New function in `src/services/userDataService.ts`. Reads the current localStorage/IndexedDB state and upserts it to Supabase. This is distinct from `syncMigratedDataToSupabase` — it does not perform UUID remapping (the data is already migrated). It uses upserts throughout (not inserts), so it is safe to call on top of existing Supabase data.

Called by: toggle-on handler, "clear & re-sync" action (after deletion).

Implementation notes:
- Most data is read from localStorage using `StorageKey` constants. Exception: `INVENTORY` (`inventory_items`) and `GEAR_UPGRADES` are stored in IndexedDB — read these via `getFromIndexedDB` before upserting.
- `gear_upgrades` is IndexedDB/localStorage only; it has no Supabase table and is intentionally excluded from both `deleteUserSupabaseData` and this re-upload function.
- Tables to upsert (in parent-before-child order): `ships`, `ship_base_stats`, `ship_refits`, `ship_refit_stats`, `ship_implants`, `ship_implant_stats`, `ship_equipment`, `inventory_items`, `encounter_notes`, `encounter_formations`, `loadouts`, `loadout_equipment`, `team_loadouts`, `team_loadout_ships`, `team_loadout_equipment`, `engineering_stats`, `autogear_configs`. Note: `autogear_configs` is not written by `syncMigratedDataToSupabase` but IS deleted by `deleteUserSupabaseData`, so it must be explicitly included here to avoid data loss on toggle-ON and clear-and-re-sync.
- No `migratePlayerData()` call — local data UUIDs are already stable at this point.

---

## Supabase Sync Flag in Contexts

The `useStorage` hook does **not** write to Supabase; all Supabase writes happen directly inside context providers (e.g. `ShipsContext`, `InventoryProvider`, `AutogearConfigContext`, `EngineeringStatsProvider`, `useLoadouts`, `useEncounterNotes`).

To support the sync toggle, add a shared helper:

```ts
// src/utils/syncUtils.ts
export function isSupabaseSyncEnabled(): boolean {
  return localStorage.getItem('supabase_sync_enabled') !== 'false';
}
```

Each context that writes to Supabase checks this flag before making any write/upsert/delete call. If `false`, skip the Supabase operation (local state is still updated normally).

The `AuthProvider` migration path (`syncMigratedDataToSupabase`) is exempt from this flag — it is a one-time new-user setup, not a routine sync.

---

## Storage Constants

Add to `src/constants/storage.ts`:
```ts
SUPABASE_SYNC_ENABLED: 'supabase_sync_enabled'
```

---

## Documentation

Update `DocumentationPage.tsx` to mention:
- Profile is now accessible without signing in
- Data Management section and sync toggle behaviour
- Connected Integrations section

---

## Out of Scope

- Actual cubedweb or SF API integration logic (future work)
- Per-table sync granularity (all-or-nothing sync toggle)
- Multiple sync destinations
- Sync flag persisted server-side across devices (localStorage only for now)
