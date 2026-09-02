# Autogear Saved Teams — Design

Date: 2026-07-29
Status: Approved (user-approved 2026-07-29)

## Problem

The Autogear page already lets you select multiple ships in order — order matters, because
gear is allocated ship by ship and index 0 gets first pick of the inventory. That selection
is throwaway. Users who repeatedly gear the same group (an arena team, a farm squad) rebuild
it by hand every visit.

## Goal

Save a named, ordered ship selection as a **team**, and load it back later with each ship's
existing autogear config applied. Plus a shortcut to seed a team from a saved encounter's
formation.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Where do configs come from on load? | The shared per-ship config in `autogear_configs` | Same as selecting a ship by hand today. No duplication, no drift. A ship cannot have a different role per team — accepted. |
| New entity or reuse `TeamLoadout`? | New `AutogearTeam` | `TeamLoadout` carries a full gear snapshot per position and assumes exactly 5 positions. Saving from autogear would write a meaningless equipment snapshot that loading then ignores. |
| Save/management semantics | Name modal, duplicate names rejected; list rows have delete | Mirrors `TeamLoadoutForm`. No rename, no update-in-place: tweaking a team is delete + re-save. |
| Load with ships already selected | Replace, with a `ConfirmModal` when a real selection would be lost | Matches the existing `?shipIds=` param and select-all-suggestions behaviour. |
| Size cap | None. Save enabled at ≥2 real ships | Autogear already queues arbitrarily many ships; a team is a saved selection, not a game formation. |
| Encounter shortcut placement | A *From encounter* section inside the teams modal | Reuses the save flow and its duplicate-name rule; see "Encounter import" below. |

## Data model

`src/types/autogearTeam.ts`:

```ts
export interface AutogearTeam {
    id: string;
    name: string;
    shipIds: string[]; // ordered — index 0 gets first pick of gear
    createdAt: number;
}
```

`shipIds` is JSONB with **no FK** to `ships`. Ship rows are replaced on re-import; a team
surviving as a partially-resolvable list beats a cascade silently emptying it.

## Persistence

New `StorageKey.AUTOGEAR_TEAMS = 'autogear_teams'`.

Migration `supabase/migrations/20260729000001_add_autogear_teams.sql`, modelled on
`20260507001_add_gear_wishlists.sql`:

```sql
CREATE TABLE autogear_teams (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    ship_ids   JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE autogear_teams ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX autogear_teams_user_name_idx ON autogear_teams (user_id, name);

CREATE POLICY "Users can manage their own autogear teams"
    ON autogear_teams
    USING (public.has_profile_access(user_id))
    WITH CHECK (public.has_profile_access(user_id));
```

Row-per-team rather than one JSONB blob per user: saves and deletes are independent writes
(no read-modify-write races), and the unique index enforces no-duplicate-names server-side
rather than only in the form.

## Hook

`src/hooks/useAutogearTeams.ts` — the shape of `useLoadouts`' team half, much smaller:

```ts
{
    teams: AutogearTeam[];
    loading: boolean;
    saveTeam: (name: string, shipIds: string[]) => Promise<void>;
    deleteTeam: (id: string) => Promise<void>;
}
```

- localStorage via `useStorage({ key: StorageKey.AUTOGEAR_TEAMS, defaultValue: [] })`
- Supabase load keyed on `activeProfileId` when `isSupabaseSyncEnabled()`
- Optimistic update, rollback on error, `addNotification` on both paths
- Listens for `app:signout`, `PROFILE_SWITCH_EVENT`, `app:migration:start` / `app:migration:end`

A hook, not a context — only the Autogear page consumes it.

### Table-enumeration integration points

Three places enumerate user-data tables explicitly and must include the new one:

1. `src/utils/migratePlayerData.ts` — push localStorage teams up on sign-in (follow the
   `gear_wishlists` block, ~L947)
2. `src/services/userDataService.ts` — profile delete (~L201) and sync
3. `src/components/import/BackupRestoreData.tsx` — backup and restore

## UI

### Header buttons — `AutogearQuickSettings`

`Add Ship` · `Add Team` (always) · `Save Team` (only when ≥2 real ships selected). All
`Button variant="secondary"`, matching the existing `Add Ship`.

### `src/components/autogear/AutogearTeamsModal.tsx`

`Modal title="Teams"`, two sections:

- **Saved teams** — one `card` row per team: name, "N ships", ship names. Click the row to
  load. `Button variant="danger" size="sm"` with `CloseIcon` → `ConfirmModal` → delete.
  Empty state when there are none.
- **From encounter** — local encounters from `useEncounterNotes` as rows (name + ship
  count). Click derives the ordered ship list from the formation, loads it, and passes the
  encounter name up as the suggested team name. Empty state when there are none.

Shared encounters are excluded: their ship IDs belong to the author, not the viewer.

### `src/components/autogear/SaveAutogearTeamModal.tsx`

`Modal` containing `Input label="Team name"` (`error` prop set on duplicate, matching
`TeamLoadoutForm`), a numbered preview of the ship order so what's being saved is explicit,
and Save / Cancel.

## Page wiring — `AutogearPage.tsx`

### `applySavedConfigs(ships: Ship[])`

The "for each ship, `getConfig` → `updateShipConfig({ ...savedConfig, fleetBuffs: savedConfig.fleetBuffs ?? [] })`
→ notify once if any applied" loop is currently copy-pasted three times:

- L322–334 (`?shipIds=` URL param)
- L932–938 (`handleShipSelect`, single ship)
- L947–960 (`handleSelectAllSuggestionTargets`)

Team loading would be the fourth copy. Extract one helper; all four call sites use it.

### `handleLoadTeam(shipIds: string[])`

1. Resolve each ID via `getShipById`, dropping unresolvable ones
2. If ≥1 real ship is currently selected, `ConfirmModal` first (default `[null]` state loads
   in one click)
3. `setSelectedShips(resolved)` then `applySavedConfigs(resolved)`

### `handleSaveTeam(name: string)`

`selectedShips.filter(Boolean)`, deduped by ID keeping first position — the same ship queued
twice is only wasted work.

### `pendingTeamName: string | null`

Page state. Set when loading from an encounter, read as the initial value of the save
modal's `Input`, cleared on successful save. A default only; editing the selection does not
invalidate it.

## Encounter import flow

Given an encounter "Wave 3 Farm" with Lodolite (`sortOrder` 1), Zeolite (2), Hemlock (T3),
Makoli (M2):

1. `Add Team` → teams modal
2. Click the "Wave 3 Farm" row → `formationToShipIds(formation)` → `[lodolite, zeolite, hemlock, makoli]`
3. Modal calls `onLoadShipIds(shipIds, { suggestedName: 'Wave 3 Farm' })`
4. Page runs the same `handleLoadTeam` path a saved team uses; modal closes. Each ship
   arrives with its existing saved config applied.
5. **Nothing is persisted yet.** Reorder, drop a ship, add one the encounter didn't have,
   change a role.
6. `Save Team` is showing (≥2 ships) → save modal opens with the name pre-filled
   "Wave 3 Farm" and the current order previewed. Confirm → row written.
7. Or never save — hit `Find Optimal Gear` and the encounter was a one-shot shortcut.

Why not one-click create:

- An encounter is a positional formation for a fight, including ships you may not want to
  spend gear on. A team is a gear-allocation queue where order decides first pick. The
  loading step is the translation.
- `sortOrder` is optional, so derived order is partly a guess. Reviewing it before it
  becomes a record catches a wrong guess before gearing the tank first.
- Reuses the duplicate-name rule instead of inventing an overwrite/auto-suffix policy for a
  modal that has already closed.
- No orphan team records from browsing encounters to find the right one.

### `src/utils/encounters/formationToShipIds.ts`

Pure, unit-tested:

1. Entries with a defined `sortOrder` first, ascending
2. Then remaining entries in grid reading order — the `rows` array at `FormationGrid.tsx:69`
   (`T1..T4`, `M1..M4`, `B1..B4`)
3. Dedupe by `shipId`, keeping first occurrence

## Edge cases

| Case | Behaviour |
|---|---|
| Some team ships no longer exist | Load those that resolve; `warning` notification naming the count; team record untouched |
| All team ships gone | `error` notification; selection unchanged; modal stays open |
| Duplicate team name | Inline `error` on the `Input`; DB unique index as backstop |
| Team saved while signed out | Kept in localStorage. Pushed to Supabase on sign-in **only for a brand-new account** — `AuthProvider` runs `migratePlayerData` only for accounts created in the last 5 seconds. An existing user who signs in gets the remote list, replacing local teams; the ProfilePage re-upload button is the escape hatch (it now covers teams). Same behaviour as loadouts, encounters and the gear wishlist. |
| Same ship selected twice | Deduped once on the page: the same deduped list drives the `Save Team` visibility gate, the save dialog's order preview, and the saved record (first position wins) |
| Single-ship encounter imported | Loads fine, but `Save Team` stays hidden (≥2 gate). Accepted — encounters are effectively always 4–5 ships. |

## Testing

- `formationToShipIds` — full `sortOrder`, partial, none, duplicate `shipId`s
- Ship-ID resolution + dedupe pulled into pure helpers so they are testable without mounting
  the 1600-line page
- Component test for `AutogearTeamsModal`: load click, delete confirm, duplicate-name
  rejection

`src/components/autogear/` has no `__tests__` directory today, so this establishes one. Per
project memory, worktrees need the gitignored `.env` copied in or `.tsx` tests fail to
collect ("supabaseUrl is required", 0 failed tests).

## Also required

- `src/pages/DocumentationPage.tsx` — autogear section, per CLAUDE.md
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry, per CLAUDE.md

## Out of scope

- Team-scoped config overrides (a ship as DPS in one team, Support in another)
- Rename / update-in-place
- Sharing teams with other users
- Any change to the existing `TeamLoadout` feature on the Loadouts page
