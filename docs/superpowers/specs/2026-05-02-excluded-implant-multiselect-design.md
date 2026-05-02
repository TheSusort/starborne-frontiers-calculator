# Excluded Implant Types — Multi-Select Design Spec

**Date:** 2026-05-02
**Status:** Approved

## Problem

The initial "Excluded implant type" tweak requires one trip through the picker flow per implant type. Users with several implant types to exclude must repeat the Add tweak flow for each one.

## Solution

Replace the single-select form with a `CheckboxGroup` so users can exclude multiple implant types in one step.

---

## 1. Handler Signature Change

**Files:** `src/components/autogear/AutogearSettings.tsx`, `src/components/autogear/AutogearSettingsModal.tsx`, `src/pages/manager/AutogearPage.tsx`

Rename and widen the add handler from:
```typescript
onAddExcludedImplantType: (key: string) => void
```
to:
```typescript
onAddExcludedImplantTypes: (keys: string[]) => void
```

Calling the old single-key handler in a loop has a stale-state race condition: each call to `updateShipConfig` reads the same pre-update `shipConfigs` snapshot, so only the last key would persist. A single call with all keys avoids this entirely.

The remove handler (`onRemoveExcludedImplantType`) is unchanged — removing one type at a time remains correct.

---

## 2. AutogearPage Handler Update

**File:** `src/pages/manager/AutogearPage.tsx`

Replace the existing `onAddExcludedImplantType` prop on `<AutogearSettingsModal>` with `onAddExcludedImplantTypes`:

```typescript
onAddExcludedImplantTypes={(keys) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            excludedImplantTypes: [
                ...(config.excludedImplantTypes ?? []),
                ...keys.filter((k) => !(config.excludedImplantTypes ?? []).includes(k)),
            ],
        });
    }
}}
```

The filter deduplicates in case the user somehow passes keys that are already excluded.

---

## 3. ExcludedImplantForm Replacement

**File:** `src/components/autogear/AutogearSettings.tsx`

Replace the existing `ExcludedImplantForm` (single `Select` + Add button) with a `CheckboxGroup`-based form:

- Import `CheckboxGroup` from `../ui`.
- `options` = `availableImplantTypes` filtered to remove already-excluded types, mapped to `{ value: key, label: name }`.
- Internal state: `selected: string[]` (starts empty).
- "Add selected" `Button` (primary variant) disabled when `selected.length === 0`.
- On submit: call `onAdd(selected)`, navigate back to list.
- Empty state: when `options` is empty (all available types already excluded), render a `<p>` with "All available implant types are already excluded." instead of the checkboxes. The Cancel button remains.

The form prop interface changes from:
```typescript
onAdd: (key: string) => void
```
to:
```typescript
onAdd: (keys: string[]) => void
```

---

## 4. Props Interface Updates

**`AutogearSettingsProps` in `AutogearSettings.tsx`:**
- Remove: `onAddExcludedImplantType?: (key: string) => void`
- Add: `onAddExcludedImplantTypes?: (keys: string[]) => void`

**`AutogearSettingsModalProps` in `AutogearSettingsModal.tsx`:**
- Remove: `onAddExcludedImplantType: (key: string) => void`
- Add: `onAddExcludedImplantTypes: (keys: string[]) => void`

---

## 5. No Changes To

- Data model (`excludedImplantTypes: string[]` stays the same)
- Filtering logic in `AutogearPage.tsx`
- The "Excluded implants" list view (individual rows with Remove buttons)
- The picker option visibility logic
- `onRemoveExcludedImplantType` handler
- Persistence literal and reset handler
