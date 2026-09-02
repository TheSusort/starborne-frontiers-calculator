# Demo Data Feature

Allow visitors to load sample data and explore the app without needing their own game export file.

## Overview

A "Load Demo Data" button on the home page writes a small set of ships, gear, and engineering stats into localStorage. A persistent sidebar badge indicates demo mode. Demo data is never synced to Supabase.

## Data Flag & Lifecycle

**New localStorage key:** `demo_data_loaded` (value `"true"` or absent).

**Loading flow:**

1. User clicks "Load Demo Data" in the Backup & Restore section.
2. If `ships` or `inventory_items` already exist in localStorage, show a `ConfirmModal`: "You already have data. Loading demo data will replace it. Continue?"
3. Write demo ships, gear, and engineering stats to `StorageKey.SHIPS`, `StorageKey.INVENTORY`, and `StorageKey.ENGINEERING_STATS`.
4. Set `demo_data_loaded = "true"`.
5. Reload the page so all contexts re-initialize from localStorage.

**Flag cleared when:**

- User imports real game data (in `ImportButton.processFileImport`).
- User clicks "Clear" on the demo badge in the sidebar.

**Supabase guard:** In `AuthProvider.migrateDataForNewUser()`, before calling `syncMigratedDataToSupabase()`, check the flag. If set, clear all 3 storage keys and the flag, dispatch `app:migration:end`, and return early. The user starts fresh after sign-up.

## Demo Data Content

### Ships (~5)

| Ship | Faction | Rarity | Role | Level | Affinity |
|------|---------|--------|------|-------|----------|
| Attacker | TERRAN_COMBINE | legendary | ATTACKER | 60 | chemical |
| Defender | GELECEK | epic | DEFENDER | 45 | electric |
| Supporter | BINDERBURG | epic | SUPPORTER | 50 | thermal |
| Debuffer | XAOC | rare | DEBUFFER | 35 | antimatter |
| Second attacker | FRONTIER_LEGION | uncommon | ATTACKER | 20 | chemical |

- Realistic base stats scaled to level/rarity.
- 2-3 ships have 1-2 refits with stat bonuses.
- Use real ship names from `ship_templates` where possible.

### Gear (~20 pieces)

- 3 ships fully geared (6 slots each = 18 pieces), 2 ships ungeared.
- Mix of sets: ATTACK, DEFENSE, SPEED, CRITICAL, FORTITUDE.
- Rarities from uncommon to legendary.
- Levels 4-16, stars 1-5.
- 1-4 substats per piece.
- Gear linked to ships via `shipId` and ship `equipment` references.

### Engineering stats

- Stats for ATTACKER and DEFENDER ship types only.
- A few flat stats (hp, attack, defence) and one percentage stat (crit).
- Other ship types left empty to show contrast in the statistics page.

### Not included

No implants, loadouts, or encounters. Keeps the demo small and focused on the core loop (fleet, gear, autogear).

## UI Components

### Home page — Backup section

Add a `DemoDataSection` component below `BackupRestoreData` in the existing "Backup & Restore" card:

- Separated by a subtle divider.
- Secondary-variant button: "Load Demo Data".
- Clicking triggers the guard check and confirm modal if needed.

### Sidebar — Demo badge

- Small amber/yellow pill badge reading "Demo Data" with an "X" / clear action.
- Visible whenever `demo_data_loaded` is `"true"`.
- Clicking clear shows `ConfirmModal`: "Remove demo data and start fresh?"
- Clearing removes all 3 storage keys + flag and reloads the page.

### No changes to other pages

Ships, gear, autogear, statistics, and all other pages render from context as usual.

## Event Handling

| Action | What happens |
|--------|-------------|
| Load demo data | Write to 3 storage keys, set flag, `window.location.reload()` |
| Clear demo data | Remove 3 storage keys + flag, `window.location.reload()` |
| Import real data | Normal import flow; additionally remove `demo_data_loaded` flag |
| Sign up with demo data | `AuthProvider` detects flag, clears localStorage, skips Supabase sync |

The sidebar badge reads the flag on mount and listens for `storage` events and custom `app:demo-data-loaded` / `app:import-complete` events.

## File Changes

### New files

- `src/utils/demoData.ts` — Demo data constants and `loadDemoData()`, `clearDemoData()`, `isDemoDataLoaded()` helpers.
- `src/components/home/DemoDataSection.tsx` — Button, guard logic, and confirm modal.

### Modified files

- `src/constants/storage.ts` — Add `DEMO_DATA_LOADED: 'demo_data_loaded'`.
- `src/pages/HomePage.tsx` — Render `DemoDataSection` below `BackupRestoreData`.
- `src/components/import/ImportButton.tsx` — Clear demo flag after successful import.
- `src/contexts/AuthProvider.tsx` — Guard `syncMigratedDataToSupabase` against demo data.
- `src/components/ui/layout/Sidebar.tsx` — Add demo data badge with clear action.
