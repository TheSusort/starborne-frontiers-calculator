# Starred Ships & Gear Alerts

## Problem

When autogear moves gear from one ship to another, the donor ships are left with empty slots. The confirmation modal shows which ships will lose gear, but that information is lost after confirming. Users forget which ships were stripped and only discover the gaps when those ships underperform in combat.

The existing equipment lock system prevents gear from being taken, but doesn't help after the fact — and users sometimes intentionally unlock everything for a clean-slate regear.

## Solution

Two complementary features:

1. **Starred ships with persistent alert panel** — a long-term safety net that warns whenever important ships have missing gear
2. **Post-equip suggestion list** — an immediate workflow helper that shows donor ships after equipping and lets users quickly select them as the next autogear target

---

## Feature 1: Starred Ships & Persistent Alert Panel

### Data Model

Add `starred?: boolean` to the `Ship` type, following the same pattern as `equipmentLocked`:

- New field on `Ship` interface: `starred?: boolean`
- New column on Supabase `ships` table: `starred boolean default false`
- New context functions: `toggleStarred(shipId)` in `ShipsContext`
- Persisted to Supabase for authenticated users, localStorage for unauthenticated

**"Missing gear" definition:** A ship is considered "missing gear" if any of its 6 main equipment slots (weapon, hull, generator, sensor, software, thrusters) are empty. A slot is empty if the key is absent from the `equipment` record or the value is falsy.

Implant slots are excluded from this check. Most ships don't have all 5 implant slots filled, which would cause persistent false positives for nearly every starred ship. Implant tracking can be revisited as a future enhancement.

The `starred` field is preserved during data reimport, following the same behavior as `equipmentLocked` — existing ships retain their starred state when deduplicated during import.

### Star Toggle UI

The star toggle appears in three locations:

- **Ship cards** (ships list page): Small star icon in the card corner, toggles on click
- **Autogear page ship selector**: Star icon next to each selected ship's name in the multi-ship selection area
- **GearSuggestions component**: Star icon next to the existing lock icon button

Visual states:
- Starred: filled star icon
- Unstarred: outline star icon

Same interaction pattern as the existing lock toggle (click to toggle, persists immediately).

### Persistent Alert Panel

A new `StarredShipAlerts` component rendered at the app layout level in `App.tsx`, separate from the existing toast notification system.

**Position:** Fixed, bottom-right of the screen (`bottom-4 right-4`). Uses `z-40` to stay below modals (`z-60`/`z-80`), offcanvas (`z-70`), and tutorial overlay (`z-100+`), but above normal page content. On mobile (below `sm` breakpoint), renders as a compact bottom bar instead of a side panel.

**Content:**
- Lists all ships where `starred === true` AND at least one of the 6 main gear slots is empty
- Each entry shows: ship name and number of empty gear slots (e.g., "Aurora — 3 empty slots")
- Clicking an entry navigates to the autogear page with that ship pre-selected via `?shipId=`

**Minimize behavior:**
- Minimize button collapses the panel to a small tab on the right edge showing just the count (star icon + number)
- Minimized/expanded state persisted to localStorage key `starred_alerts_minimized`
- The panel does NOT auto-un-minimize. The minimized badge count is sufficient to draw attention to changes. User controls the panel state.
- Panel disappears entirely when no starred ships have missing gear (nothing to show)

**Not a toast notification:** This is a persistent status panel with its own component and state management, completely separate from `NotificationProvider`/`NotificationContainer`.

---

## Feature 2: Post-Equip Suggestion List

### Trigger

Appears on the autogear page after the user clicks "Equip All Suggestions" and confirms the gear movement modal.

### Content

Two sources, combined and deduplicated:

1. **Donor ships** — ships that just lost gear from the equip action (already computed as `gearMovements` in the confirmation modal)
2. **Starred ships with missing gear** — any starred ship with empty slots, excluding the ship that was just equipped

If a donor ship is also starred, it appears once (no duplicates).

### UI

- Rendered inline on the autogear page, below or in place of the suggestions area after equipping
- Each entry shows: ship image, ship name, number of empty slots, and a "Select" button
- Clicking "Select" sets that ship as the active autogear target (same effect as choosing it from the ship selector dropdown). This also loads the ship's saved autogear config if one exists, matching the normal ship selector behavior. The user can then adjust settings before running.
- Dismissible via a close/clear button — this is a workflow helper, not a persistent nag
- List clears automatically when a new autogear run starts or when dismissed manually

### Data Shape

Each entry in the combined suggestion list uses a unified type:

```typescript
interface GearSuggestionTarget {
  ship: Ship;
  emptySlotCount: number;
  isDonor: boolean; // true if this ship lost gear in the last equip action
}
```

### Data Flow

1. User clicks "Equip All Suggestions" → confirmation modal shows gear movements
2. User confirms → gear is applied via `equipMultipleGear()`
3. Instead of discarding `gearMovements`, map donor ships to `GearSuggestionTarget[]` (with `isDonor: true`)
4. Merge with starred ships that have missing gear (with `isDonor: false`), deduplicating by ship ID (donors take precedence so `isDonor` stays `true`)
5. Render the combined suggestion list
6. User clicks "Select" on a ship → ship becomes the autogear target, suggestion list remains visible until dismissed or a new run starts

---

## Scope Boundaries

**In scope:**
- `starred` boolean on ships (data model, context, persistence)
- Star toggle in ship cards, autogear ship selector, and GearSuggestions
- Persistent alert panel component with minimize/expand behavior
- Post-equip suggestion list on autogear page
- Supabase migration for `starred` column

**Out of scope:**
- Changes to the autogear algorithm itself
- Changes to the equipment lock system
- Gear-level starring (only ship-level)
- Automatic autogear execution for donor ships
- Any changes to the gear movement confirmation modal
