# Unified Implant Type Tweak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the "Excluded implant type" and "Forced implant type" autogear tweaks into a single "Implant type" entry with a Require/Exclude mode selector.

**Architecture:** UI-only change — data model (`excludedImplantTypes: string[]` + `SetPriority[kind='implant']`) stays unchanged. A unified picker button, form (with mode select), and list section replaces the two separate flows. The form dispatches to existing page-level callbacks based on the selected mode.

**Tech Stack:** React 18, TypeScript, Vitest + React Testing Library, TailwindCSS

---

## File Structure

| File | Change |
|------|--------|
| `src/components/autogear/SetPriorityRow.tsx` | Add optional `modeLabel?: string` prop — renders a badge |
| `src/__tests__/components/autogear/SetPriorityRow.test.tsx` | Add one test for modeLabel badge |
| `src/components/autogear/AutogearConfigList.tsx` | Add `excludedImplantTypes?` prop, update `hasConfig` gate, render excluded chips |
| `src/__tests__/components/autogear/AutogearConfigList.test.tsx` | New — 3 tests |
| `src/components/autogear/AutogearSettings.tsx` | TweakView type, helpers, SetPriorityForm extension, picker, form panel, list |

---

## Task 1: SetPriorityRow — modeLabel badge

**Files:**
- Modify: `src/components/autogear/SetPriorityRow.tsx`
- Test: `src/__tests__/components/autogear/SetPriorityRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Add one `it` block to the existing `describe('SetPriorityRow')` in `SetPriorityRow.test.tsx` (after the existing 3 tests, before the closing `});`):

```tsx
it('renders a mode badge when modeLabel is provided', () => {
    const availableImplantTypes = [{ key: 'HASTE', name: 'Haste', label: 'Haste' }];
    render(
        <SetPriorityRow
            {...baseProps}
            priority={{ setName: 'HASTE', count: 1, kind: 'implant' }}
            availableImplantTypes={availableImplantTypes}
            modeLabel="Require"
        />
    );
    expect(screen.getByText('Require')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
npm test -- SetPriorityRow --run
```

Expected: TypeScript error or test failure — `modeLabel` prop does not exist yet.

- [ ] **Step 3: Add `modeLabel` prop to `SetPriorityRow.tsx`**

In `SetPriorityRowProps` (line 13), add:
```ts
modeLabel?: string;
```

In the component destructuring (line 26), add `modeLabel` to the destructured props.

Inside the `<span>` that wraps the label content (currently line 71–92), add the badge after the label/count block and before the `isEditing` indicator:

```tsx
<span>
    {priority.kind === 'implant' ? (
        label
    ) : (
        <>
            {label} ({' '}
            <InlineNumberEdit
                value={priority.count}
                onSave={(v) => v !== undefined && onUpdate({ ...priority, count: v })}
                min={0}
                max={6}
                disabled={isEditing}
            >
                {priority.count}
            </InlineNumberEdit>
            {' pieces)'}
        </>
    )}
    {modeLabel && (
        <span className="text-xs text-theme-text-secondary border border-dark-border rounded px-1 ml-1">
            {modeLabel}
        </span>
    )}
    {isEditing && (
        <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
    )}
</span>
```

- [ ] **Step 4: Run the test — expect it to pass**

```bash
npm test -- SetPriorityRow --run
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/SetPriorityRow.tsx src/__tests__/components/autogear/SetPriorityRow.test.tsx
git commit -m "feat: add modeLabel badge prop to SetPriorityRow"
```

---

## Task 2: AutogearConfigList — display excluded implant types

**Files:**
- Modify: `src/components/autogear/AutogearConfigList.tsx`
- Create: `src/__tests__/components/autogear/AutogearConfigList.test.tsx`

`AutogearConfigList` is rendered in `src/components/autogear/AutogearQuickSettings.tsx` line 88 via `{...getShipConfig(ship.id)}`. Since `getShipConfig` returns `SavedAutogearConfig` (which already has `excludedImplantTypes?: string[]`), adding the prop to the interface is enough — the spread passes it automatically.

The `IMPLANTS` constant is already imported in `AutogearConfigList.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/autogear/AutogearConfigList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutogearConfigList } from '../../../components/autogear/AutogearConfigList';

vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const baseProps = {
    shipRole: null as null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ignoreEquipped: false,
    ignoreUnleveled: false,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    optimizeImplants: false,
};

describe('AutogearConfigList', () => {
    it('shows "No configuration set" when nothing is configured', () => {
        render(<AutogearConfigList {...baseProps} />);
        expect(screen.getByText('No configuration set')).toBeInTheDocument();
    });

    it('does NOT show "No configuration set" when excludedImplantTypes is non-empty', () => {
        render(<AutogearConfigList {...baseProps} excludedImplantTypes={['HASTE']} />);
        expect(screen.queryByText('No configuration set')).not.toBeInTheDocument();
    });

    it('displays excluded implant types in the chip row', () => {
        render(<AutogearConfigList {...baseProps} excludedImplantTypes={['HASTE']} />);
        expect(screen.getByText(/Excl\./)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the tests — expect failures**

```bash
npm test -- AutogearConfigList --run
```

Expected: TypeScript errors (unknown prop `excludedImplantTypes`) or test failures.

- [ ] **Step 3: Update `AutogearConfigList.tsx`**

**3a.** In `AutogearConfigListProps` (line 9), add:
```ts
excludedImplantTypes?: string[];
```

**3b.** In the component destructuring (line 22), add `excludedImplantTypes = []` to the destructured props.

**3c.** In the `hasConfig` expression (lines 34–43), add one new condition:
```ts
const hasConfig =
    statPriorities.length > 0 ||
    setPriorities.length > 0 ||
    statBonuses.length > 0 ||
    fleetBuffs.length > 0 ||
    (excludedImplantTypes?.length ?? 0) > 0 ||   // ← add this
    optimizeImplants ||
    ignoreEquipped ||
    ignoreUnleveled ||
    useUpgradedStats ||
    tryToCompleteSets;
```

**3d.** In the chip row `<div>` (after the Fleet Buffs block, before the closing `</div>`), add:
```tsx
{/* Excluded Implant Types */}
{(excludedImplantTypes ?? []).map((key) => (
    <span key={key}>
        Excl. {IMPLANTS[key]?.name ?? key}
    </span>
))}
```

- [ ] **Step 4: Run the tests — expect all to pass**

```bash
npm test -- AutogearConfigList --run
```

Expected: 3 tests pass.

- [ ] **Step 5: Run full test suite — expect no regressions**

```bash
npm test --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/autogear/AutogearConfigList.tsx src/__tests__/components/autogear/AutogearConfigList.test.tsx
git commit -m "feat: display excluded implant types in AutogearConfigList summary"
```

---

## Task 3: AutogearSettings — TweakView type refactor and helpers

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

This task updates the TypeScript type plumbing and helpers. No visible behavior change — the goal is a clean compile with `npm run lint` passing.

- [ ] **Step 1: Replace `TweakView` type (lines 32–45)**

Replace the existing `TweakView` type with:

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
              | null
              | { kind: 'require'; index: number }
              | { kind: 'exclude'; key: string };
      };

type ImplantEditTarget = Extract<TweakView, { mode: 'form'; type: 'implantType' }>['editTarget'];
```

- [ ] **Step 2: Update `openForm` signature (lines 320–329)**

The `openForm` function currently includes `'implantPriority'` and `'excludedImplant'` in its type union. Remove both. New signature:

```ts
const openForm = (
    type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff',
    editIndex: number | null = null
) => setTweakView({ mode: 'form', type, editIndex });
```

- [ ] **Step 3: Add `openImplantForm` helper (directly after `openForm`)**

```ts
const openImplantForm = (editTarget: ImplantEditTarget = null) =>
    setTweakView({ mode: 'form', type: 'implantType', editTarget });
```

- [ ] **Step 4: Replace `isEditingImplantPriority` with `isEditingImplantType` (lines 338–341)**

Remove:
```ts
const isEditingImplantPriority = (index: number) =>
    tweakView.mode === 'form' &&
    tweakView.type === 'implantPriority' &&
    tweakView.editIndex === index;
```

Add:
```ts
const isEditingImplantType = (target: ImplantEditTarget) => {
    if (tweakView.mode !== 'form' || tweakView.type !== 'implantType') return false;
    const et = tweakView.editTarget;
    if (!et || !target) return et === target;
    if (et.kind !== target.kind) return false;
    if (et.kind === 'require' && target.kind === 'require') return et.index === target.index;
    return (et as { kind: 'exclude'; key: string }).key ===
        (target as { kind: 'exclude'; key: string }).key;
};
```

- [ ] **Step 5: Update the breadcrumb (lines 853–868)**

Replace the entire breadcrumb `<span>` content (the Add/Edit prefix and the type label) with:

```tsx
<span>
    {tweakView.type === 'implantType'
        ? tweakView.editTarget === null
            ? 'Add'
            : 'Edit'
        : tweakView.editIndex === null
          ? 'Add'
          : 'Edit'}{' '}
    {tweakView.type === 'priority'
        ? 'limits'
        : tweakView.type === 'setPriority'
          ? 'set requirement'
          : tweakView.type === 'statBonus'
            ? 'scale'
            : tweakView.type === 'fleetBuff'
              ? 'buff'
              : 'implant type'}
</span>
```

- [ ] **Step 6: Verify it compiles**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings. Fix any TypeScript errors before continuing.

- [ ] **Step 7: Run tests — expect no regressions**

```bash
npm test --run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "refactor: replace TweakView implant arms with unified implantType discriminant"
```

---

## Task 4: AutogearSettings — extend SetPriorityForm with mode selector

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx` (the local `SetPriorityForm` component, lines 112–209)

`SetPriorityForm` is a non-exported local component. This task adds a `preferenceMode` state and a mode selector `Select` that appears when `mode === 'implantType'`.

- [ ] **Step 1: Add new props to `SetPriorityForm`'s prop type (line 112–119)**

In the `React.FC<{...}>` prop type, add after `availableImplantTypes?`:

```ts
onSubmitImplant?: (setName: string, preferenceMode: 'require' | 'exclude') => void;
editingExcludeKey?: string;
```

- [ ] **Step 2: Destructure the new props**

In the component signature destructuring (line 119), add `onSubmitImplant` and `editingExcludeKey` to the destructured list.

- [ ] **Step 3: Add `preferenceMode` state (after the existing `useState` calls, lines 120–121)**

```ts
const [preferenceMode, setPreferenceMode] = useState<'require' | 'exclude'>('require');
```

- [ ] **Step 4: Update the `useEffect` (lines 123–131) to handle `editingExcludeKey`**

Replace the existing `useEffect` with:

```ts
useEffect(() => {
    if (editingValue) {
        setSelectedSet(editingValue.setName);
        setCount(editingValue.count);
        if (mode === 'implantType') setPreferenceMode('require');
    } else if (editingExcludeKey) {
        setSelectedSet(editingExcludeKey);
        setPreferenceMode('exclude');
    } else {
        setSelectedSet('');
        setCount(mode === 'implantType' ? 1 : 2);
        setPreferenceMode('require');
    }
}, [editingValue, editingExcludeKey, mode]);
```

- [ ] **Step 5: Update `handleSubmit` to dispatch via `onSubmitImplant` in implantType mode**

Replace the existing `handleSubmit` (lines 133–147) with:

```ts
const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSet) return;

    if (mode === 'implantType') {
        onSubmitImplant?.(selectedSet, preferenceMode);
        setSelectedSet('');
        setPreferenceMode('require');
        return;
    }

    // gearSet mode only reaches here
    const value: SetPriority = { setName: selectedSet, count };
    if (editingValue && onSave) {
        onSave(value);
        return;
    }
    onAdd(value);
    setSelectedSet('');
    setCount(2);
};
```

- [ ] **Step 6: Add mode selector UI to the form JSX**

In the `<form>` JSX (after the opening `<form ...>` tag, before the `<div className="flex gap-3 ...">` containing the `<Select>`), add:

```tsx
{mode === 'implantType' && (
    <Select
        label="Preference"
        options={[
            { value: 'require', label: 'Require — must appear in result' },
            { value: 'exclude', label: 'Exclude — never used in result' },
        ]}
        value={preferenceMode}
        onChange={(v) => setPreferenceMode(v as 'require' | 'exclude')}
    />
)}
```

Also update the `helpLabel` on the implant type `<Select>` (line ~168) to reflect the selected mode:

```tsx
helpLabel={
    mode === 'implantType'
        ? preferenceMode === 'require'
            ? 'Select an implant type to be required in the autogear result.'
            : 'Select an implant type to exclude from autogear.'
        : 'Select a gear set to be met by the gear you equip.'
}
```

- [ ] **Step 7: Verify lint**

```bash
npm run lint
```

Expected: 0 errors. Fix any TypeScript errors.

- [ ] **Step 8: Run tests**

```bash
npm test --run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat: add Require/Exclude mode selector to SetPriorityForm implantType mode"
```

---

## Task 5: AutogearSettings — picker, form panel, and list unification

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

This is the visible payoff — merging picker buttons, form panel, and list sections. Also removes `ExcludedImplantForm` and its orphaned imports.

### Step-by-step

- [ ] **Step 1: Update the picker (lines 810–835) — two buttons → one**

Find the two `{optimizeImplants && availableImplantTypes.length > 0 && (<button ...>` blocks for excluded/forced implant. Replace both with:

```tsx
{optimizeImplants && availableImplantTypes.length > 0 && (
    <button
        type="button"
        className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
        onClick={() => openImplantForm(null)}
    >
        <div className="font-semibold">Implant type</div>
        <div className="text-xs text-theme-text-secondary">
            Require or exclude a specific implant type from autogear results.
        </div>
    </button>
)}
```

- [ ] **Step 2: Replace the two implant form panel blocks with one (lines 917–998)**

Remove the `{tweakView.type === 'implantPriority' && ...}` block (lines 917–941) and the `{tweakView.type === 'excludedImplant' && ...}` block (lines 988–998).

Add a new unified `'implantType'` block in their place (order doesn't matter since only one renders at a time; place it where `'implantPriority'` was):

```tsx
{tweakView.type === 'implantType' && (() => {
    const editTarget = (tweakView as Extract<TweakView, { type: 'implantType' }>).editTarget;
    return (
        <SetPriorityForm
            mode="implantType"
            availableImplantTypes={availableImplantTypes}
            onAdd={() => {}}
            editingValue={
                editTarget?.kind === 'require'
                    ? setPriorities[editTarget.index]
                    : undefined
            }
            editingExcludeKey={
                editTarget?.kind === 'exclude' ? editTarget.key : undefined
            }
            onSubmitImplant={(setName, pMode) => {
                if (pMode === 'require') {
                    if (editTarget?.kind === 'require') {
                        onUpdateSetPriority(editTarget.index, {
                            setName,
                            count: 1,
                            kind: 'implant',
                        });
                    } else {
                        onAddSetPriority({ setName, count: 1, kind: 'implant' });
                    }
                } else {
                    const oldKey = editTarget?.kind === 'exclude' ? editTarget.key : null;
                    const newExcluded = oldKey
                        ? Array.from(
                              new Set([
                                  ...excludedImplantTypes.filter((k) => k !== oldKey),
                                  setName,
                              ])
                          )
                        : Array.from(new Set([...excludedImplantTypes, setName]));
                    onSetExcludedImplantTypes(newExcluded);
                }
                backToList();
            }}
            onCancel={backToList}
        />
    );
})()}
```

- [ ] **Step 3: Unify the list sections**

Locate the `{(() => { ... })()}` IIFE (lines 461–639) and the separate `{excludedImplantTypes.length > 0 && ...}` section (lines 694–736).

**3a.** Inside the IIFE, find the second sub-group:
```tsx
{implantAbsoluteIndices.length > 0 && (
    <div className="space-y-1">
        <h4 ...>Required implants</h4>
        ...
    </div>
)}
```

Replace it with a merged "Implant types" section that includes both require and exclude rows:

```tsx
{(implantAbsoluteIndices.length > 0 || excludedImplantTypes.length > 0) && (
    <div className="space-y-1">
        <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
            Implant types
        </h4>
        {/* Require rows */}
        {setPriorities
            .map((priority, absoluteIndex) => ({ priority, absoluteIndex }))
            .filter(({ priority }) => priority.kind === 'implant')
            .map(({ priority, absoluteIndex }) => {
                const kindIdx = implantAbsoluteIndices.indexOf(absoluteIndex);
                const prevKindIdx = implantAbsoluteIndices[kindIdx - 1];
                const nextKindIdx = implantAbsoluteIndices[kindIdx + 1];
                return (
                    <SetPriorityRow
                        key={`implant-${absoluteIndex}`}
                        priority={priority}
                        isEditing={isEditingImplantType({
                            kind: 'require',
                            index: absoluteIndex,
                        })}
                        canMoveUp={prevKindIdx !== undefined}
                        canMoveDown={nextKindIdx !== undefined}
                        onUpdate={(updated) =>
                            onUpdateSetPriority(absoluteIndex, updated)
                        }
                        onEdit={() =>
                            openImplantForm({ kind: 'require', index: absoluteIndex })
                        }
                        onMoveUp={() =>
                            prevKindIdx !== undefined &&
                            onMoveSetPriority(absoluteIndex, prevKindIdx)
                        }
                        onMoveDown={() =>
                            nextKindIdx !== undefined &&
                            onMoveSetPriority(absoluteIndex, nextKindIdx)
                        }
                        onRemove={() => onRemoveSetPriority(absoluteIndex)}
                        availableImplantTypes={availableImplantTypes}
                        modeLabel="Require"
                    />
                );
            })}
        {/* Exclude rows */}
        {excludedImplantTypes.map((key) => {
            const label =
                availableImplantTypes.find((t) => t.key === key)?.label ??
                IMPLANTS[key]?.name ??
                key;
            return (
                <div key={key} className="flex items-center text-sm gap-2">
                    <span>
                        {label}
                        <span className="text-xs text-theme-text-secondary border border-dark-border rounded px-1 ml-1">
                            Exclude
                        </span>
                    </span>
                    <Button
                        aria-label="Edit implant type preference"
                        variant="secondary"
                        size="sm"
                        onClick={() => openImplantForm({ kind: 'exclude', key })}
                        className="ml-auto"
                    >
                        <EditIcon />
                    </Button>
                    <Button
                        aria-label="Remove implant type preference"
                        variant="danger"
                        size="sm"
                        onClick={() => onRemoveExcludedImplantType(key)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            );
        })}
    </div>
)}
```

**3b.** Delete the now-redundant standalone `{excludedImplantTypes.length > 0 && ...}` section (lines 694–736).

- [ ] **Step 4: Delete `ExcludedImplantForm` component (lines 211–268)**

Remove the entire `const ExcludedImplantForm: React.FC<...> = ...` component definition.

- [ ] **Step 5: Remove orphaned imports**

`SearchInput` and `CheckboxGroup` were only used by `ExcludedImplantForm`. Remove them from the `import { ..., CheckboxGroup, ..., SearchInput, ... } from '../ui'` line (lines 5–16).

- [ ] **Step 6: Verify lint**

```bash
npm run lint
```

Expected: 0 errors. If TypeScript complains about `tweakView` access patterns, ensure you're narrowing via the discriminant (`tweakView.type === 'implantType'`) before accessing `editTarget`, and `tweakView.editIndex` is only accessed in the non-`'implantType'` arm.

- [ ] **Step 7: Run full test suite**

```bash
npm test --run
```

Expected: all tests pass.

- [ ] **Step 8: Manual verification — start the dev server and test the golden path**

```bash
npm start
```

Test these scenarios in the autogear settings panel (enable "Optimize implants" first, you need implants in inventory):

1. **Picker** — click "+ Add tweak" → see one "Implant type" entry (not two separate entries)
2. **Add Require** — click "Implant type" → form shows Preference dropdown → select "Require" → pick a type → Add → list shows the type with "Require" badge under "Implant types"
3. **Add Exclude** — add another tweak → select "Exclude" → pick a different type → Add → list shows both, second with "Exclude" badge
4. **Edit Require → Exclude** — click edit on the Require row → change preference to Exclude → Save → it moves to the exclude side
5. **Edit Exclude → Require** — click edit on an Exclude row → change to Require → Save → moves to require side
6. **Remove** — X button on either kind removes correctly
7. **Breadcrumb** — while in the form, breadcrumb shows "Add implant type" or "Edit implant type"
8. **AutogearQuickSettings** — the compact config list (ship cards) now shows "Excl. TypeName" for excluded types
9. **Config with only excluded implants** — should not show "No configuration set" in the compact view

- [ ] **Step 9: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat: unify excluded and required implant types into single Implant type tweak"
```

---

## Final checks

- [ ] Run `npm run lint` one last time — 0 warnings
- [ ] Run `npm test --run` — all tests pass
- [ ] Update `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:
  ```
  'Autogear: merged "Excluded implant type" and "Forced implant type" tweaks into a single "Implant type" entry with Require/Exclude mode selector'
  ```
- [ ] Commit changelog update:
  ```bash
  git add src/constants/changelog.ts
  git commit -m "chore: add changelog entry for unified implant type tweak"
  ```
