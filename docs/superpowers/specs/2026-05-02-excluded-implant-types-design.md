# Excluded Implant Types — Design Spec

**Date:** 2026-05-02
**Status:** Approved

## Problem

Users may own implants they never want used in autogear for a given ship (e.g. Bulwark creates a control effect that interferes with stasis synergies). Currently there is no way to exclude specific implant types from autogear — users have had to delete the implant after import as a workaround.

## Solution

Add an "Excluded implant type" tweak to the per-ship autogear config. When `optimizeImplants` is enabled, users can pick one or more implant types (by name) to permanently exclude from that ship's autogear runs. This follows the existing tweaks picker/form/list pattern.

---

## 1. Data Model

**File:** `src/types/autogear.ts`

Add one optional field to `SavedAutogearConfig`:

```typescript
excludedImplantTypes?: string[];  // IMPLANTS keys, e.g. ['BULWARK', 'STASIS']
```

- Values are keys from the `IMPLANTS` constant (same value as `gear.setBonus` on an implant `GearPiece`).
- Defaults to `undefined` / `[]` for existing configs — no migration needed.
- No new type required; the field is a plain string array.

---

## 2. Filtering Logic

**File:** `src/pages/manager/AutogearPage.tsx`

Inside the inventory `.filter()`, immediately after the existing `isImplant && !shipConfig.optimizeImplants` guard (line ~487), add:

```typescript
if (isImplant && shipConfig.excludedImplantTypes?.includes(gear.setBonus ?? '')) {
    return false;
}
```

- Runs only for implants (non-implants are unaffected).
- Only reachable when `optimizeImplants` is `true` (the earlier guard short-circuits otherwise).
- Matches on `gear.setBonus`, which holds the IMPLANTS key for every implant GearPiece.

---

## 3. UI

### 3a. TweakView type extension

**File:** `src/components/autogear/AutogearSettings.tsx`

Extend the `TweakView` union to include the new form type:

```typescript
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant'; editIndex: number | null };
```

### 3b. Picker option

In the picker view, add a fourth option **visible only when `optimizeImplants === true`**:

```
Excluded implant type
Prevent a specific implant type from being used in autogear (e.g. Bulwark).
```

Clicking it calls `openForm('excludedImplant')`.

### 3c. ExcludedImplantForm component

A new internal form component in `AutogearSettings.tsx`. Simpler than `SetPriorityForm` — no count field, no edit mode (add/remove only):

- A `Select` dropdown populated from `availableImplantTypes` (see props below), filtered to exclude already-excluded types.
- An "Add" `Button` that submits and calls back to the list.

### 3d. List view — new section

Add an "Excluded implants" section in the list view, rendered below the existing tweak groups when `excludedImplantTypes.length > 0`:

- Heading: `Excluded implants` (same style as existing group headings).
- Each entry is a row showing the implant type name with a remove button.
- No move up/down — order is irrelevant for an exclusion list.

### 3e. Tweak count badge

Update the count in the "Your tweaks" header to include `excludedImplantTypes.length`:

```typescript
priorities.length + setPriorities.length + statBonuses.length + excludedImplantTypes.length
```

### 3f. New props on AutogearSettings

```typescript
availableImplantTypes: { key: string; name: string }[];  // implant types present in inventory
excludedImplantTypes: string[];
onAddExcludedImplantType: (key: string) => void;
onRemoveExcludedImplantType: (key: string) => void;
```

### 3g. AutogearPage wiring

**File:** `src/pages/manager/AutogearPage.tsx`

- Derive `availableImplantTypes` by scanning inventory for items where `slot.startsWith('implant_')` and `setBonus` is set, collecting unique `setBonus` values, and mapping each to `{ key, name: IMPLANTS[key]?.name ?? key }`.
- Pass `excludedImplantTypes` from `shipConfig.excludedImplantTypes ?? []`.
- `onAddExcludedImplantType`: call `updateShipConfig(shipId, { excludedImplantTypes: [...existing, key] })`.
- `onRemoveExcludedImplantType`: call `updateShipConfig(shipId, { excludedImplantTypes: existing.filter(k => k !== key) })`.
- Also pass `excludedImplantTypes` when building the config object passed to the autogear strategy (same pattern as `setPriorities`).

---

## 4. Out of Scope

- Excluding implants globally across all ships (this is per-ship config).
- Excluding specific implant instances by ID (type-level exclusion is sufficient).
- Excluding implants from non-autogear contexts (vault, gear manager).
- Edit mode for excluded implant entries (remove and re-add is sufficient).
