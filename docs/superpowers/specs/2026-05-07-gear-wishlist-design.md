# Gear Wishlist — Design Spec

**Date:** 2026-05-07

## Overview

A gear wishlist system that lets users define named filter sets ("entries") describing gear they are actively farming. The wishlist lives as a new tab on the Gear page and integrates with the import summary modal to surface matches when new gear arrives.

---

## Scope

Applies to **gear pieces only** (slots: weapon, hull, generator, sensor, software, thrusters via `GEAR_SLOT_ORDER`). Implants are excluded. The `isGear()` predicate (or equivalent slot check against `GEAR_SLOT_ORDER`) must be applied before evaluating wishlist filters anywhere in the codebase.

---

## Data Model

```ts
// src/types/wishlist.ts

interface WishlistEntry {
    id: string                          // uuidv4() on creation
    name: string                        // max 64 characters; used as tab label in search results
    filters: {
        slot?: GearSlotName             // exact match (GearSlotName from src/constants/gearTypes.ts)
        stars?: number                  // minimum — match if piece.stars >= entry.filters.stars
        rarity?: RarityName             // exact match (RarityName from src/constants/rarities.ts)
        setBonus?: GearSetName          // exact match (GearSetName from src/constants/gearSets.ts)
        mainStat?: { name: StatName }   // name-only match, ignores flat/percentage distinction
        subStats?: { name: StatName }[] // ALL listed names must appear in piece.subStats
    }
}
```

**Match logic (all conditions AND):**
- Unspecified fields are wildcards (always pass).
- `stars`: `piece.stars >= entry.filters.stars`
- `rarity`, `slot`, `setBonus`: exact equality
- `mainStat`: `piece.mainStat?.name === entry.filters.mainStat.name` (piece.mainStat null → no match)
- `subStats`: every name in the filter list must appear at least once in `piece.subStats.map(s => s.name)`; a piece with `subStats: []` always fails a non-empty substat filter

---

## Gear Page — Wishlist Tab

Added alongside the existing Inventory / Upgrade Analysis / Calibration / Simulate Upgrades tabs.

### Entry List View
- Each entry renders as a card showing its name and active filter criteria as compact chips.
- Empty state: icon + "Start Tracking Gear" headline + description + "Add Entry" button.
- "Add Entry" button in the page action area opens the entry form.

### Entry Form (`WishlistEntryForm`)
Fields (all optional except name):
- **Name** — text input, required, `maxLength={64}`
- **Slot** — Select (gear slots from `GEAR_SLOT_ORDER` only; no implant slots)
- **Min Stars** — Select (1–6)
- **Rarity** — Select using `RarityName` values
- **Gear Set** — Select using `GearSetName` values
- **Main Stat** — Select (all stat names)
- **Substats** — multi-select chip picker; user picks stat name types; all must be present on a piece

Each entry can be edited or deleted inline. IDs generated with `uuidv4()` on creation.

### Search Results Panel (`WishlistSearchResults`)
Triggered by a "Search Inventory" button on the tab. Button is disabled when there are no entries.

- Filters the inventory to gear pieces only (`GEAR_SLOT_ORDER` check) before evaluating entries.
- Renders one tab per wishlist entry (tab label = entry name). Tabs scroll horizontally for 10+ entries — acceptable for initial implementation.
- Each tab shows matching gear via the existing `GearPieceDisplay` component.
- Tabs with zero matches remain visible with an empty state: "No gear in your inventory matches this entry yet."

---

## Import Summary Integration

### `computeImportDiff` extension

Current signature:
```ts
computeImportDiff(oldShips, oldInventory, newShips, newInventory, newEngStats?)
```

Extended (6th optional arg, fully backward-compatible):
```ts
computeImportDiff(oldShips, oldInventory, newShips, newInventory, newEngStats?, wishlistEntries?)
```

When `wishlistEntries` is provided:
- Filter `newInventory` to gear pieces only (`GEAR_SLOT_ORDER` check).
- Newly added pieces (IDs present in newInventory but absent from oldInventory) are checked against all entries.
- A piece satisfying all filters of an entry is a **wishlist hit**.

`wishlistHits` is added as a **top-level field** on the `ImportDiff` interface in `src/types/importDiff.ts`:
```ts
// Added to ImportDiff (top level, not nested inside gear: {...})
wishlistHits?: {
    entryId: string
    entryName: string
    gear: GearPiece
}[]
```

`hasChanges()` in `computeImportDiff.ts` is **not** updated for `wishlistHits` — hits are advisory.

### `ImportDiffModal` extension
When `diff.wishlistHits` is non-empty, a **"Wishlist Hits"** section appears below the Notable Gear section. Each hit shows the entry name (bold) and gear piece details (slot, set icon, main stat, stars, rarity) matching the existing Notable Gear item style.

**Not shown** when `isFreshImport === true`.

Wishlist entries are **not** automatically removed on a match.

### `ImportButton` extension
`ImportButton` reads `entries` from `useGearWishlist()` (available globally via context) and passes them as the 6th argument to `computeImportDiff`.

---

## Storage

### Supabase table (new)

```sql
-- supabase/migrations/YYYYMMDD_add_gear_wishlists.sql
CREATE TABLE gear_wishlists (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entries    JSONB       NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gear_wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own wishlist"
    ON gear_wishlists
    USING  (public.has_profile_access(user_id))
    WITH CHECK (public.has_profile_access(user_id));
```

`ON DELETE CASCADE` on `user_id` FK handles cleanup if the users row is ever deleted. However, since `deleteUserSupabaseData` does **not** delete the `users` row, an explicit `DELETE FROM gear_wishlists WHERE user_id = userId` step must be added to `deleteUserSupabaseData` in `src/services/userDataService.ts`.

### localStorage (anonymous users)
Key: `StorageKey.GEAR_WISHLIST = 'gear_wishlist'` (added to `src/constants/storage.ts`).

### `useGearWishlist` hook pattern

Follows `useLoadouts` exactly:

- **On mount:** if `activeProfileId` is set, `SELECT entries FROM gear_wishlists WHERE user_id = activeProfileId`; else load from localStorage via `useStorage`.
- **On mutation (`addEntry`, `updateEntry`, `deleteEntry`):**
  1. Optimistic update to local React state.
  2. Persist to localStorage via `useStorage`.
  3. If authenticated: `UPSERT INTO gear_wishlists (user_id, entries) ... ON CONFLICT (user_id) DO UPDATE SET entries = excluded.entries, updated_at = NOW()`.
- **`app:signout`:** clear local state.
- **`PROFILE_SWITCH_EVENT`:** clear state and reload from Supabase for new profile.

### Sign-in migration (localStorage → Supabase)

Extend `migratePlayerData.ts`:
- Add `wishlistEntries: WishlistEntry[]` to `MigrationResult`.
- Read `StorageKey.GEAR_WISHLIST` from localStorage and include in the result.

Extend `syncMigratedDataToSupabase`:
- Add a step to upsert `migrationResult.wishlistEntries` into `gear_wishlists` for the target `userId`.

### Context provider

`GearWishlistProvider` is a React context wrapping `useGearWishlist`. It is added to `App.tsx` **after `AutogearConfigProvider`** (same dependency level — needs `ActiveProfileProvider` and `AuthProvider` to be ancestors):

```
AuthProvider
  ActiveProfileProvider
    InventoryProvider
      ShipsProvider
        AutogearConfigProvider
          GearWishlistProvider   ← insert here
            EngineeringStatsProvider
              Router ...
```

---

## New Files

| File | Purpose |
|---|---|
| `src/types/wishlist.ts` | `WishlistEntry` type |
| `src/hooks/useGearWishlist.ts` | CRUD + localStorage + Supabase + event listeners |
| `src/contexts/GearWishlistProvider.tsx` | Context provider; exports `useGearWishlist` hook |
| `src/components/gear/GearWishlistTab.tsx` | Tab root — entry list + form + search toggle |
| `src/components/gear/WishlistEntryForm.tsx` | Add/edit form |
| `src/components/gear/WishlistSearchResults.tsx` | Tabbed inventory search results |
| `supabase/migrations/YYYYMMDD_add_gear_wishlists.sql` | Creates `gear_wishlists` table with RLS |

## Modified Files

| File | Change |
|---|---|
| `src/constants/storage.ts` | Add `GEAR_WISHLIST: 'gear_wishlist'` to `StorageKey` |
| `src/App.tsx` | Wrap tree with `GearWishlistProvider` after `AutogearConfigProvider` |
| `src/pages/manager/GearPage.tsx` | Add "Wishlist" tab |
| `src/utils/import/computeImportDiff.ts` | Accept optional `wishlistEntries` (6th arg); evaluate hits |
| `src/types/importDiff.ts` | Add `wishlistHits` as top-level field on `ImportDiff` |
| `src/components/import/ImportDiffModal.tsx` | Render Wishlist Hits section (diff mode only) |
| `src/components/import/ImportButton.tsx` | Pass wishlist entries as 6th arg |
| `src/services/migratePlayerData.ts` | Add `wishlistEntries` to `MigrationResult`; read from localStorage |
| `src/services/userDataService.ts` | Add `gear_wishlists` deletion step to `deleteUserSupabaseData` |
| `src/pages/DocumentationPage.tsx` | Document the Wishlist tab and import integration |

---

## Out of Scope

- Substat minimum value filtering (type-only match only)
- Auto-removing wishlist entries on match
- Showing wishlist hits on fresh imports
- Adding entries from autogear results
- Sharing wishlist entries with other users
- Implant wishlist entries
