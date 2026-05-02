# Excluded Implant UX Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four UX issues in the excluded-implant-types feature: modal displacement from nested scroll + animation, type-qualified labels (e.g. "Haste (Minor Sigma)"), alphabetical sort + search in the add form, and per-row edit.

**Architecture:** Four independent-ish tasks committed in sequence. Task 1 (animation/scroll) is fully standalone. Tasks 2–4 all touch `AutogearSettings.tsx`; Task 2 must precede 3 and 4 because it adds the `label` field to `availableImplantTypes` that the later tasks rely on.

**Tech Stack:** React 18, TypeScript, TailwindCSS. `SearchInput` lives at `src/components/ui/SearchInput.tsx` (not yet exported from the UI barrel — Task 3 fixes this). `IMPLANTS` constant is at `src/constants/implants.ts`; its `type` field values are `'major' | 'alpha(minor)' | 'gamma(minor)' | 'sigma(minor)' | 'ultimate'`.

---

## Files

| File | Tasks |
|---|---|
| `src/index.css` | 1 |
| `src/components/ui/CheckboxGroup.tsx` | 1 |
| `src/components/ui/index.tsx` | 3 |
| `src/pages/manager/AutogearPage.tsx` | 2, 4 |
| `src/components/autogear/AutogearSettings.tsx` | 2, 3, 4 |
| `src/components/autogear/AutogearSettingsModal.tsx` | 2, 4 |

---

### Task 1: Fix modal displacement — animation + nested scroll

**Root cause:** The `subviewEnter` animation starts at `translateY(6px)`. Combined with `overflow: hidden` on the modal container, in-progress content can be clipped. Additionally, the `max-h-[200px] overflow-y-auto` that was added to `CheckboxGroup` creates a nested scroll container inside the modal's own `overflow-y-auto`, and checkbox focus events can trigger outer-container scroll that displaces content.

**Files:**
- Modify: `src/index.css:158-167`
- Modify: `src/components/ui/CheckboxGroup.tsx:31`

- [ ] **Step 1: Remove `translateY` from the `subviewEnter` animation in `src/index.css`**

  Lines 158–167 currently:
  ```css
  @keyframes subviewEnter {
      from {
          opacity: 0;
          transform: translateY(6px);
      }
      to {
          opacity: 1;
          transform: translateY(0);
      }
  }
  ```
  Replace with:
  ```css
  @keyframes subviewEnter {
      from {
          opacity: 0;
      }
      to {
          opacity: 1;
      }
  }
  ```

- [ ] **Step 2: Remove nested scroll from `CheckboxGroup` inner div**

  In `src/components/ui/CheckboxGroup.tsx` line 31, change:
  ```tsx
  <div className="space-y-2 max-h-[200px] overflow-y-auto">
  ```
  To:
  ```tsx
  <div className="space-y-2">
  ```
  The CheckboxGroup will now expand to full height. Task 3 adds search to `ExcludedImplantForm` which keeps the visible list short.

- [ ] **Step 3: Run TypeScript check and tests**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npm test -- --run 2>&1 | tail -10
  ```
  Expected: zero TS errors, all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/index.css src/components/ui/CheckboxGroup.tsx
  git commit -m "fix: use opacity-only subview animation; remove nested scroll from CheckboxGroup"
  ```

---

### Task 2: Type-qualified labels for implant types + alphabetical sort

Adds a `label` field (`"Haste (Minor Sigma)"`) to `availableImplantTypes`, sorts alphabetically, and uses it everywhere implant types are displayed.

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx:207-218` (useMemo + formatImplantType helper)
- Modify: `src/components/autogear/AutogearSettings.tsx:86` (prop type), ExcludedImplantForm options, exclusion list rows
- Modify: `src/components/autogear/AutogearSettingsModal.tsx:53` (prop type)

- [ ] **Step 1: Add `formatImplantType` helper above the component in `AutogearPage.tsx`**

  Add this pure function anywhere above the `AutogearPage` component (e.g. just before it):
  ```typescript
  function formatImplantType(type: string): string {
      if (type === 'major') return 'Major';
      if (type === 'ultimate') return 'Ultimate';
      const match = type.match(/^(\w+)\((\w+)\)$/);
      if (!match) return type.charAt(0).toUpperCase() + type.slice(1);
      const [, variant, category] = match;
      return (
          category.charAt(0).toUpperCase() +
          category.slice(1) +
          ' ' +
          variant.charAt(0).toUpperCase() +
          variant.slice(1)
      );
  }
  ```
  This converts `'sigma(minor)'` → `"Minor Sigma"`, `'gamma(minor)'` → `"Minor Gamma"`, `'major'` → `"Major"`.

- [ ] **Step 2: Update the `availableImplantTypes` useMemo in `AutogearPage.tsx` (lines 207–218)**

  Replace the entire useMemo:
  ```typescript
  const availableImplantTypes = useMemo(() => {
      const seen = new Set<string>();
      const result: { key: string; name: string; label: string }[] = [];
      for (const gear of inventory) {
          if (!gear.slot.startsWith('implant_') || !gear.setBonus) continue;
          const key = gear.setBonus;
          if (seen.has(key)) continue;
          seen.add(key);
          const implant = IMPLANTS[key];
          const name = implant?.name ?? key;
          const typeLabel = implant?.type ? formatImplantType(implant.type) : '';
          const label = typeLabel ? `${name} (${typeLabel})` : name;
          result.push({ key, name, label });
      }
      return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [inventory]);
  ```

- [ ] **Step 3: Update `availableImplantTypes` prop type in `AutogearSettingsModalProps` (line 53)**

  In `src/components/autogear/AutogearSettingsModal.tsx`, change:
  ```typescript
      availableImplantTypes: { key: string; name: string }[];
  ```
  To:
  ```typescript
      availableImplantTypes: { key: string; name: string; label: string }[];
  ```

- [ ] **Step 4: Update `availableImplantTypes` prop type in `AutogearSettingsProps` (line 86)**

  In `src/components/autogear/AutogearSettings.tsx`, change:
  ```typescript
      availableImplantTypes?: { key: string; name: string }[];
  ```
  To:
  ```typescript
      availableImplantTypes?: { key: string; name: string; label: string }[];
  ```

- [ ] **Step 5: Update `ExcludedImplantForm` to use `label` instead of `name` for options**

  In `ExcludedImplantForm`, the options mapping currently reads:
  ```typescript
      const options = availableImplantTypes
          .filter((t) => !excludedImplantTypes.includes(t.key))
          .map((t) => ({ value: t.key, label: t.name }));
  ```
  Change `.map` to use `t.label`:
  ```typescript
      const options = availableImplantTypes
          .filter((t) => !excludedImplantTypes.includes(t.key))
          .map((t) => ({ value: t.key, label: t.label }));
  ```

- [ ] **Step 6: Update the exclusion list rows to show the full label**

  In the "Excluded implants" list section in `AutogearSettings.tsx`, the rows currently use:
  ```typescript
  const name = IMPLANTS[key]?.name ?? key;
  ```
  Replace the entire `{excludedImplantTypes.map(...)}` block with:
  ```typescript
  {excludedImplantTypes.map((key) => {
      const label =
          availableImplantTypes.find((t) => t.key === key)?.label ??
          IMPLANTS[key]?.name ??
          key;
      return (
          <div
              key={key}
              className="flex items-center justify-between gap-2 p-2 bg-dark border border-dark-border rounded text-sm"
          >
              <span>{label}</span>
              <Button
                  variant="danger"
                  size="xs"
                  onClick={() => onRemoveExcludedImplantType(key)}
              >
                  Remove
              </Button>
          </div>
      );
  })}
  ```
  (The Edit button will be added in Task 4.)

- [ ] **Step 7: Run TypeScript check and tests**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npm test -- --run 2>&1 | tail -10
  ```
  Expected: zero errors, all tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add src/pages/manager/AutogearPage.tsx src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx
  git commit -m "feat: add type-qualified labels to implant types (e.g. Haste (Minor Sigma)), sort alphabetically"
  ```

---

### Task 3: Search in the add-excluded-implant form

Adds a `SearchInput` to `ExcludedImplantForm` so long lists can be filtered. Also exports `SearchInput` from the UI barrel file.

**Files:**
- Modify: `src/components/ui/index.tsx` (add SearchInput export)
- Modify: `src/components/autogear/AutogearSettings.tsx` (add SearchInput import + state)

- [ ] **Step 1: Export `SearchInput` from the UI barrel**

  In `src/components/ui/index.tsx`, add after the `Select` export line:
  ```typescript
  export * from './SearchInput';
  ```

- [ ] **Step 2: Add `SearchInput` to the import in `AutogearSettings.tsx`**

  The current import from `'../ui'` (lines 3–12):
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
  Add `SearchInput`:
  ```typescript
  import {
      Button,
      CheckboxGroup,
      SearchInput,
      Select,
      Checkbox,
      Input,
      CollapsibleAccordion,
      ChevronDownIcon,
      ResetIcon,
      RoleSelector,
  } from '../ui';
  ```

- [ ] **Step 3: Add `searchTerm` state and filter to `ExcludedImplantForm`**

  The current `ExcludedImplantForm` (lines ~175–224) opens with:
  ```typescript
  const [selected, setSelected] = useState<string[]>([]);
  const options = availableImplantTypes
      .filter((t) => !excludedImplantTypes.includes(t.key))
      .map((t) => ({ value: t.key, label: t.label }));
  ```
  Replace with:
  ```typescript
  const [selected, setSelected] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const allOptions = availableImplantTypes
      .filter((t) => !excludedImplantTypes.includes(t.key))
      .map((t) => ({ value: t.key, label: t.label }));
  const options = searchTerm
      ? allOptions.filter((o) =>
            o.label.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : allOptions;
  ```

- [ ] **Step 4: Add `SearchInput` above the `CheckboxGroup` in `ExcludedImplantForm`'s render**

  The component currently returns (in the non-empty-state branch):
  ```tsx
  return (
      <div className="space-y-3">
          <CheckboxGroup
              label="Implant types"
              options={options}
              values={selected}
              onChange={setSelected}
          />
          <div className="flex justify-end gap-2">
  ```
  Add `SearchInput` before `CheckboxGroup` and handle the no-results case:
  ```tsx
  return (
      <div className="space-y-3">
          <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search implant types..."
          />
          {options.length === 0 ? (
              <p className="text-sm text-theme-text-secondary">
                  No implant types match your search.
              </p>
          ) : (
              <CheckboxGroup
                  label="Implant types"
                  options={options}
                  values={selected}
                  onChange={setSelected}
              />
          )}
          <div className="flex justify-end gap-2">
  ```

  Also update the empty-state check: the current guard checks `options.length === 0` (which means all types excluded). After the refactor this should check `allOptions.length === 0`:
  ```typescript
  if (allOptions.length === 0) {
  ```

- [ ] **Step 5: Run TypeScript check and tests**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npm test -- --run 2>&1 | tail -10
  ```
  Expected: zero errors, all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/ui/index.tsx src/components/autogear/AutogearSettings.tsx
  git commit -m "feat: add search to excluded implant type picker"
  ```

---

### Task 4: Per-row edit for excluded implants

Adds an Edit button to each row in the "Excluded implants" list. Clicking it opens a single-select form to replace that one entry.

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx` — TweakView type, openForm, ExcludedImplantEditForm, list rows, form render
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` — add prop
- Modify: `src/pages/manager/AutogearPage.tsx` — add handler

- [ ] **Step 1: Extend `TweakView` type and `openForm` in `AutogearSettings.tsx`**

  Current `TweakView` (lines 27–34):
  ```typescript
  type TweakView =
      | { mode: 'list' }
      | { mode: 'picker' }
      | {
            mode: 'form';
            type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant';
            editIndex: number | null;
        };
  ```
  Replace with:
  ```typescript
  type TweakView =
      | { mode: 'list' }
      | { mode: 'picker' }
      | {
            mode: 'form';
            type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant';
            editIndex: number | null;
            editKey?: string;
        };
  ```

  Current `openForm` (lines 271–274):
  ```typescript
  const openForm = (
      type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant',
      editIndex: number | null = null
  ) => setTweakView({ mode: 'form', type, editIndex });
  ```
  Replace with:
  ```typescript
  const openForm = (
      type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant',
      editIndex: number | null = null,
      editKey?: string
  ) => setTweakView({ mode: 'form', type, editIndex, editKey });
  ```

- [ ] **Step 2: Add `onUpdateExcludedImplantType` prop to `AutogearSettingsProps`**

  After the existing `onAddExcludedImplantTypes` prop (line ~88), add:
  ```typescript
      onUpdateExcludedImplantType?: (oldKey: string, newKey: string) => void;
  ```
  And add the default to the destructuring:
  ```typescript
      onUpdateExcludedImplantType = () => {},
  ```

- [ ] **Step 3: Add `ExcludedImplantEditForm` component (new component, insert after `ExcludedImplantForm`)**

  ```typescript
  const ExcludedImplantEditForm: React.FC<{
      availableImplantTypes: { key: string; name: string; label: string }[];
      excludedImplantTypes: string[];
      editKey: string;
      onSave: (newKey: string) => void;
      onCancel: () => void;
  }> = ({ availableImplantTypes, excludedImplantTypes, editKey, onSave, onCancel }) => {
      const [selected, setSelected] = useState(editKey);
      const options = availableImplantTypes
          .filter((t) => !excludedImplantTypes.includes(t.key) || t.key === editKey)
          .map((t) => ({ value: t.key, label: t.label }));

      return (
          <div className="space-y-3">
              <Select
                  label="Replace with"
                  options={options}
                  value={selected}
                  onChange={setSelected}
              />
              <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onCancel}>
                      Cancel
                  </Button>
                  <Button
                      type="button"
                      variant="secondary"
                      disabled={selected === editKey}
                      onClick={() => onSave(selected)}
                  >
                      Save
                  </Button>
              </div>
          </div>
      );
  };
  ```

- [ ] **Step 4: Add Edit button to exclusion list rows**

  In the exclusion list rows (updated in Task 2 Step 6), replace the row JSX to add the Edit button:
  ```typescript
  {excludedImplantTypes.map((key) => {
      const label =
          availableImplantTypes.find((t) => t.key === key)?.label ??
          IMPLANTS[key]?.name ??
          key;
      return (
          <div
              key={key}
              className="flex items-center justify-between gap-2 p-2 bg-dark border border-dark-border rounded text-sm"
          >
              <span>{label}</span>
              <div className="flex gap-1">
                  <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => openForm('excludedImplant', null, key)}
                  >
                      Edit
                  </Button>
                  <Button
                      variant="danger"
                      size="xs"
                      onClick={() => onRemoveExcludedImplantType(key)}
                  >
                      Remove
                  </Button>
              </div>
          </div>
      );
  })}
  ```

- [ ] **Step 5: Update the form render for `excludedImplant` type**

  The current `excludedImplant` form render block (around line 636):
  ```tsx
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
  Replace with:
  ```tsx
  {tweakView.type === 'excludedImplant' &&
      (tweakView.editKey !== undefined ? (
          <ExcludedImplantEditForm
              availableImplantTypes={availableImplantTypes}
              excludedImplantTypes={excludedImplantTypes}
              editKey={tweakView.editKey}
              onSave={(newKey) => {
                  onUpdateExcludedImplantType(tweakView.editKey!, newKey);
                  backToList();
              }}
              onCancel={backToList}
          />
      ) : (
          <ExcludedImplantForm
              availableImplantTypes={availableImplantTypes}
              excludedImplantTypes={excludedImplantTypes}
              onAdd={(keys) => {
                  onAddExcludedImplantTypes(keys);
                  backToList();
              }}
              onCancel={backToList}
          />
      ))}
  ```

- [ ] **Step 6: Update breadcrumb in form view to say "Edit" vs "Add" for excluded implants**

  The current breadcrumb span (around line 557):
  ```tsx
  <span>
      {tweakView.editIndex === null ? 'Add' : 'Edit'}{' '}
      {tweakView.type === 'priority'
          ? 'limits'
          : tweakView.type === 'setPriority'
            ? 'set requirement'
            : tweakView.type === 'statBonus'
              ? 'scale'
              : 'excluded implant type'}
  </span>
  ```
  Replace with:
  ```tsx
  <span>
      {tweakView.type === 'excludedImplant'
          ? tweakView.editKey !== undefined
              ? 'Edit'
              : 'Add'
          : tweakView.editIndex === null
            ? 'Add'
            : 'Edit'}{' '}
      {tweakView.type === 'priority'
          ? 'limits'
          : tweakView.type === 'setPriority'
            ? 'set requirement'
            : tweakView.type === 'statBonus'
              ? 'scale'
              : 'excluded implant type'}
  </span>
  ```

- [ ] **Step 7: Add `onUpdateExcludedImplantType` prop to `AutogearSettingsModalProps`**

  In `src/components/autogear/AutogearSettingsModal.tsx`, after the `onAddExcludedImplantTypes` prop, add:
  ```typescript
      onUpdateExcludedImplantType: (oldKey: string, newKey: string) => void;
  ```

- [ ] **Step 8: Add `onUpdateExcludedImplantType` handler in `AutogearPage.tsx`**

  After the `onRemoveExcludedImplantType` prop on `<AutogearSettingsModal>` (around line 1390), add:
  ```typescript
                  onUpdateExcludedImplantType={(oldKey, newKey) => {
                      if (shipSettings) {
                          const config = getShipConfig(shipSettings.id);
                          updateShipConfig(shipSettings.id, {
                              excludedImplantTypes: (config.excludedImplantTypes ?? []).map(
                                  (k) => (k === oldKey ? newKey : k)
                              ),
                          });
                      }
                  }}
  ```

- [ ] **Step 9: Run TypeScript check and tests**

  ```bash
  npx tsc --noEmit 2>&1 | head -20
  npm test -- --run 2>&1 | tail -10
  ```
  Expected: zero errors, all tests pass.

- [ ] **Step 10: Commit**

  ```bash
  git add src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
  git commit -m "feat: add per-row edit for excluded implant types"
  ```
