# Unified Implant Type Tweak Design

**Date:** 2026-05-25
**Status:** Approved

## Summary

Merge the two separate autogear tweaks — "Excluded implant type" and "Forced implant type" — into a single "Implant type" tweak entry. Each entry has a mode: **Require** or **Exclude**. A unified list section displays both kinds with a mode badge. The underlying data model is unchanged; only the presentation layer is unified.

## Background

PR #64 (forced-implant-types) introduced `kind: 'implant'` on `SetPriority` to allow users to require a specific implant type to appear in autogear results. This sat alongside the existing `excludedImplantTypes: string[]` feature. The result is two separate picker buttons, two separate form flows, and two separate list sections for what users perceive as one question: "what should autogear do with this implant type?"

## Why UI-Only Unification

`excludedImplantTypes` and `setPriorities[kind='implant']` have different semantics:

- **Excluded** is a hard filter — matching implants never enter the candidate pool (applied in `AutogearPage.tsx` inventory pre-filter ~line 582).
- **Required** is a soft penalty — the optimizer is penalised for loadouts that omit the required type (applied in `calculatePriorityScore`).

Merging the data model would either weaken exclusions (making them soft) or change the semantics of requirements (making them hard). Neither is desirable. The UX problem is purely presentational — two controls that should feel like one feature.

## Data Model

**No changes to `SavedAutogearConfig`.** Both `excludedImplantTypes: string[]` and the `kind?: 'implant'` field on `SetPriority` remain. The form dispatches to the appropriate field based on the selected mode.

**Mutual exclusion in `AutogearPage.tsx` (already implemented, both directions):**
- `onAddSetPriority` (~line 1400): when adding a `kind: 'implant'` entry, removes the same key from `excludedImplantTypes`.
- `onUpdateSetPriority` (~line 1417): same filter applied on update.
- `onSetExcludedImplantTypes` (~line 1496): filters out any `setPriorities` entries with `kind: 'implant'` whose `setName` matches a newly excluded key.

Mode-switching flows (Require→Exclude, Exclude→Require) in the UI rely on this existing mutual exclusion — no new page-level callbacks are needed.

## UI Changes

### 1. Picker (`AutogearSettings.tsx`)

Replace the two implant-related picker buttons with one:

**"Implant type"**
> Require or exclude a specific implant type from autogear results.

Single `onClick={() => openImplantForm(null)}` (see §2). Still gated on `optimizeImplants && availableImplantTypes.length > 0`.

### 2. `TweakView` type and helpers

Replace `'excludedImplant'` and `'implantPriority'` from the `type` union with a single `'implantType'` arm that carries an `editTarget` discriminant:

```ts
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | {
          mode: 'form';
          type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff';
          editIndex: number | null;
      }
    | {
          mode: 'form';
          type: 'implantType';
          editTarget:
              | null                               // adding new entry
              | { kind: 'require'; index: number } // editing a setPriorities require entry
              | { kind: 'exclude'; key: string };  // editing an excludedImplantTypes entry
      };
```

Add a dedicated helper (do not overload the existing `openForm`):

```ts
const openImplantForm = (
    editTarget: (TweakView & { mode: 'form'; type: 'implantType' })['editTarget'] = null
) => setTweakView({ mode: 'form', type: 'implantType', editTarget });
```

Update `isEditingImplantPriority` → `isEditingImplantType`. Require rows call:
```ts
type ImplantEditTarget = Extract<TweakView, { type: 'implantType' }>['editTarget'];

const isEditingImplantType = (target: ImplantEditTarget) => {
    if (tweakView.mode !== 'form' || tweakView.type !== 'implantType') return false;
    const et = tweakView.editTarget;
    if (!et || !target) return et === target;
    if (et.kind !== target.kind) return false;
    return et.kind === 'require' && target.kind === 'require'
        ? et.index === target.index
        : (et as { kind: 'exclude'; key: string }).key === (target as { kind: 'exclude'; key: string }).key;
};
```

### 3. Breadcrumb Add/Edit label

For the `'implantType'` arm there is no `editIndex`. Use `editTarget === null` to determine Add vs. Edit:

```ts
tweakView.type === 'implantType'
    ? `${tweakView.editTarget === null ? 'Add' : 'Edit'} implant type`
    : ...
```

### 4. `SetPriorityForm` — unified implant mode

The component is extended when `mode === 'implantType'` with:

**New state:** `preferenceMode: 'require' | 'exclude'`, defaulting to `'require'`.

**New prop** (optional — only used when `mode === 'implantType'`):
```ts
onSubmitImplant?: (setName: string, preferenceMode: 'require' | 'exclude') => void;
```

The existing `onAdd` and `onSave` remain required for `mode === 'gearSet'`. When `mode === 'implantType'`, the form calls `onSubmitImplant` instead of `onAdd`/`onSave`. `onAdd` and `onSave` are unused for implant mode — callers may pass `onAdd={() => {}}` as a no-op or make them optional when `mode === 'implantType'` (up to implementer; since `SetPriorityForm` is a local non-exported component, the internal call site in `AutogearSettings` controls this).

**Mode selector UI:** A `Select` component above the implant type dropdown:
```tsx
<Select
    label="Preference"
    options={[
        { value: 'require', label: 'Require' },
        { value: 'exclude', label: 'Exclude' },
    ]}
    value={preferenceMode}
    onChange={(v) => setPreferenceMode(v as 'require' | 'exclude')}
/>
```

**New props for edit pre-population** (mutually exclusive — pass one or the other, not both):
- `editingValue?: SetPriority` — for editing a Require entry (`kind: 'implant'`); initializes `selectedSet = editingValue.setName`, `preferenceMode = 'require'`
- `editingExcludeKey?: string` — for editing an Exclude entry; initializes `selectedSet = editingExcludeKey`, `preferenceMode = 'exclude'`

Both are optional; when neither is provided, the form is in "add new" mode.

**On submit**, call `onSubmitImplant(selectedSet, preferenceMode)`.

The parent (`AutogearSettings`) dispatches based on mode — see §6 Edit Flows.

### 5. List: unified "Implant types" section

Remove the two separate sub-sections ("Required implants" and "Excluded implants"). Add one **"Implant types"** section, conditionally rendered when `implantAbsoluteIndices.length > 0 || excludedImplantTypes.length > 0`.

**Render order:** Required entries (from `setPriorities` filtered by `kind === 'implant'`, preserving absolute index logic) first, then excluded entries (from `excludedImplantTypes`).

**Require rows** — same as current "Required implants" sub-group using `SetPriorityRow`, with `modeLabel="Require"` passed as a new optional prop (see §7). Move up/down preserved within the require sub-group.

**Exclude rows** — inline render: label + "Exclude" badge + Edit button + Remove button. No move buttons (order is irrelevant for hard-filter exclusions). Edit calls `openImplantForm({ kind: 'exclude', key })`.

**Mode badge implementation** — a `<span>` rendered by `SetPriorityRow` via the new `modeLabel` prop (require rows), and inline for exclude rows:
```tsx
<span className="text-xs text-theme-text-secondary border border-dark-border rounded px-1">
    {mode}
</span>
```

### 6. Edit Flows

**Add new entry**
- `openImplantForm(null)` → form opens with `preferenceMode = 'require'`, no pre-selected type.
- On submit (require): `onAddSetPriority({ setName, count: 1, kind: 'implant' })`
- On submit (exclude): `onSetExcludedImplantTypes([...excludedImplantTypes, setName])`

**Edit a Require entry**
- `openImplantForm({ kind: 'require', index: absoluteIndex })`
- Form pre-populates from `setPriorities[absoluteIndex]`: `preferenceMode = 'require'`, `selectedSet = priority.setName`
- Save as Require (name changed): `onUpdateSetPriority(absoluteIndex, { setName: newSetName, count: 1, kind: 'implant' })`
- Save as Exclude (mode switch): `onSetExcludedImplantTypes([...excludedImplantTypes, newSetName])` — `onSetExcludedImplantTypes` in AutogearPage auto-removes the matching `setPriorities` entry (line ~1496).

**Edit an Exclude entry**
- `openImplantForm({ kind: 'exclude', key })`
- Form pre-populates: `preferenceMode = 'exclude'`, `selectedSet = key`
- Save as Exclude (name changed): 
  ```ts
  onSetExcludedImplantTypes(
      Array.from(new Set([...excludedImplantTypes.filter(k => k !== key), newKey]))
  )
  ```
  The `Set` deduplicates in case `newKey` is already in the list.
- Save as Require (mode switch): `onAddSetPriority({ setName: newKey, count: 1, kind: 'implant' })` — `onAddSetPriority` in AutogearPage auto-removes the matching `excludedImplantTypes` entry (line ~1401).

### 7. `SetPriorityRow.tsx`

Add optional `modeLabel?: string` prop. When present, render a small badge after the label text, before the edit/move controls:

```tsx
{modeLabel && (
    <span className="text-xs text-theme-text-secondary border border-dark-border rounded px-1 ml-1">
        {modeLabel}
    </span>
)}
```

Gear-set rows pass no `modeLabel`. Require implant rows pass `modeLabel="Require"`.

### 8. Helpers

Replace `isEditingImplantPriority` with `isEditingImplantType` (see §2 for implementation). Remove `isEditingImplantPriority`.

### 9. Tweaks count heading

The count formula `priorities.length + setPriorities.length + statBonuses.length + fleetBuffs.length + excludedImplantTypes.length` is unchanged and remains accurate. Note: `setPriorities` already includes `kind: 'implant'` entries — no separate term is needed for required implants.

### 10. `ExcludedImplantForm` removal

`ExcludedImplantForm` (checkbox-group multi-select) is deleted. **This is an intentional UX change**: exclusions now use the same one-at-a-time add flow as all other tweaks, consistent with gear-set requirements, stat limits, fleet buffs, etc. Users who previously excluded 3–4 types in one modal session will now add them individually. Existing excluded entries are still removed individually via the X button on each row.

### 11. `AutogearConfigList.tsx`

Add `excludedImplantTypes?: string[]` prop to `AutogearConfigListProps`.

Update the `hasConfig` gate (currently line 34–43) to include excluded implant types:
```ts
const hasConfig =
    statPriorities.length > 0 ||
    setPriorities.length > 0 ||
    statBonuses.length > 0 ||
    fleetBuffs.length > 0 ||
    (excludedImplantTypes?.length ?? 0) > 0 || // add this line
    optimizeImplants ||
    ignoreEquipped ||
    ignoreUnleveled ||
    useUpgradedStats ||
    tryToCompleteSets;
```

Display excluded types in the compact chip row:
```tsx
{(excludedImplantTypes ?? []).map((key) => (
    <span key={key}>
        Excl. {IMPLANTS[key]?.name ?? key}
    </span>
))}
```

**Call site:** `AutogearConfigList` is rendered in `AutogearQuickSettings.tsx` (line 88) via `{...getShipConfig(ship.id)}`. Since `getShipConfig` returns `SavedAutogearConfig` which includes `excludedImplantTypes?: string[]`, the spread already passes the new prop automatically once it is added to the interface. No changes required in `AutogearQuickSettings.tsx` or `AutogearPage.tsx`.

## Files Changed

| File | Change |
|------|--------|
| `src/components/autogear/AutogearSettings.tsx` | TweakView type, remove ExcludedImplantForm, extend SetPriorityForm with mode select and new props, add openImplantForm helper, merge list sections, update picker, update breadcrumb |
| `src/components/autogear/SetPriorityRow.tsx` | Add optional `modeLabel?: string` prop |
| `src/components/autogear/AutogearConfigList.tsx` | Add `excludedImplantTypes?` prop, update `hasConfig` gate, display excluded types in summary |

## Not in Scope

- No changes to `AutogearPage.tsx` callbacks (existing mutual-exclusion handles all mode-switch flows)
- No changes to `AutogearSettingsModal.tsx`
- No changes to `AutogearQuickSettings.tsx` (spread pattern auto-passes `excludedImplantTypes`)
- No changes to scoring (`priorityScore.ts`, `scoring.ts`, `fastScore.ts`)
- No changes to inventory filtering logic
- No migration of saved configs (both fields remain)
- No changes to `SavedAutogearConfig` type
