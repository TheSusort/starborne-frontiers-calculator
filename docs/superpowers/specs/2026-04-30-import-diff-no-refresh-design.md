# Import Diff Summary & No-Page-Refresh Design

**Date:** 2026-04-30  
**Status:** Approved

## Overview

Two tightly coupled improvements to the import pipeline:

1. **No-page-refresh** — replace `window.location.reload()` with explicit context refresh calls so the app updates in-place after import.
2. **Import diff summary** — automatically show a modal after import describing what changed: new/leveled/refitted/removed ships (by rarity tier) and gear count changes.

These are designed together because the no-refresh fix is the prerequisite for showing the diff modal reliably (the modal must appear after state is fully updated, not just before a reload fires).

---

## Part 1: No-Page-Refresh

### Current behaviour

`ImportButton.processFileImport` calls `refreshPage()` on success, which shows a "refreshing in 3 seconds…" toast and then calls `window.location.reload()`. The reload was added historically for a ship lock-state sync issue; the state management has since been rewritten and the reload is no longer necessary.

### Why the reload exists for authenticated users

The local `transformShips` function does not set `imageKey` on ships. `ShipsContext.loadShips()` fetches from Supabase with a `ship_templates!inner (image_key)` join that populates `imageKey`. Without this call, ships render without images after import.

### Solution

Replace `refreshPage()` with targeted refresh calls:

**Authenticated users (after `syncMigratedDataToSupabase` succeeds):**
- Call `await loadShips()` + `await loadInventory()` from the contexts.
- These re-fetch from Supabase, populate `imageKey`, and update the contexts via their existing loading states.
- No page reload.

**Unauthenticated users:**
- `setShips`, `setInventory`, and `setEngineeringStats` already update React state synchronously via `useStorage.setData`.
- No reload or extra fetch needed.

### Changes to ImportButton

- Import `loadShips` from `useShips()` and `loadInventory` from `useInventory()` alongside the existing `setData` aliases.
- Remove `refreshPage` callback.
- Replace the two `refreshPage(...)` callsites with the diff modal trigger (see Part 2).
- Remove the "refreshing in 3 seconds…" success notification; the diff modal IS the success confirmation.

---

## Part 2: Import Diff Computation

### New type: `ImportDiff` (`src/types/importDiff.ts`)

```typescript
export interface LeveledShip {
  ship: Ship;
  oldLevel: number;
}

export interface RefittedShip {
  ship: Ship;
  oldRefitCount: number;
}

export interface RemovedShip {
  name: string;
  rarity: RarityName;
}

export interface ImportDiff {
  ships: {
    legendary: {
      added: Ship[];
      leveled: LeveledShip[];
      refitted: RefittedShip[];
      removed: RemovedShip[];
    };
    epic: {
      leveled: LeveledShip[];
      refitted: RefittedShip[];
      countDelta: number; // positive = net added, negative = net removed
    };
    otherDelta: number; // net change for rare/uncommon/common
  };
  gear: {
    countDelta: number;            // positive = net added, negative = net removed
    newLegendary6Star: GearPiece[]; // new pieces with rarity==='legendary' && stars===6
  };
}
```

### New utility: `computeImportDiff` (`src/utils/import/computeImportDiff.ts`)

Pure function: `computeImportDiff(oldShips: Ship[], oldInventory: GearPiece[], newShips: Ship[], newInventory: GearPiece[]): ImportDiff`

**Ship matching:** by `ship.id`.

**Per ship in new:**
- Not in old → "added" (bucket by rarity: legendary / epic / other)
- In old, same id, `newShip.level > oldShip.level` → "leveled" (legendary and epic only, individual)
- In old, same id, `newShip.refits.length > oldShip.refits.length` → "refitted" (legendary and epic only, individual)

**Per ship in old not in new:** → "removed" (legendary: individual by name; epic/other: count only via `countDelta` / `otherDelta`)

**Epic `countDelta`:** `(# new epic not in old) - (# old epic not in new)`.

**`otherDelta`:** `(# new non-legendary, non-epic not in old) - (# old non-legendary, non-epic not in new)`.

**Gear matching:** by `gear.id`. `countDelta = newInventory.length - oldInventory.length`. `newLegendary6Star` = pieces whose `id` is in new but not old, with `rarity === 'legendary' && stars === 6`.

**`hasChanges` helper:** at least one non-zero field across the whole diff.

---

## Part 3: ImportDiffModal (`src/components/import/ImportDiffModal.tsx`)

Uses the existing `Modal` component. Opens after state updates are complete (after `loadShips`/`loadInventory` for authenticated users, or immediately after `setData` calls for unauthenticated).

### When to open

In `processFileImport`, snapshot `ships` and `inventory` from context before calling `importPlayerData`. After import + state update completes, call `computeImportDiff` and open the modal.

For authenticated users, compute the diff using `result.data.ships` and `result.data.inventory` (the freshly transformed data) vs the snapshot — **before** calling `loadShips`/`loadInventory`, since those overwrite context state. The diff is based on the import result, not on post-Supabase state.

### Layout

```
┌─ Import Complete ────────────────────────────────────┐
│                                                       │
│  Ships                                                │
│  ─ Legendary ─────────────────────────────────────── │
│    + Vanguard Prime          (new)                    │
│    Bulwark of Dawn           55 → 60                  │
│    Iron Sentinel             R2 → R3                  │
│    - Phantom Raider          (lost)                   │
│  ─ Epic ──────────────────────────────────────────── │
│    Helios                    48 → 52                  │
│    Stormbreaker              R1 → R2                  │
│    +3 new · -1 removed                                │
│  ─ Other ─────────────────────────────────────────── │
│    +8 ships                                           │
│                                                       │
│  Gear                                                 │
│  ─────────────────────────────────────────────────── │
│    +234 pieces / -12 pieces                           │
│    ★★★★★★ Legendary Hull [CRITICAL] (new)            │
│    ★★★★★★ Legendary Weapon [ATTACK] (new)            │
│                                                       │
│                              [ Close ]                │
└───────────────────────────────────────────────────────┘
```

- Ships section omitted if no ship changes.
- A rarity sub-section (Legendary / Epic / Other) omitted if empty.
- "No changes detected" shown if `!hasChanges`.
- Gear section omitted if `countDelta === 0` and no legendary 6-star pieces.
- Ship entries use rarity colour (CSS class from `RARITIES[ship.rarity].textColor`).

---

## New Files

| File | Purpose |
|------|---------|
| `src/types/importDiff.ts` | `ImportDiff`, `LeveledShip`, `RefittedShip`, `RemovedShip` types |
| `src/utils/import/computeImportDiff.ts` | Pure diff function + `hasChanges` helper |
| `src/components/import/ImportDiffModal.tsx` | Modal component |

## Modified Files

| File | Change |
|------|--------|
| `src/components/import/ImportButton.tsx` | Remove `refreshPage`, add `loadShips`/`loadInventory`, snapshot + compute diff, open modal |

## Out of Scope

- The existing JSON Diff Calculator page (`/json-diff`) is untouched — it solves a different problem (manual raw-export comparison).
- Engineering stats diff — changes here are rare and low value to surface in a summary.
- Gear individual diff beyond legendary 6-star highlights — inventory can be thousands of items.
