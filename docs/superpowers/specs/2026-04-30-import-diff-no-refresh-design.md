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
- Call `loadShips()` + `loadInventory()` from the contexts (fire them in parallel with `Promise.all`).
- These re-fetch from Supabase, populate `imageKey`, and update the contexts via their existing loading states.
- No page reload.

**Authenticated users (if `syncMigratedDataToSupabase` fails):**
- Show the existing error notification (same as current behaviour).
- Do NOT open the diff modal — local state was updated but cloud sync failed, which is an error state.
- Do NOT reload.

**Unauthenticated users:**
- `setShips`, `setInventory`, and `setEngineeringStats` already update React state synchronously via `useStorage.setData`.
- No reload or extra fetch needed.

### Changes to ImportButton

- Import `loadShips` from `useShips()` and `loadInventory` from `useInventory()` alongside the existing `setData` aliases.
- Remove `refreshPage` callback entirely.
- Replace the two `refreshPage(...)` callsites (success path) with the diff modal trigger described in Part 3.
- Remove the "refreshing in 3 seconds…" success notification; the diff modal IS the success confirmation.

---

## Part 2: Diff Computation

### Snapshot timing

At the top of `processFileImport`, before calling `importPlayerData`, capture:

```typescript
const oldShips = ships;        // from useShips() — the current context value
const oldInventory = inventory; // from useInventory() — the current context value
```

After `importPlayerData` returns `result`, compute the diff using:
- `oldShips` / `oldInventory` as the "before" state (the context snapshot taken before import)
- `result.data.ships` / `result.data.inventory` as the "after" state (the freshly transformed import result)

**Do not read context state again after `setData` calls** — for authenticated users, `loadShips`/`loadInventory` will overwrite context state with Supabase data, which would invalidate the diff. The diff is always computed from the import result directly.

### New type: `ImportDiff` (`src/types/importDiff.ts`)

```typescript
import { Ship } from './ship';
import { GearPiece } from './gear';
import { RarityName } from '../constants/rarities';

export interface LeveledShip {
  ship: Ship;       // the new (post-import) ship
  oldLevel: number;
}

export interface RefittedShip {
  ship: Ship;       // the new (post-import) ship
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
      added: number;   // gross count of epics new in this import (by ID)
      removed: number; // gross count of epics absent from this import (by ID)
    };
    otherDelta: number; // (# added non-legendary/non-epic) - (# removed non-legendary/non-epic)
  };
  gear: {
    added: number;                  // gross pieces new in this import (by ID)
    removed: number;                // gross pieces absent from this import (by ID)
    newLegendary6Star: GearPiece[]; // subset of new pieces: rarity==='legendary' && stars===6
  };
}
```

### New utility: `computeImportDiff` (`src/utils/import/computeImportDiff.ts`)

```typescript
export function computeImportDiff(
  oldShips: Ship[],
  oldInventory: GearPiece[],
  newShips: Ship[],
  newInventory: GearPiece[]
): ImportDiff
```

**Ship matching:** by `ship.id`. Build `Map<id, Ship>` for old and new.

**For each ship in new:**
- Not in old map → "added". Bucket by rarity:
  - `legendary` → push to `legendary.added`
  - `epic` → increment `epic.added`
  - other → increment a local `otherAdded` counter
- In old map:
  - `newShip.level > oldShip.level` → push to `leveled` for legendary/epic
  - `newShip.refits.length > oldShip.refits.length` → push to `refitted` for legendary/epic
  - A ship that was both leveled AND refitted appears in **both** lists — this is intentional and both rows are rendered in the modal.

**For each ship in old not in new:**
- `legendary` → push `{ name, rarity }` to `legendary.removed`
- `epic` → increment `epic.removed`
- other → increment a local `otherRemoved` counter

`otherDelta = otherAdded - otherRemoved`

**Gear matching:** by `gear.id`. Both `oldInventory` (from context) and `result.data.inventory` (from the import) contain a mix of gear and implants. **Implants are excluded from all gear diff values** — filter both arrays to only pieces whose `slot` is in `Object.keys(GEAR_SLOTS)` before computing anything.
- `added` = count of gear IDs (non-implant) in new not in old
- `removed` = count of gear IDs (non-implant) in old not in new
- `newLegendary6Star` = new gear pieces (non-implant, id not in old) where `rarity === 'legendary' && stars === 6`

### `hasChanges` helper

```typescript
export function hasChanges(diff: ImportDiff): boolean {
  const { ships, gear } = diff;
  return (
    ships.legendary.added.length > 0 ||
    ships.legendary.leveled.length > 0 ||
    ships.legendary.refitted.length > 0 ||
    ships.legendary.removed.length > 0 ||
    ships.epic.leveled.length > 0 ||
    ships.epic.refitted.length > 0 ||
    ships.epic.added > 0 ||
    ships.epic.removed > 0 ||
    ships.otherDelta !== 0 ||
    gear.added > 0 ||
    gear.removed > 0 ||
    gear.newLegendary6Star.length > 0
  );
}
```

---

## Part 3: ImportDiffModal (`src/components/import/ImportDiffModal.tsx`)

Uses the existing `Modal` component.

### Modal state

`ImportButton` holds `const [diffResult, setDiffResult] = useState<ImportDiff | null>(null)`. Pass it to `ImportDiffModal` as `diff={diffResult}` and `onClose={() => setDiffResult(null)}`. `ImportDiffModal` accepts `diff: ImportDiff | null` and `onClose: () => void` — it derives `isOpen` internally as `diff !== null`. No separate `isOpen` prop is passed from `ImportButton`.

### When to open (in `processFileImport`)

1. Snapshot `oldShips` / `oldInventory` from context at the top of the function. Add `ships` and `inventory` to the `useShips()` / `useInventory()` destructurings alongside `setData`, `loadShips`, and `loadInventory`.
2. Run import + `setData` calls as today.
3. Compute `diff = computeImportDiff(oldShips, oldInventory, result.data.ships, result.data.inventory)`. The diff uses `result.data` directly — not context state — so it is not affected by async storage writes.
4. **Call `setDiffResult(diff)` unconditionally** — outside both the `if (user)` and the unauthenticated else branch — so the modal opens for every successful import. This is after `result.success && result.data` is confirmed but before/outside the sync block.
5. **For authenticated users, inside `if (user) { if (syncResult.success) { ... } }`:** fire `void Promise.all([loadShips(), loadInventory()])` — non-blocking. The modal is already open; fresh Supabase data (including ship `imageKey`) loads in the background. `loadInventory` will emit its own "Syncing gear…" / "Loaded N gear pieces" notifications — this is acceptable UX alongside the diff modal.

**`shareData` path:** `refreshPage` currently skips the reload when `shareData` is true. With the new design, remove `refreshPage` entirely — the diff modal opens on every successful import regardless of `shareData`.

The modal is non-blocking. `loadShips`/`loadInventory` complete in the background; the user sees updated ships/gear when they navigate after closing the modal.

### Layout

```
┌─ Import Complete ────────────────────────────────────┐
│                                                       │
│  Ships                                                │
│  ─ Legendary ─────────────────────────────────────── │
│    + Vanguard Prime          (new)                    │
│    Bulwark of Dawn           55 → 60                  │
│    Iron Sentinel             R2 → R3                  │
│    Iron Sentinel             R2 → R3 · 52 → 60        │  ← leveled+refitted: both rows shown
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

**Visibility rules:**
- Ships section: omit entirely if no legendary/epic/other changes.
- A rarity sub-section (Legendary / Epic / Other): omit if that sub-section is empty.
- Epic summary line (`+N new · -N removed`): always shown when `added > 0 || removed > 0`, even when individual leveled/refitted rows are also present.
- Other line: omit if `otherDelta === 0`.
- Gear section: omit if `added === 0 && removed === 0 && newLegendary6Star.length === 0`.
- If `!hasChanges(diff)`: render "No changes detected." instead of any sections.
- Ship name entries use `RARITIES[ship.rarity].textColor` for the name.
- Legendary 6-star gear lines show: stars (★ repeated `stars` times), rarity label (`RARITIES[gear.rarity].label`), slot label (`GEAR_SLOTS[gear.slot].label`), and set name (`GEAR_SETS[gear.setBonus].name`). If `setBonus` is `null`, omit the set name and brackets entirely.

---

## New Files

| File | Purpose |
|------|---------|
| `src/types/importDiff.ts` | `ImportDiff`, `LeveledShip`, `RefittedShip`, `RemovedShip` types |
| `src/utils/import/computeImportDiff.ts` | `computeImportDiff` + `hasChanges` |
| `src/components/import/ImportDiffModal.tsx` | Modal component |

## Modified Files

| File | Change |
|------|--------|
| `src/components/import/ImportButton.tsx` | Remove `refreshPage`, add `loadShips`/`loadInventory`, snapshot + compute diff, open modal |

## Out of Scope

- The existing JSON Diff Calculator page (`/json-diff`) is untouched — it solves a different problem (manual raw-export comparison).
- Engineering stats diff — changes here are rare and low value to surface in a summary.
- Gear individual diff beyond legendary 6-star highlights — inventory can be thousands of items.
- Loading indicator while `loadShips`/`loadInventory` run — both contexts already show their own loading states on their respective pages.
