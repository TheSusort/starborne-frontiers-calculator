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

Inside the first inventory `.filter()` block, insert the new check **after** the closing `return false;` of the `isImplant && !shipConfig.optimizeImplants` guard and **before** the `usedGearIds.has(gear.id)` check:

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

### 3a. TweakView type and openForm signature extension

**File:** `src/components/autogear/AutogearSettings.tsx`

Extend the `TweakView` union to include the new form type:

```typescript
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant'; editIndex: number | null };
```

Also widen the `openForm` function's `type` parameter to match:

```typescript
const openForm = (
    type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant',
    editIndex: number | null = null
) => setTweakView({ mode: 'form', type, editIndex });
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
- An "Add" `Button` that submits and calls `onAddExcludedImplantType`, then calls `backToList()`.

### 3d. List view — new section

Add an "Excluded implants" section in the list view, rendered below the existing tweak groups when `excludedImplantTypes.length > 0`:

- Heading: `Excluded implants` (same style as existing group headings).
- Each entry is a row showing the implant type name with a remove button.
- No move up/down — order is irrelevant for an exclusion list.
- The existing "Order matters — higher tweaks weigh more." footnote applies to the ordered groups only. Keep it positioned after those groups and before the "Excluded implants" section, or scope its text to clarify it refers to stat priorities, set requirements, and scales.

### 3e. Tweak count badge

Update the count in the "Your tweaks" header to include `excludedImplantTypes.length`:

```typescript
priorities.length + setPriorities.length + statBonuses.length + excludedImplantTypes.length
```

Also update the empty-state check accordingly:

```typescript
priorities.length + setPriorities.length + statBonuses.length + excludedImplantTypes.length === 0
```

### 3f. New props on AutogearSettings and AutogearSettingsModal

Add to both `AutogearSettingsProps` (`AutogearSettings.tsx`) **and** `AutogearSettingsModalProps` (`AutogearSettingsModal.tsx`), since the modal is a thin wrapper that re-exports all props:

```typescript
availableImplantTypes: { key: string; name: string }[];  // implant types present in inventory
excludedImplantTypes: string[];
onAddExcludedImplantType: (key: string) => void;
onRemoveExcludedImplantType: (key: string) => void;
```

`AutogearSettingsModal` passes all props through to `AutogearSettings` via spread — no additional logic needed there.

### 3g. AutogearPage wiring

**File:** `src/pages/manager/AutogearPage.tsx`

**Local state type and defaults:**

The `shipConfigs` state has an inline type (around lines 111–130) and a `getShipConfig` defaults object (around lines 210–226). Both must include the new field:

```typescript
// In the inline type:
excludedImplantTypes: string[];

// In getShipConfig defaults:
excludedImplantTypes: [],
```

**Derive `availableImplantTypes`:**

Scan inventory for items where `slot.startsWith('implant_')` and `setBonus` is non-null. Collect unique `setBonus` values and map each to `{ key, name }`. Because `gear.setBonus` is typed as `GearSetName | null` (a union wider than `keyof typeof IMPLANTS`), cast to `string` before looking up in `IMPLANTS`:

```typescript
const availableImplantTypes = useMemo(() => {
    const seen = new Set<string>();
    const result: { key: string; name: string }[] = [];
    for (const gear of inventory) {
        if (!gear.slot.startsWith('implant_') || !gear.setBonus) continue;
        const key = gear.setBonus as string;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ key, name: IMPLANTS[key]?.name ?? key });
    }
    return result;
}, [inventory]);
```

**Event handlers:**

```typescript
onAddExcludedImplantType={(key) => {
    const config = getShipConfig(shipSettings.id);
    updateShipConfig(shipSettings.id, {
        excludedImplantTypes: [...(config.excludedImplantTypes ?? []), key],
    });
}}
onRemoveExcludedImplantType={(key) => {
    const config = getShipConfig(shipSettings.id);
    updateShipConfig(shipSettings.id, {
        excludedImplantTypes: (config.excludedImplantTypes ?? []).filter(k => k !== key),
    });
}}
```

**Persistence config literal:**

The config literal built before `saveConfig` (around lines 445–459) explicitly enumerates all fields. Add `excludedImplantTypes` to it:

```typescript
excludedImplantTypes: shipConfig.excludedImplantTypes ?? [],
```

Without this, the field will be silently dropped on save.

**`onResetConfig` handler:**

The `onResetConfig` handler (passed to `<AutogearSettingsModal onResetConfig={...}>`, around lines 1368–1382) contains its own hardcoded object that resets every field to its default. Add `excludedImplantTypes: []` to that object. Without it, clicking "Reset to role defaults" will leave the ship's excluded implant types intact instead of clearing them.

---

## 4. Out of Scope

- Excluding implants globally across all ships (this is per-ship config).
- Excluding specific implant instances by ID (type-level exclusion is sufficient).
- Excluding implants from non-autogear contexts (vault, gear manager).
- Edit mode for excluded implant entries (remove and re-add is sufficient).
