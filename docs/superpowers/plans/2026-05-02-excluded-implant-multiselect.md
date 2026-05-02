# Excluded Implant Types — Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-select "Excluded implant type" tweak form with a `CheckboxGroup` so users can exclude multiple implant types in one step.

**Architecture:** Three files change — `AutogearSettings.tsx` gets the form replaced and prop renamed, `AutogearSettingsModal.tsx` gets the prop renamed in its interface, `AutogearPage.tsx` gets the handler updated to accept and batch all keys in a single `updateShipConfig` call. No data model or filter logic changes.

**Tech Stack:** React 18, TypeScript, TailwindCSS. `CheckboxGroup` is at `src/components/ui/CheckboxGroup.tsx`.

---

## Files

- Modify: `src/components/autogear/AutogearSettings.tsx` — form replacement + prop rename
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` — prop rename in interface only
- Modify: `src/pages/manager/AutogearPage.tsx` — prop name + batched handler

No new files. No test file changes (filter logic is unchanged; existing tests in `src/utils/autogear/__tests__/excludedImplantFilter.test.ts` still pass as-is).

---

### Task 1: Update `AutogearSettings.tsx`

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx:3-12` (imports)
- Modify: `src/components/autogear/AutogearSettings.tsx:85-88` (props interface)
- Modify: `src/components/autogear/AutogearSettings.tsx:174-212` (`ExcludedImplantForm`)
- Modify: `src/components/autogear/AutogearSettings.tsx:247-248` (destructuring default)
- Modify: `src/components/autogear/AutogearSettings.tsx:636-646` (call site)

- [ ] **Step 1: Add `CheckboxGroup` to the import from `'../ui'`**

The current import block (lines 3–12) is:
```typescript
import {
    Button,
    Select,
    Checkbox,
    Input,
    CollapsibleAccordion,
    ChevronDownIcon,
    ResetIcon,
    RoleSelector,
} from '../ui';
```
Add `CheckboxGroup` to this list (alphabetical order isn't required, just keep it in the same block):
```typescript
import {
    Button,
    CheckboxGroup,
    Select,
    Checkbox,
    Input,
    CollapsibleAccordion,
    ChevronDownIcon,
    ResetIcon,
    RoleSelector,
} from '../ui';
```

- [ ] **Step 2: Rename the prop in `AutogearSettingsProps` (line 87)**

Change:
```typescript
onAddExcludedImplantType?: (key: string) => void;
```
To:
```typescript
onAddExcludedImplantTypes?: (keys: string[]) => void;
```

- [ ] **Step 3: Replace `ExcludedImplantForm` (lines 174–212) with the `CheckboxGroup`-based version**

Replace the entire component:
```typescript
const ExcludedImplantForm: React.FC<{
    availableImplantTypes: { key: string; name: string }[];
    excludedImplantTypes: string[];
    onAdd: (keys: string[]) => void;
    onCancel: () => void;
}> = ({ availableImplantTypes, excludedImplantTypes, onAdd, onCancel }) => {
    const [selected, setSelected] = useState<string[]>([]);
    const options = availableImplantTypes
        .filter((t) => !excludedImplantTypes.includes(t.key))
        .map((t) => ({ value: t.key, label: t.name }));

    if (options.length === 0) {
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
                    variant="secondary"
                    disabled={selected.length === 0}
                    onClick={() => onAdd(selected)}
                >
                    Add selected
                </Button>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Rename the destructuring default (line 247–248)**

Change:
```typescript
onAddExcludedImplantType = () => {},
```
To:
```typescript
onAddExcludedImplantTypes = () => {},
```

- [ ] **Step 5: Update the call site in the form view (lines 636–646)**

Change:
```typescript
{tweakView.type === 'excludedImplant' && (
    <ExcludedImplantForm
        availableImplantTypes={availableImplantTypes}
        excludedImplantTypes={excludedImplantTypes}
        onAdd={(key) => {
            onAddExcludedImplantType(key);
            backToList();
        }}
        onCancel={backToList}
    />
)}
```
To:
```typescript
{tweakView.type === 'excludedImplant' && (
    <ExcludedImplantForm
        availableImplantTypes={availableImplantTypes}
        excludedImplantTypes={excludedImplantTypes}
        onAdd={(keys) => {
            onAddExcludedImplantTypes(keys);
            backToList();
        }}
        onCancel={backToList}
    />
)}
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "AutogearSettings|error" | head -20
```
Expected: no errors in `AutogearSettings.tsx`. Other files will still error until Tasks 2–3 are done.

- [ ] **Step 7: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat: replace ExcludedImplantForm select with CheckboxGroup multi-select"
```

---

### Task 2: Update `AutogearSettingsModal.tsx`

**Files:**
- Modify: `src/components/autogear/AutogearSettingsModal.tsx:55` (interface)

The modal is a thin wrapper that spreads all props to `AutogearSettings`. Only the interface line changes.

- [ ] **Step 1: Rename `onAddExcludedImplantType` in the interface (line 55)**

Change:
```typescript
onAddExcludedImplantType: (key: string) => void;
```
To:
```typescript
onAddExcludedImplantTypes: (keys: string[]) => void;
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "AutogearSettingsModal|error" | head -20
```
Expected: no errors in `AutogearSettingsModal.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/autogear/AutogearSettingsModal.tsx
git commit -m "feat: rename onAddExcludedImplantType to onAddExcludedImplantTypes in modal interface"
```

---

### Task 3: Update `AutogearPage.tsx`

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx:1382-1389` (prop + handler)

The `onAddExcludedImplantType` JSX prop (line 1382) and its body must change to accept `keys: string[]` and deduplicate before merging.

- [ ] **Step 1: Replace the `onAddExcludedImplantType` prop and handler (lines 1382–1389)**

Change:
```typescript
onAddExcludedImplantType={(key) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            excludedImplantTypes: [...(config.excludedImplantTypes ?? []), key],
        });
    }
}}
```
To:
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

- [ ] **Step 2: Run full TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
npm test -- --run 2>&1 | tail -20
```
Expected: all tests pass (filter tests in `excludedImplantFilter.test.ts` are unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx
git commit -m "feat: update onAddExcludedImplantTypes handler to accept and batch multiple keys"
```
