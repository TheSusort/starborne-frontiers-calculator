# Excluded Implant Types — Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit" button to the excluded implants list that opens the CheckboxGroup form with all available types shown and the currently excluded ones pre-checked, so users can add and remove exclusions in one step.

**Architecture:** Three files change in the same pattern as the multi-select change: `AutogearSettings.tsx` gets the form extended with an edit mode and a new `'excludedImplantEdit'` form type, `AutogearSettingsModal.tsx` gets a new prop added, and `AutogearPage.tsx` gets a new handler that replaces the entire `excludedImplantTypes` array. No data model changes.

**Tech Stack:** React 18, TypeScript, TailwindCSS. `CheckboxGroup` at `src/components/ui/CheckboxGroup.tsx`.

---

## Files

- Modify: `src/components/autogear/AutogearSettings.tsx` — form edit mode + new TweakView type + "Edit" button + breadcrumb + props
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` — new prop in interface
- Modify: `src/pages/manager/AutogearPage.tsx` — new handler

No new files. No test changes.

---

### Task 1: Update `AutogearSettings.tsx`

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

Six targeted edits, all in this one file.

---

#### Edit 1 — Extend the `TweakView` union type (line 32)

Change the `type` string union inside the `form` variant from:
```typescript
type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant';
```
To:
```typescript
type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant' | 'excludedImplantEdit';
```

---

#### Edit 2 — Extend `openForm` parameter type (line 272–275)

Change from:
```typescript
    const openForm = (
        type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant',
        editIndex: number | null = null
    ) => setTweakView({ mode: 'form', type, editIndex });
```
To:
```typescript
    const openForm = (
        type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant' | 'excludedImplantEdit',
        editIndex: number | null = null
    ) => setTweakView({ mode: 'form', type, editIndex });
```

---

#### Edit 3 — Replace `ExcludedImplantForm` component (lines 175–224)

Replace the entire component with one that supports both add and edit modes:

```typescript
const ExcludedImplantForm: React.FC<{
    availableImplantTypes: { key: string; name: string }[];
    excludedImplantTypes: string[];
    onAdd: (keys: string[]) => void;
    onSave?: (keys: string[]) => void;
    onCancel: () => void;
    initialSelected?: string[];
}> = ({
    availableImplantTypes,
    excludedImplantTypes,
    onAdd,
    onSave,
    onCancel,
    initialSelected,
}) => {
    const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
    const isEditMode = !!onSave;

    const options = isEditMode
        ? availableImplantTypes.map((t) => ({ value: t.key, label: t.name }))
        : availableImplantTypes
              .filter((t) => !excludedImplantTypes.includes(t.key))
              .map((t) => ({ value: t.key, label: t.name }));

    if (!isEditMode && options.length === 0) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-theme-text-secondary">
                    All available implant types are already excluded.
                </p>
                <div className="flex justify-end">
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <CheckboxGroup
                label="Implant types"
                options={options}
                values={selected}
                onChange={setSelected}
            />
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant={isEditMode ? 'primary' : 'secondary'}
                    disabled={!isEditMode && selected.length === 0}
                    onClick={() => (isEditMode ? onSave!(selected) : onAdd(selected))}
                >
                    {isEditMode ? 'Save' : 'Add selected'}
                </Button>
            </div>
        </div>
    );
};
```

Key differences from the current form:
- `onSave?: (keys: string[]) => void` — provided in edit mode; absent in add mode
- `initialSelected?: string[]` — pre-populates the checkboxes in edit mode
- In edit mode: all available types shown (no filter), Save button (`variant="primary"`), never disabled
- In add mode: existing behavior unchanged (only non-excluded types, Add selected, disabled when nothing checked)

---

#### Edit 4 — Add `onSetExcludedImplantTypes` to `AutogearSettingsProps` (after line 88)

Add the new prop immediately after `onAddExcludedImplantTypes`:
```typescript
    onAddExcludedImplantTypes?: (keys: string[]) => void;
    onSetExcludedImplantTypes?: (keys: string[]) => void;
    onRemoveExcludedImplantType?: (key: string) => void;
```

---

#### Edit 5 — Add `onSetExcludedImplantTypes` to the destructuring defaults and add "Edit" button to excluded implants heading

**5a** — In the destructuring (around line 259–261), add the new prop with a no-op default after `onAddExcludedImplantTypes`:
```typescript
    onAddExcludedImplantTypes = () => {},
    onSetExcludedImplantTypes = () => {},
    onRemoveExcludedImplantType = () => {},
```

**5b** — In the "Excluded implants" section (currently lines 460–486), replace the plain `<h4>` heading with one that has an "Edit" button:

Change from:
```typescript
                                    {excludedImplantTypes.length > 0 && (
                                        <div className="space-y-1">
                                            <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                                Excluded implants
                                            </h4>
```
To:
```typescript
                                    {excludedImplantTypes.length > 0 && (
                                        <div className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                                    Excluded implants
                                                </h4>
                                                <Button
                                                    variant="link"
                                                    size="xs"
                                                    onClick={() => openForm('excludedImplantEdit')}
                                                >
                                                    Edit
                                                </Button>
                                            </div>
```

---

#### Edit 6 — Add `excludedImplantEdit` form render and update breadcrumb (lines 563–667)

**6a** — Update the breadcrumb label expression (currently the final ternary branch). Replace:
```typescript
                                    {tweakView.editIndex === null ? 'Add' : 'Edit'}{' '}
                                    {tweakView.type === 'priority'
                                        ? 'limits'
                                        : tweakView.type === 'setPriority'
                                          ? 'set requirement'
                                          : tweakView.type === 'statBonus'
                                            ? 'scale'
                                            : 'excluded implant type'}
```
With:
```typescript
                                    {tweakView.type === 'excludedImplantEdit'
                                        ? 'Edit excluded implant types'
                                        : `${tweakView.editIndex === null ? 'Add' : 'Edit'} ${
                                              tweakView.type === 'priority'
                                                  ? 'limits'
                                                  : tweakView.type === 'setPriority'
                                                    ? 'set requirement'
                                                    : tweakView.type === 'statBonus'
                                                      ? 'scale'
                                                      : 'excluded implant type'
                                          }`}
```

**6b** — Add the `excludedImplantEdit` form render immediately after the existing `excludedImplant` block (after line 664):
```typescript
                            {tweakView.type === 'excludedImplantEdit' && (
                                <ExcludedImplantForm
                                    availableImplantTypes={availableImplantTypes}
                                    excludedImplantTypes={excludedImplantTypes}
                                    initialSelected={excludedImplantTypes}
                                    onAdd={() => {}}
                                    onSave={(keys) => {
                                        onSetExcludedImplantTypes(keys);
                                        backToList();
                                    }}
                                    onCancel={backToList}
                                />
                            )}
```

Note: `onAdd` is required by the type but unused in edit mode. Pass an empty function as a no-op.

---

- [ ] **Step 1: Make all 6 edits to `AutogearSettings.tsx`**

Apply edits 1–6 as described above.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in `AutogearSettingsModal.tsx` and `AutogearPage.tsx` (missing new prop). Zero errors inside `AutogearSettings.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat: add edit mode to ExcludedImplantForm and Edit button to excluded implants list"
```

---

### Task 2: Update `AutogearSettingsModal.tsx`

**Files:**
- Modify: `src/components/autogear/AutogearSettingsModal.tsx:55`

One line added to the interface — add `onSetExcludedImplantTypes` after `onAddExcludedImplantTypes`:

```typescript
    onAddExcludedImplantTypes: (keys: string[]) => void;
    onSetExcludedImplantTypes: (keys: string[]) => void;
    onRemoveExcludedImplantType: (key: string) => void;
```

- [ ] **Step 1: Add `onSetExcludedImplantTypes` to `AutogearSettingsModalProps` interface**

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: errors only in `AutogearPage.tsx`. Zero errors in `AutogearSettingsModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/autogear/AutogearSettingsModal.tsx
git commit -m "feat: add onSetExcludedImplantTypes to AutogearSettingsModal interface"
```

---

### Task 3: Update `AutogearPage.tsx`

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx` — add `onSetExcludedImplantTypes` prop after `onAddExcludedImplantTypes`

Add this JSX prop immediately after the closing `}}` of the `onAddExcludedImplantTypes` prop (around line 1394):

```typescript
                    onSetExcludedImplantTypes={(keys) => {
                        if (shipSettings) {
                            updateShipConfig(shipSettings.id, {
                                excludedImplantTypes: [...new Set(keys)],
                            });
                        }
                    }}
```

This replaces the entire list. `[...new Set(keys)]` deduplicates in case of any duplicates from the CheckboxGroup (should not happen, but defensive).

- [ ] **Step 1: Add `onSetExcludedImplantTypes` prop to `<AutogearSettingsModal>`**

- [ ] **Step 2: Run full TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -10
```
Expected: zero errors.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run 2>&1 | tail -10
```
Expected: all 345 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx
git commit -m "feat: add onSetExcludedImplantTypes handler for edit mode in autogear page"
```
