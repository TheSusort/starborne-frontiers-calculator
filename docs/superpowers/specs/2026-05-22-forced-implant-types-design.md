# Forced Implant Types in Autogear

**Date:** 2026-05-22  
**Status:** Approved

## Summary

When "Optimize implants" is enabled in autogear, allow users to force a specific implant type (family) to be included in the optimized loadout. Reuses the `setPriorities` array and penalty machinery. Requires small additions to both scoring paths to include implant setBonus values in `setCount`, plus an orphan-penalty `continue` guard that becomes necessary as a direct consequence.

## Data Layer

**One field added to `SetPriority`:** add optional `kind?: 'implant'` to the existing `SetPriority` interface in `src/types/autogear.ts`. Gear-set entries leave `kind` undefined (backward compatible with existing saved configs). Implant-type entries set `kind: 'implant'`.

```ts
export interface SetPriority {
    setName: string;
    count: number;
    kind?: 'implant'; // present only for forced-implant entries
}
```

Everywhere the spec previously used `!GEAR_SETS[p.setName]` to detect implant entries, use `p.kind === 'implant'` instead. This is the only reliable discriminant — `AMBUSH` exists in both `GEAR_SETS` and `IMPLANTS`, so the `!GEAR_SETS[name]` predicate would misclassify a forced-implant AMBUSH entry as a gear-set entry.

**Mutual exclusion:** Saving an implant-type entry to `setPriorities` removes it from `excludedImplantTypes`. Saving to `excludedImplantTypes` removes matching `kind === 'implant'` entries from `setPriorities`. UI-enforced only.

**`count: 0`:** UI hardcodes `count: 1` for implant entries, never shows count editing on implant rows. `count: 0` cannot occur for implant entries. No guard needed on the existing inventory exclusion filter.

**`AMBUSH` dual-entry:** A user can simultaneously have `{ setName: 'AMBUSH', count: 2 }` (gear) and `{ setName: 'AMBUSH', count: 1, kind: 'implant' }` (forced implant) in `setPriorities`. Dedup is scoped by `kind`, so these coexist correctly.

**`setBonus` key convention:** Implant gear items use top-level `IMPLANTS` keys (e.g. `setBonus: 'HASTE'`, not `'HASTE_SIGMA'`). `IMPLANTS[key]?.name` is a reliable label fallback.

## Scoring Layer

Three changes required. The core design uses a separate `implantSetCount` accumulator so the orphan-penalty loop stays gear-only and AMBUSH (the only name that exists in both `GEAR_SETS` and `IMPLANTS`) cannot inflate orphan counts.

### Why changes are needed

Both scoring paths exclude implant setBonus values from `setCount`:
- **Slow path** (`scoring.ts`): `setCount` built from `gearOnly`; `ship.implants` never iterated.
- **Fast path** (`fastScore.ts`): `workspace.setCount` incremented for `gearIds` only; implants applied via `addPieceStatsInto` with no `setCount` side effect.

Without implant contributions, `calculatePriorityScore` reads 0 for implant-type priority entries so the penalty fires unconditionally and the constraint can never be satisfied.

**Why a separate accumulator (not merged into `setCount`):** Merging implant set bonuses directly into `setCount` would cause AMBUSH to inflate the orphan penalty: an AMBUSH implant + 0 AMBUSH gear gives `setCount['AMBUSH'] = 1`, triggering `1 % 2 = 1` orphan. Keeping implant counts in a separate `implantSetCount` that only feeds the requirement penalty avoids this entirely, and the orphan loop remains correct without any guard changes.

### Fix 1 — Slow path (`scoring.ts`, after the gear `setCount` loop ~line 240)

Build a separate `implantSetCount` (do NOT add to `setCount`):

```ts
// Build implantSetCount separately — keeps setCount gear-only for the orphan penalty loop
const implantSetCount: Record<string, number> = {};
if (ship.implants) {
    for (const gearId of Object.values(ship.implants)) {
        if (!gearId) continue;
        const gear = getGearPiece(gearId);
        if (!gear?.setBonus) continue;
        implantSetCount[gear.setBonus] = (implantSetCount[gear.setBonus] || 0) + 1;
    }
}
```

Pass `implantSetCount` to `calculatePriorityScore` — see Fix 3.

### Fix 2 — Fast path (`fastScore.ts`, after the gear `setCount` loop lines 88–91, before `// Arcane siege`)

Build a separate `implantSetCount`. **Do not add to `setCount`** — `workspace.setCount` is gear-only and the orphan loop must stay that way:

```ts
// Build implantSetCount separately using implantRegistry (independent integer namespace from gearRegistry)
const implantSetCount: Record<string, number> = {};
for (let i = 0; i < effectiveImplantIds.length; i++) {
    const id = effectiveImplantIds[i];
    if (id < 0) continue;
    const setId = context.implantRegistry.setIds[id];
    if (setId !== 0) {
        const name = context.implantRegistry.setIdToName[setId];
        if (name) implantSetCount[name] = (implantSetCount[name] || 0) + 1;
    }
}
```

Pass `implantSetCount` to `calculatePriorityScore` — see Fix 3.

### Fix 3 — `calculatePriorityScore` (`priorityScore.ts`)

Add an optional `implantSetCount?: Record<string, number>` parameter (after `arcaneSiegeMultiplier`). In the set-requirement penalty section (~line 405), combine gear and implant counts:

```ts
const currentCount =
    (setCount[setPriority.setName] || 0) +
    (implantSetCount?.[setPriority.setName] || 0);
if (currentCount < setPriority.count) { ... }
```

The orphan-penalty loop (~line 424) is unchanged — it continues to iterate only `setCount` (gear-only), so AMBUSH implants do not inflate orphan counts.

## UI Changes

### 1. `TweakView` type and `openForm` — add `'implantPriority'`

In `AutogearSettings.tsx`:
- Line 37: add `'implantPriority'` to the `type` field union of the `mode: 'form'` variant.
- Line 294: add `'implantPriority'` to the `openForm` parameter type.

### 2. Add menu — new "Forced implant type" button

In the picker view, add a button below "Excluded implant type" (both gated on `optimizeImplants && availableImplantTypes.length > 0`):

> **Forced implant type**  
> Require a specific implant type to appear in the autogear result (e.g. Bulwark).

`onClick={() => openForm('implantPriority')}`. The existing "Set requirement" button and description are unchanged.

**Breadcrumb label:** The existing ternary chain at lines 651–665 falls through to `'excluded implant type'` for any unrecognised type. Add an explicit branch before the final else:
```
tweakView.type === 'implantPriority' ? 'forced implant type' : 'excluded implant type'
```
Without this, the breadcrumb shows `'excluded implant type'` for the forced-implant form.

### 3. `SetPriorityForm` — implant-type mode

Add optional props `mode?: 'gearSet' | 'implantType'` (default `'gearSet'`) and `availableImplantTypes`.

- `'gearSet'`: existing behaviour — `GEAR_SETS` options, count input visible.
- `'implantType'`: `availableImplantTypes` options only, count input hidden, submit produces `{ setName: selectedSet, count: 1, kind: 'implant' }`.

**JSX branch in `AutogearSettings.tsx`** — add directly after the existing `{tweakView.type === 'setPriority' && ...}` block (line 712):

```tsx
{tweakView.type === 'implantPriority' && (
    <SetPriorityForm
        mode="implantType"
        availableImplantTypes={availableImplantTypes}
        onAdd={(p) => {
            onAddSetPriority(p);
            backToList();
        }}
        editingValue={
            tweakView.editIndex !== null
                ? setPriorities[tweakView.editIndex]
                : undefined
        }
        onSave={(p) => {
            if (tweakView.mode === 'form' && tweakView.editIndex !== null) {
                onUpdateSetPriority(tweakView.editIndex, p);
                backToList();
            }
        }}
        onCancel={backToList}
    />
)}
```

### 4. `SetPriorityRow` (`SetPriorityRow.tsx`)

**Crash fix (line 65):** Replace the unguarded `{GEAR_SETS[priority.setName].name}` (throws `TypeError` for implant keys) with a resolved `label` variable at the top of the component:

```ts
const label =
    GEAR_SETS[priority.setName]?.name
    ?? availableImplantTypes?.find(t => t.key === priority.setName)?.label
    ?? priority.setName;
```

New optional prop: `availableImplantTypes?: { key: string; name: string; label: string }[]`.

For implant entries (`priority.kind === 'implant'`): hide `InlineNumberEdit` and the "N pieces" suffix; render just `{label}`.

### 5. Tweaks list display (`AutogearSettings.tsx`)

**Absolute index requirement:** `tweakView.editIndex` indexes into the unified `setPriorities` array. Sub-group rendering must preserve these absolute indices — local sub-group indices would cause edit/remove/move callbacks to target wrong entries.

**Per-group movement bounds and semantics:** Movement is within-kind only — pressing up/down on a gear-set entry moves it relative to other gear-set entries, skipping over any implant entries in the raw array. This avoids the confusing UX where a button press appears to do nothing (entry moves past an invisible opposite-kind entry).

Pre-compute per-group sorted index arrays before rendering:

```ts
const gearSetAbsoluteIndices = setPriorities
    .map((p, i) => i)
    .filter(i => setPriorities[i].kind !== 'implant');
const implantAbsoluteIndices = setPriorities
    .map((p, i) => i)
    .filter(i => setPriorities[i].kind === 'implant');
```

Gear-set sub-group rendering pattern:
```tsx
{setPriorities
    .map((priority, absoluteIndex) => ({ priority, absoluteIndex }))
    .filter(({ priority }) => priority.kind !== 'implant')
    .map(({ priority, absoluteIndex }) => {
        const kindIdx = gearSetAbsoluteIndices.indexOf(absoluteIndex);
        const prevKindIdx = gearSetAbsoluteIndices[kindIdx - 1];
        const nextKindIdx = gearSetAbsoluteIndices[kindIdx + 1];
        return (
            <SetPriorityRow
                key={`set-${absoluteIndex}`}
                priority={priority}
                isEditing={isEditingSetPriority(absoluteIndex)}
                canMoveUp={prevKindIdx !== undefined}
                canMoveDown={nextKindIdx !== undefined}
                onEdit={() => openForm('setPriority', absoluteIndex)}
                onUpdate={(updated) => onUpdateSetPriority(absoluteIndex, updated)}
                onMoveUp={() => onMoveSetPriority(absoluteIndex, prevKindIdx)}
                onMoveDown={() => onMoveSetPriority(absoluteIndex, nextKindIdx)}
                onRemove={() => onRemoveSetPriority(absoluteIndex)}
                availableImplantTypes={availableImplantTypes}
            />
        );
    })
}
```

Apply the same pattern to the "Required implants" sub-group, filtering on `priority.kind === 'implant'`, using `implantAbsoluteIndices`, `isEditingImplantPriority(absoluteIndex)`, and `openForm('implantPriority', absoluteIndex)`.

Each sub-group's outer `<div>` container (with the `<h4>` heading) must be conditionally rendered: gate the gear-set container on `gearSetAbsoluteIndices.length > 0`, and the implant container on `implantAbsoluteIndices.length > 0`. This matches the existing pattern used for stat priorities, fleet buffs, etc. Without these guards, an empty `<h4>` renders when the user has only one kind of entry.

**Kind-safety invariant:** `openForm('implantPriority', absoluteIndex)` is only called from rows filtered by `priority.kind === 'implant'`, so `editingValue = setPriorities[absoluteIndex]` always has `kind: 'implant'`. Guaranteed by construction.

**`isEditingImplantPriority`** — add as a named closure next to `isEditingSetPriority` (~line 302):
```ts
const isEditingImplantPriority = (index: number) =>
    tweakView.mode === 'form' && tweakView.type === 'implantPriority' && tweakView.editIndex === index;
```

**Tweaks count heading:** The existing composite sum `priorities.length + setPriorities.length + statBonuses.length + fleetBuffs.length + excludedImplantTypes.length` is unchanged and remains accurate because `setPriorities` already covers both gear-set and implant-type entries.

Each sub-group renders only when non-empty.

### 6. `AutogearConfigList.tsx`

The existing `GEAR_SETS[setPriority.setName]?.name` renders `undefined` (blank) for implant entries. Replace with a three-way fallback:

```ts
GEAR_SETS[setPriority.setName]?.name
    ?? IMPLANTS[setPriority.setName]?.name
    ?? setPriority.setName
```

### 7. `AutogearSettingsModal.tsx`

No change needed. The forced-implant form reuses the existing `onAddSetPriority` and `onUpdateSetPriority` callbacks (already on the modal interface). `availableImplantTypes` is already declared on the modal interface. No new top-level prop is introduced.

### 8. Conflict guard (all in `AutogearPage.tsx`)

**`onAddSetPriority` — dedup scoped by kind:**
```ts
const isImplantEntry = priority.kind === 'implant';
const existingIndex = config.setPriorities.findIndex(
    (p) => p.setName === priority.setName && (p.kind === 'implant') === isImplantEntry
);
// ... after dedup:
const updatedExcluded = isImplantEntry
    ? (config.excludedImplantTypes ?? []).filter(k => k !== priority.setName)
    : config.excludedImplantTypes;
updateShipConfig(shipSettings.id, {
    setPriorities: updatedPriorities,
    excludedImplantTypes: updatedExcluded,
});
```

**`onUpdateSetPriority` (~line 1402):** Apply the same mutual-exclusion removal when the updated entry has `kind === 'implant'`.

**`onSetExcludedImplantTypes`** (the handler calling `updateShipConfig(id, { excludedImplantTypes: keys })`): Before committing, remove matching implant-kind entries from `setPriorities`:
```ts
const filteredPriorities = config.setPriorities.filter(
    (p) => !(p.kind === 'implant' && keys.includes(p.setName))
);
updateShipConfig(shipSettings.id, {
    excludedImplantTypes: keys,
    setPriorities: filteredPriorities,
});
```

## Out of Scope

- No changes to `priorityScore.ts` orphan-penalty loop — kept gear-only by design via separate `implantSetCount`.
- **Score cache and `setPriorities`:** `scoring.ts`'s score cache key does not include `setPriorities` (pre-existing). GeneticStrategy calls `clearScoreCache()` at run start; other strategies do not. This is a pre-existing limitation that affects all `setPriorities` changes, not just implant entries — out of scope for this feature.
- No new `SavedAutogearConfig` fields (`kind` is on `SetPriority`, not `SavedAutogearConfig`).
- Ultimate implant slot excluded from optimization (unchanged).
- Count always 1 for implant entries.
- GA set-selection heuristic (`GeneticStrategy.ts` ~line 647) not updated — affects convergence speed only, not correctness.
