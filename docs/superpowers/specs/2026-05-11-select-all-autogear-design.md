# Select All for Autogear — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

## Summary

Add "Select All" / "Autogear All" buttons in two places:

1. **StarredShipAlerts** (floating bottom-right panel) — a button to send all starred ships with missing gear to autogear at once.
2. **GearSuggestionTargets** (in-page autogear panel) — a button to load all suggested next targets into the autogear queue at once.

Both replace the entire `selectedShips` array (not append).

---

## 1. StarredShipAlerts

**File:** `src/components/starred/StarredShipAlerts.tsx`

- When `alertShips.length >= 2`, render an "Autogear All" button in the panel header alongside the existing minimize button.
- Clicking it calls `navigate('/autogear?shipIds=id1,id2,...')` with all `alertShips` IDs joined by comma.
- When `alertShips.length === 1`, the button is omitted — the individual ship row click already handles that case.

---

## 2. AutogearPage — URL param initialization

**File:** `src/pages/manager/AutogearPage.tsx`

Extend the existing `useEffect` that reads `shipId` from search params:

- Read both `shipId` and `shipIds` from `searchParams` at the top of the effect, before the `window.history.replaceState` call. (`searchParams` is a React Router snapshot — `replaceState` only clears the browser URL bar and does not invalidate it.)
- **Precedence:** if `shipIds` is present, it takes priority; `shipId` is ignored. Only fall through to the `shipId` path if `shipIds` is absent.
- If `shipIds` is present: split on `,`, look up each ID via `getShipById`, filter out any not found. If the resulting array is empty (all IDs failed to resolve), bail out silently — do not change `selectedShips`. Otherwise set `selectedShips` to the resolved array.
- There is no cap on the number of ships loaded — the autogear queue has no hard limit and run time scales linearly.
- For each resolved ship, call `getConfig(shipId)` (from `useAutogearConfig`). `getConfig` returns `null`/`undefined` when no saved config exists. If truthy, call `updateShipConfig(shipId, { ...savedConfig, fleetBuffs: savedConfig.fleetBuffs ?? [] })`. The `fleetBuffs` normalization mirrors the existing singular-path behavior (line 317–324 of the current init effect). The functional updater in `setShipConfigs` correctly chains across multiple synchronous calls.
- Show the "Loaded saved configuration" notification exactly once after the loop if at least one saved config was found. Do not call it per-ship.
- `shipId` (singular) path is unchanged — it already does the `fleetBuffs` normalization and shows the notification.

---

## 3. GearSuggestionTargets

**File:** `src/components/autogear/GearSuggestionTargets.tsx`

`GearSuggestionTarget` type: `{ ship: Ship; emptySlotCount: number; isDonor: boolean }` — `ship` is always non-null.

- Add optional prop: `onSelectAll?: (ships: Ship[]) => void`. Intentionally optional — if omitted, the "Select All" button simply does not render (no error).
- When `targets.length >= 2` and `onSelectAll` is provided, render a `<Button variant="secondary" size="xs">Select All</Button>` in the component header alongside the existing dismiss button.
- Clicking it calls `onSelectAll` with all `target.ship` values.

**File:** `src/pages/manager/AutogearPage.tsx`

- Implement `handleSelectAllSuggestionTargets(ships: Ship[])` which:
  1. Calls `setSelectedShips(ships)` — replaces the entire queue.
  2. For each ship, calls `getConfig(ship.id)` and, if a saved config exists, calls `updateShipConfig(ship.id, { ...savedConfig, fleetBuffs: savedConfig.fleetBuffs ?? [] })`. This matches what `handleShipSelect` does for single-ship selection.
- Pass `handleSelectAllSuggestionTargets` as the `onSelectAll` prop to `GearSuggestionTargets`.

---

## Behavior Notes

- "Select All" in both places **replaces** `selectedShips` entirely and loads saved configs for each ship — consistent with how `handleShipSelect` works for single-ship selection everywhere.
- No new state, storage, or context is introduced.
- The `shipIds` URL param is cleared by the existing `window.history.replaceState` call (visual URL cleanup only).
