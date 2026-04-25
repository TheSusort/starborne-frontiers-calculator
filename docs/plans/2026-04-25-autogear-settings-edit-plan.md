# Autogear Settings Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit existing autogear settings (Stat Priority List, Set Priority List, Role Stat Bonuses) without removing and re-adding rows. Add an Edit button per row that pre-fills the form in Secondary Priorities, plus inline number editing on every numeric value in row text.

**Architecture:** A new reusable `InlineNumberEdit` UI primitive handles per-number editing inside row components. Each list gets a row component (`StatPriorityRow`, `SetPriorityRow`, `StatBonusRow`) that owns its inline edits and an Edit button. `AutogearSettings.tsx` holds a single `EditTarget` discriminated-union state to enforce one active form-edit across all three lists; clicking Edit expands Secondary Priorities (if collapsed), scrolls the matching form into view, and switches it to edit mode. New `onUpdate*(index, value)` handlers in `AutogearPage.tsx` replace at index (the existing `onAdd*` handlers do upsert-by-name, which would dup-and-drift if the user changes the stat during edit).

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest, React Testing Library.

**Spec:** `docs/plans/2026-04-25-autogear-settings-edit-design.md`

---

## File Structure

**New files:**
- `src/components/ui/InlineNumberEdit.tsx` — reusable click-to-edit numeric span/input
- `src/components/ui/__tests__/InlineNumberEdit.test.tsx`
- `src/components/autogear/StatPriorityRow.tsx` — extracted from `AutogearSettings.tsx`, gains inline + Edit support
- `src/components/autogear/SetPriorityRow.tsx`
- `src/components/autogear/StatBonusRow.tsx`

**Modified files:**
- `src/components/ui/index.ts` — export `InlineNumberEdit`
- `src/components/autogear/AutogearSettings.tsx` — `EditTarget` state, form refs, Edit-trigger helper, render new row components, hook `editingValue`/`onSave`/`onCancel` into the three forms
- `src/components/autogear/StatPriorityForm.tsx` — `editingValue` / `onSave` / `onCancel` props (Add ↔ Save+Cancel)
- `src/components/autogear/StatBonusForm.tsx` — same edit-mode props
- `src/components/autogear/AutogearSettingsModal.tsx` — add `onUpdatePriority` / `onUpdateSetPriority` / `onUpdateStatBonus` props and pass through
- `src/pages/manager/AutogearPage.tsx` — three new update handlers (replace-at-index)

---

## Task 1: InlineNumberEdit primitive (TDD)

**Files:**
- Create: `src/components/ui/InlineNumberEdit.tsx`
- Create: `src/components/ui/__tests__/InlineNumberEdit.test.tsx`
- Modify: `src/components/ui/index.ts`

**Behavior contract:**
- Renders `children` inside a span with `cursor-pointer` and a dotted underline (Tailwind: `border-b border-dotted border-theme-text-secondary`).
- Click → swaps to `<input type="number">` autofocused with text selected, pre-filled with `value` (or empty if `value === undefined`).
- **Enter** or **blur** → save. **Escape** → cancel and revert.
- Save logic:
  - Empty input + `allowEmpty=true` → call `onSave(undefined)`
  - Empty input + `allowEmpty=false` (default) → revert silently, no `onSave`
  - Non-numeric / NaN → revert
  - Out-of-range vs `min`/`max` props → revert (matches NaN handling)
  - Otherwise → call `onSave(parsedNumber)`
- After save or cancel, returns to display mode.

- [ ] **Step 1: Write failing tests**

Create `src/components/ui/__tests__/InlineNumberEdit.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineNumberEdit } from '../InlineNumberEdit';

describe('InlineNumberEdit', () => {
    const renderWith = (props: Partial<React.ComponentProps<typeof InlineNumberEdit>> = {}) => {
        const onSave = vi.fn();
        render(
            <InlineNumberEdit value={100} onSave={onSave} {...props}>
                100
            </InlineNumberEdit>
        );
        return { onSave };
    };

    it('renders children in display mode by default', () => {
        renderWith();
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('switches to input on click and pre-fills with value', () => {
        renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        expect(input.value).toBe('100');
    });

    it('saves on Enter with parsed numeric value', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '250' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).toHaveBeenCalledWith(250);
    });

    it('saves on blur', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '42' } });
        fireEvent.blur(input);
        expect(onSave).toHaveBeenCalledWith(42);
    });

    it('reverts on Escape without calling onSave', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('saves undefined when empty and allowEmpty=true', () => {
        const { onSave } = renderWith({ allowEmpty: true });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).toHaveBeenCalledWith(undefined);
    });

    it('reverts when empty and allowEmpty is not set', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when input is non-numeric', () => {
        const { onSave } = renderWith();
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: 'abc' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when value is below min', () => {
        const { onSave } = renderWith({ min: 0 });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '-5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('reverts when value is above max', () => {
        const { onSave } = renderWith({ max: 6 });
        fireEvent.click(screen.getByText('100'));
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '7' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not switch to input when disabled', () => {
        renderWith({ disabled: true });
        fireEvent.click(screen.getByText('100'));
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/components/ui/__tests__/InlineNumberEdit.test.tsx`
Expected: all tests fail (module not found).

- [ ] **Step 3: Implement `InlineNumberEdit`**

Create `src/components/ui/InlineNumberEdit.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';

interface InlineNumberEditProps {
    value: number | undefined;
    onSave: (value: number | undefined) => void;
    allowEmpty?: boolean;
    min?: number;
    max?: number;
    disabled?: boolean;
    className?: string;
    children: React.ReactNode;
}

export const InlineNumberEdit: React.FC<InlineNumberEditProps> = ({
    value,
    onSave,
    allowEmpty = false,
    min,
    max,
    disabled = false,
    className = '',
    children,
}) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const startEdit = () => {
        if (disabled) return;
        setDraft(value === undefined ? '' : String(value));
        setEditing(true);
    };

    const commit = () => {
        const trimmed = draft.trim();
        if (trimmed === '') {
            if (allowEmpty) onSave(undefined);
            setEditing(false);
            return;
        }
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) {
            setEditing(false);
            return;
        }
        if (min !== undefined && parsed < min) {
            setEditing(false);
            return;
        }
        if (max !== undefined && parsed > max) {
            setEditing(false);
            return;
        }
        onSave(parsed);
        setEditing(false);
    };

    const cancel = () => setEditing(false);

    if (!editing) {
        return (
            <span
                className={`cursor-pointer border-b border-dotted border-theme-text-secondary hover:text-theme-text ${disabled ? 'pointer-events-none opacity-60' : ''} ${className}`}
                onClick={startEdit}
            >
                {children}
            </span>
        );
    }

    return (
        <input
            ref={inputRef}
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                }
            }}
            min={min}
            max={max}
            className={`w-16 px-1 py-0 bg-dark border border-dark-border text-sm ${className}`}
        />
    );
};
```

- [ ] **Step 4: Export from `src/components/ui/index.ts`**

Find the file, add:
```ts
export { InlineNumberEdit } from './InlineNumberEdit';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest --run src/components/ui/__tests__/InlineNumberEdit.test.tsx`
Expected: all 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/InlineNumberEdit.tsx src/components/ui/__tests__/InlineNumberEdit.test.tsx src/components/ui/index.ts
git commit -m "feat(ui): add InlineNumberEdit primitive"
```

---

## Task 2: Add edit mode to StatPriorityForm

**Files:**
- Modify: `src/components/autogear/StatPriorityForm.tsx`

**Behavior:**
- New optional props: `editingValue?: StatPriority`, `onSave?: (priority: StatPriority) => void`, `onCancel?: () => void`.
- When `editingValue` is set:
  - Local state syncs to `editingValue` whenever it changes (effect with `editingValue` as dep).
  - Submit calls `onSave(priority)` instead of `onAdd(priority)`.
  - Replace the **Add** button with **Save** + **Cancel** (Cancel calls `onCancel`).
  - Do **not** clear local state on submit. Parent clears `editingValue` to exit edit mode (sync effect handles cleanup).
- When `editingValue` is undefined: original Add behavior unchanged.

- [ ] **Step 1: Update component**

In `src/components/autogear/StatPriorityForm.tsx`:

Update `Props`:
```ts
interface Props {
    onAdd: (priority: StatPriority) => void;
    existingPriorities: StatPriority[];
    hideWeight?: boolean;
    hideMaxLimit?: boolean;
    hideMinLimit?: boolean;
    editingValue?: StatPriority;
    onSave?: (priority: StatPriority) => void;
    onCancel?: () => void;
}
```

Inside the component, add a sync effect after the existing `useState` hooks:

```ts
useEffect(() => {
    if (editingValue) {
        setSelectedStat(editingValue.stat);
        setMinLimit(editingValue.minLimit !== undefined ? String(editingValue.minLimit) : '');
        setMaxLimit(editingValue.maxLimit !== undefined ? String(editingValue.maxLimit) : '');
        setWeight(editingValue.weight ?? 1);
        setHardRequirement(editingValue.hardRequirement ?? false);
    }
}, [editingValue]);
```

Add `useEffect` to the existing `import` from `'react'`.

Replace the body of `handleSubmit` so it builds the priority once and dispatches based on mode:

```ts
const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const hasLimit = (!hideMinLimit && !!minLimit) || (!hideMaxLimit && !!maxLimit);
    const hardFlag = hasLimit && hardRequirement ? true : undefined;

    const priority: StatPriority = {
        stat: selectedStat,
        maxLimit: hideMaxLimit ? undefined : maxLimit ? Number(maxLimit) : undefined,
        minLimit: hideMinLimit ? undefined : minLimit ? Number(minLimit) : undefined,
        weight: hideWeight ? 1 : weight,
        hardRequirement: hardFlag,
    };

    if (editingValue && onSave) {
        onSave(priority);
        return;
    }

    onAdd(priority);

    setMaxLimit('');
    setMinLimit('');
    setHardRequirement(false);
    if (!hideWeight) {
        setWeight(existingPriorities.length > 0 ? existingPriorities.length + 1 : 1);
    }
    setSelectedStat(AVAILABLE_STATS[0]);
};
```

Replace the existing button block at the bottom of the form:

```tsx
<div className="grow mt-4">
    {editingValue ? (
        <div className="flex gap-2">
            <Button aria-label="Save priority" type="submit" variant="primary" fullWidth>
                Save
            </Button>
            <Button
                aria-label="Cancel edit"
                type="button"
                variant="secondary"
                fullWidth
                onClick={onCancel}
            >
                Cancel
            </Button>
        </div>
    ) : (
        <Button aria-label="Add priority" type="submit" variant="secondary" fullWidth>
            Add
        </Button>
    )}
</div>
```

- [ ] **Step 2: Verify build is clean**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no warnings/errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/autogear/StatPriorityForm.tsx
git commit -m "feat(autogear): edit mode for StatPriorityForm"
```

---

## Task 3: Add `onUpdatePriority` handler in AutogearPage + modal pass-through

**Files:**
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx` (props interface only — wiring comes in Task 5)
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Add prop to `AutogearSettingsProps` in `AutogearSettings.tsx`**

Find the `AutogearSettingsProps` interface (~line 87) and add:
```ts
onUpdatePriority: (index: number, priority: StatPriority) => void;
```

The component implementation will use it in Task 5 — for now just thread the prop through (destructure and ignore).

- [ ] **Step 2: Mirror in `AutogearSettingsModal.tsx`**

Add the same prop to the modal's props interface and pass it through to `<AutogearSettings ... />`.

- [ ] **Step 3: Implement handler in `AutogearPage.tsx`**

Find where `onAddPriority` is passed (~line 1185) and add `onUpdatePriority` next to it:

```ts
onUpdatePriority={(index, priority) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            statPriorities: config.statPriorities.map((p, i) =>
                i === index ? priority : p
            ),
        });
    }
}}
```

Pass to both `AutogearSettings` and `AutogearSettingsModal` invocations (search for both component usages — they share the prop interface). Use grep for `<AutogearSettings` and `<AutogearSettingsModal` to find them.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): add onUpdatePriority handler"
```

---

## Task 4: Extract StatPriorityRow + add inline editing and Edit button

**Files:**
- Create: `src/components/autogear/StatPriorityRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`

**Row contract:**
```ts
interface StatPriorityRowProps {
    priority: StatPriority;
    isEditing: boolean;
    onUpdate: (priority: StatPriority) => void;
    onEdit: () => void;
    onRemove: () => void;
}
```

- Renders the same text the inline component does today.
- Each numeric chunk (`min: X`, `max: Y`, `weight: Z`) is wrapped in `InlineNumberEdit`:
  - `min`, `max` → `allowEmpty=true` (clearing removes the constraint and the chunk)
  - `weight` → `allowEmpty=false`, `min={0}` (saving 0 keeps the field present per spec edge case)
- Inline edits are disabled (`disabled={isEditing}`) while the row is in form-edit mode.
- Visual: when `isEditing`, the row gets `opacity-60` and an inline `(editing)` suffix (muted text).
- After the text spans, render an Edit `Button` (`variant="secondary"`, `size="sm"`) with a pencil icon or text, then the existing Remove button.

- [ ] **Step 1: Find or pick a pencil/edit icon**

Run: `ls src/components/ui/icons/`
Look for an existing edit/pencil icon. If one exists, use it. If not, render the text "Edit" as the button label (don't add a new icon — YAGNI).

- [ ] **Step 2: Create `src/components/autogear/StatPriorityRow.tsx`**

```tsx
import React, { useRef, useState } from 'react';
import { Button, CloseIcon, InlineNumberEdit, Tooltip } from '../ui';
import { StatPriority } from '../../types/autogear';
import { STATS } from '../../constants';

interface StatPriorityRowProps {
    priority: StatPriority;
    isEditing: boolean;
    onUpdate: (priority: StatPriority) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const StatPriorityRow: React.FC<StatPriorityRowProps> = ({
    priority,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const hardRef = useRef<HTMLSpanElement>(null);

    const update = (changes: Partial<StatPriority>) => {
        onUpdate({ ...priority, ...changes });
    };

    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {STATS[priority.stat].label}
                {priority.minLimit !== undefined && (
                    <>
                        {' ('}
                        min:{' '}
                        <InlineNumberEdit
                            value={priority.minLimit}
                            onSave={(v) => update({ minLimit: v })}
                            allowEmpty
                            disabled={isEditing}
                        >
                            {priority.minLimit}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.maxLimit !== undefined && (
                    <>
                        {' ('}
                        max:{' '}
                        <InlineNumberEdit
                            value={priority.maxLimit}
                            onSave={(v) => update({ maxLimit: v })}
                            allowEmpty
                            disabled={isEditing}
                        >
                            {priority.maxLimit}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.weight !== undefined && priority.weight !== 1 && (
                    <>
                        {' ('}
                        weight:{' '}
                        <InlineNumberEdit
                            value={priority.weight}
                            onSave={(v) => update({ weight: v ?? 1 })}
                            min={0}
                            disabled={isEditing}
                        >
                            {priority.weight}
                        </InlineNumberEdit>
                        {')'}
                    </>
                )}
                {priority.hardRequirement && (
                    <>
                        {' '}
                        <span
                            ref={hardRef}
                            onMouseEnter={() => setShowTooltip(true)}
                            onMouseLeave={() => setShowTooltip(false)}
                            className="text-amber-400 cursor-help"
                        >
                            — Hard Requirement
                        </span>
                        <Tooltip
                            isVisible={showTooltip}
                            targetElement={hardRef.current}
                            className="bg-dark border border-dark-lighter p-2"
                        >
                            <p className="text-xs">this time it&apos;s personal</p>
                        </Tooltip>
                    </>
                )}
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit priority"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
            >
                Edit
            </Button>
            <Button aria-label="Remove priority" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
```

- [ ] **Step 3: Remove the inline `StatPriorityRow` from `AutogearSettings.tsx`**

Delete the inline `StatPriorityRow` definition (lines ~26-72 in the current file). Add an import at the top:

```ts
import { StatPriorityRow } from './StatPriorityRow';
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors. `AutogearSettings.tsx` will fail to typecheck if it still references the old props (`isEditing`, `onUpdate`, `onEdit` aren't being passed yet) — Task 5 wires them. For now, temporarily pass placeholder props to satisfy types:

In `AutogearSettings.tsx` where `<StatPriorityRow ... />` is rendered (~line 454):
```tsx
<StatPriorityRow
    key={index}
    priority={priority}
    isEditing={false}
    onUpdate={(updated) => onUpdatePriority(index, updated)}
    onEdit={() => {}}
    onRemove={() => onRemovePriority(index)}
/>
```

Now `npx tsc --noEmit` should pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/StatPriorityRow.tsx src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): extract StatPriorityRow with inline number edit"
```

---

## Task 5: Wire EditTarget state + Edit button + form edit mode for stat priorities

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

This is the biggest task — establishes the `EditTarget` discriminated union that all three lists will share. Set up groundwork for the next two phases.

- [ ] **Step 1: Add EditTarget type and state**

At the top of `AutogearSettings.tsx` (after imports, before the `StatPriorityRow` import), add:

```ts
type EditTarget =
    | { kind: 'priority'; index: number }
    | { kind: 'setPriority'; index: number }
    | { kind: 'statBonus'; index: number }
    | null;
```

Inside the `AutogearSettings` component (after the existing `useState`/`useRef` hooks), add:

```ts
const [editTarget, setEditTarget] = useState<EditTarget>(null);
const priorityFormRef = useRef<HTMLDivElement>(null);
const setPriorityFormRef = useRef<HTMLDivElement>(null);
const statBonusFormRef = useRef<HTMLDivElement>(null);

const startEdit = (target: NonNullable<EditTarget>) => {
    setEditTarget(target);
    if (!showSecondaryRequirements) {
        onToggleSecondaryRequirements(true);
    }
    requestAnimationFrame(() => {
        const ref =
            target.kind === 'priority'
                ? priorityFormRef
                : target.kind === 'setPriority'
                  ? setPriorityFormRef
                  : statBonusFormRef;
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
};

const cancelEdit = () => setEditTarget(null);
```

Note from spec: if `requestAnimationFrame` lands before `CollapsibleForm`'s expand animation settles, swap to `setTimeout(..., 300)` (verify visually during manual QA).

- [ ] **Step 2: Wire stat priority form edit mode**

Find the `<StatPriorityForm ... />` invocation (around line 297). Wrap the surrounding `<div data-tutorial="autogear-stat-priorities">` so the ref attaches:

```tsx
<div data-tutorial="autogear-stat-priorities" ref={priorityFormRef}>
    <StatPriorityForm
        onAdd={onAddPriority}
        existingPriorities={priorities}
        hideWeight={showSecondaryRequirements}
        editingValue={
            editTarget?.kind === 'priority' ? priorities[editTarget.index] : undefined
        }
        onSave={(priority) => {
            if (editTarget?.kind === 'priority') {
                onUpdatePriority(editTarget.index, priority);
                setEditTarget(null);
            }
        }}
        onCancel={cancelEdit}
    />
</div>
```

- [ ] **Step 3: Wire stat priority row Edit button**

Find the `<StatPriorityRow ... />` invocation (~line 454). Replace placeholder props with real wiring:

```tsx
<StatPriorityRow
    key={index}
    priority={priority}
    isEditing={editTarget?.kind === 'priority' && editTarget.index === index}
    onUpdate={(updated) => onUpdatePriority(index, updated)}
    onEdit={() => startEdit({ kind: 'priority', index })}
    onRemove={() => {
        if (editTarget?.kind === 'priority' && editTarget.index === index) {
            setEditTarget(null);
        }
        onRemovePriority(index);
    }}
/>
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no warnings.

- [ ] **Step 5: Manual QA — stat priorities only**

Run: `npm start`

In a browser:
1. Open the autogear page, select a ship, set role.
2. Add a stat priority with min, max, and weight values.
3. Verify the row renders with dotted-underline numbers.
4. Click `min: X` → input appears focused → change value → press Enter → row updates.
5. Click `max: Y` → press Escape → no change.
6. Click `weight: Z` → blur (click elsewhere) → row updates.
7. Click an `min` number → clear input → Enter → the `(min: ...)` chunk disappears.
8. Click **Edit** on the row → form scrolls into view, fills with values, shows Save+Cancel.
9. Change the stat in the dropdown → click **Save** → the original index is updated (not duplicated).
10. Click **Edit** → click **Cancel** → row unchanged, form resets.
11. Click **Edit** on row A → click **Edit** on row B → row A no longer shows "(editing)", row B does.
12. While in form-edit mode on row A, verify clicking a number in row A does nothing (disabled).
13. Collapse Secondary Priorities → click **Edit** → it auto-expands and scrolls.

Document any issues; fix before committing.

- [ ] **Step 6: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): wire EditTarget + edit flow for stat priorities"
```

---

## Task 6: Create SetPriorityRow + extract SetPriorityForm with edit mode

**Files:**
- Create: `src/components/autogear/SetPriorityRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx` (the inline `SetPriorityForm` lives here)

The inline `SetPriorityForm` is small (~30 lines). Keep it inline but add edit-mode props.

**Row contract:**
```ts
interface SetPriorityRowProps {
    priority: SetPriority;
    isEditing: boolean;
    onUpdate: (priority: SetPriority) => void;
    onEdit: () => void;
    onRemove: () => void;
}
```

- Renders `{setName} ({count} pieces)` with `count` wrapped in `InlineNumberEdit` (`min=0`, `max=6`, `allowEmpty=false`).

- [ ] **Step 1: Create `src/components/autogear/SetPriorityRow.tsx`**

```tsx
import React from 'react';
import { Button, CloseIcon, InlineNumberEdit } from '../ui';
import { SetPriority } from '../../types/autogear';
import { GEAR_SETS } from '../../constants/gearSets';

interface SetPriorityRowProps {
    priority: SetPriority;
    isEditing: boolean;
    onUpdate: (priority: SetPriority) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const SetPriorityRow: React.FC<SetPriorityRowProps> = ({
    priority,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {GEAR_SETS[priority.setName].name} ({' '}
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
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit set priority"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
            >
                Edit
            </Button>
            <Button
                aria-label="Remove set priority"
                variant="danger"
                size="sm"
                onClick={onRemove}
            >
                <CloseIcon />
            </Button>
        </div>
    );
};
```

- [ ] **Step 2: Add edit-mode props to inline `SetPriorityForm` in `AutogearSettings.tsx`**

Find `SetPriorityForm` (~line 124). Update its props and body:

```tsx
const SetPriorityForm: React.FC<{
    onAdd: (priority: SetPriority) => void;
    editingValue?: SetPriority;
    onSave?: (priority: SetPriority) => void;
    onCancel?: () => void;
}> = ({ onAdd, editingValue, onSave, onCancel }) => {
    const [selectedSet, setSelectedSet] = useState<string>('');
    const [count, setCount] = useState<number>(2);

    useEffect(() => {
        if (editingValue) {
            setSelectedSet(editingValue.setName);
            setCount(editingValue.count);
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedSet) return;
        const value = { setName: selectedSet, count };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedSet('');
        setCount(2);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex gap-4 items-end">
                <Select
                    label="Gear set"
                    className="flex-1"
                    options={Object.entries(GEAR_SETS).map(([key, set]) => ({
                        value: key,
                        label: set.name,
                    }))}
                    value={selectedSet}
                    onChange={(value) => setSelectedSet(value)}
                    noDefaultSelection
                    helpLabel="Select a gear set to be met by the gear you equip."
                />
                <div className="w-32">
                    <Input
                        label="No. of pieces"
                        type="number"
                        min="0"
                        max="6"
                        value={count}
                        onChange={(e) => setCount(parseInt(e.target.value))}
                        helpLabel="Set the number of pieces in the gear set to be met by the gear you equip."
                    />
                </div>
                {editingValue ? (
                    <>
                        <Button type="submit" disabled={!selectedSet} variant="primary">
                            Save
                        </Button>
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    </>
                ) : (
                    <Button type="submit" disabled={!selectedSet} variant="secondary">
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
```

Make sure `useEffect` is imported alongside `useState` and `useRef`.

- [ ] **Step 3: Add `onUpdateSetPriority` prop**

In `AutogearSettingsProps` interface:
```ts
onUpdateSetPriority: (index: number, priority: SetPriority) => void;
```

Destructure it in the component signature.

- [ ] **Step 4: Wire form ref + edit-mode into the SetPriorityForm invocation**

Find `<SetPriorityForm onAdd={onAddSetPriority} />` (~line 305) and replace:

```tsx
<div className="card space-y-2" data-tutorial="autogear-set-priorities" ref={setPriorityFormRef}>
    <SetPriorityForm
        onAdd={onAddSetPriority}
        editingValue={
            editTarget?.kind === 'setPriority' ? setPriorities[editTarget.index] : undefined
        }
        onSave={(priority) => {
            if (editTarget?.kind === 'setPriority') {
                onUpdateSetPriority(editTarget.index, priority);
                setEditTarget(null);
            }
        }}
        onCancel={cancelEdit}
    />
</div>
```

Note: the existing wrapper `<div className="card ...">` becomes the ref host — make sure the ref is on the same element that has the card class.

- [ ] **Step 5: Replace inline set priority row JSX with `<SetPriorityRow />`**

Find the existing block (~line 466-482). Replace with:

```tsx
{setPriorities.length > 0 && (
    <>
        <h3 className="font-semibold">Set Priority List</h3>
        {setPriorities.map((priority, index) => (
            <SetPriorityRow
                key={index}
                priority={priority}
                isEditing={
                    editTarget?.kind === 'setPriority' && editTarget.index === index
                }
                onUpdate={(updated) => onUpdateSetPriority(index, updated)}
                onEdit={() => startEdit({ kind: 'setPriority', index })}
                onRemove={() => {
                    if (
                        editTarget?.kind === 'setPriority' &&
                        editTarget.index === index
                    ) {
                        setEditTarget(null);
                    }
                    onRemoveSetPriority(index);
                }}
            />
        ))}
    </>
)}
```

Add to the imports:
```ts
import { SetPriorityRow } from './SetPriorityRow';
```

- [ ] **Step 6: Add `onUpdateSetPriority` to modal + page**

In `AutogearSettingsModal.tsx`: add the prop and pass through.

In `AutogearPage.tsx` (search for `onAddSetPriority` ~line 1226), add next to it:

```ts
onUpdateSetPriority={(index, priority) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            setPriorities: config.setPriorities.map((p, i) =>
                i === index ? priority : p
            ),
        });
    }
}}
```

Apply to both `<AutogearSettings>` and `<AutogearSettingsModal>` invocations.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 8: Manual QA — set priorities**

Same checklist as Task 5 step 5, applied to Set Priority List rows.

- [ ] **Step 9: Commit**

```bash
git add src/components/autogear/SetPriorityRow.tsx src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): edit support for set priorities"
```

---

## Task 7: Create StatBonusRow + edit mode for StatBonusForm

**Files:**
- Create: `src/components/autogear/StatBonusRow.tsx`
- Modify: `src/components/autogear/StatBonusForm.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Create `src/components/autogear/StatBonusRow.tsx`**

```tsx
import React from 'react';
import { Button, CloseIcon, InlineNumberEdit } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusRowProps {
    bonus: StatBonus;
    isEditing: boolean;
    onUpdate: (bonus: StatBonus) => void;
    onEdit: () => void;
    onRemove: () => void;
}

export const StatBonusRow: React.FC<StatBonusRowProps> = ({
    bonus,
    isEditing,
    onUpdate,
    onEdit,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <span>
                {STATS[bonus.stat as StatName].label} ({' '}
                <InlineNumberEdit
                    value={bonus.percentage}
                    onSave={(v) => v !== undefined && onUpdate({ ...bonus, percentage: v })}
                    min={0}
                    disabled={isEditing}
                >
                    {bonus.percentage}
                </InlineNumberEdit>
                {'%) — '}
                <span className="text-xs text-theme-text-secondary">
                    {bonus.mode === 'multiplier' ? 'Multiplier' : 'Additive'}
                </span>
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit bonus"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
            >
                Edit
            </Button>
            <Button aria-label="Remove bonus" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
```

- [ ] **Step 2: Add edit-mode props to `StatBonusForm.tsx`**

Update props:
```ts
interface StatBonusFormProps {
    onAdd: (bonus: StatBonus) => void;
    existingBonuses: StatBonus[];
    onRemove: (index: number) => void;
    editingValue?: StatBonus;
    onSave?: (bonus: StatBonus) => void;
    onCancel?: () => void;
}
```

In the component:

```tsx
import React, { useEffect, useState } from 'react';
// ...

export const StatBonusForm: React.FC<StatBonusFormProps> = ({
    onAdd,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);
    const [mode, setMode] = useState<'additive' | 'multiplier'>('additive');

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat as StatName);
            setPercentage(editingValue.percentage);
            setMode(editingValue.mode);
        }
    }, [editingValue]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedStat) return;
        const value = { stat: selectedStat, percentage, mode };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedStat('');
        setPercentage(0);
    };

    // ... helpText unchanged ...

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-2">
                <div className="flex gap-4 items-end">
                    {/* existing Select / Input / Select fields unchanged */}
                    {editingValue ? (
                        <>
                            <Button type="submit" disabled={!selectedStat} variant="primary">
                                Save
                            </Button>
                            <Button type="button" variant="secondary" onClick={onCancel}>
                                Cancel
                            </Button>
                        </>
                    ) : (
                        <Button type="submit" disabled={!selectedStat} variant="secondary">
                            Add
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
};
```

- [ ] **Step 3: Wire StatBonusForm + StatBonusRow in `AutogearSettings.tsx`**

Add prop to the interface:
```ts
onUpdateStatBonus: (index: number, bonus: StatBonus) => void;
```

Wrap the bonus form's container with the ref:
```tsx
<div className="card space-y-2" data-tutorial="autogear-stat-bonuses" ref={statBonusFormRef}>
    <h3 className="font-semibold">Stat Bonuses</h3>
    <p className="text-sm text-theme-text-secondary">...</p>
    <StatBonusForm
        onAdd={onAddStatBonus}
        existingBonuses={statBonuses}
        onRemove={onRemoveStatBonus}
        editingValue={
            editTarget?.kind === 'statBonus' ? statBonuses[editTarget.index] : undefined
        }
        onSave={(bonus) => {
            if (editTarget?.kind === 'statBonus') {
                onUpdateStatBonus(editTarget.index, bonus);
                setEditTarget(null);
            }
        }}
        onCancel={cancelEdit}
    />
</div>
```

Replace the inline bonus rendering loop with `<StatBonusRow />`:

```tsx
{statBonuses.map((bonus, index) => (
    <StatBonusRow
        key={index}
        bonus={bonus}
        isEditing={editTarget?.kind === 'statBonus' && editTarget.index === index}
        onUpdate={(updated) => onUpdateStatBonus(index, updated)}
        onEdit={() => startEdit({ kind: 'statBonus', index })}
        onRemove={() => {
            if (editTarget?.kind === 'statBonus' && editTarget.index === index) {
                setEditTarget(null);
            }
            onRemoveStatBonus(index);
        }}
    />
))}
```

Import:
```ts
import { StatBonusRow } from './StatBonusRow';
```

- [ ] **Step 4: Modal pass-through + page handler**

`AutogearSettingsModal.tsx`: add `onUpdateStatBonus` prop + pass through.

`AutogearPage.tsx` (search for `onAddStatBonus` ~line 1251):

```ts
onUpdateStatBonus={(index, bonus) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            statBonuses: config.statBonuses.map((b, i) =>
                i === index ? bonus : b
            ),
        });
    }
}}
```

Apply to both component usages.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 6: Manual QA — full pass across all three lists**

Repeat the Task 5 step 5 checklist for all three lists. Pay attention to:
- Single-active-edit: starting an edit on Stat Bonus row clears any in-progress Stat Priority edit, etc.
- Scroll-and-expand works for each form (both modal and inline page contexts).
- The autogear settings modal (used elsewhere in the app) also works — search for `<AutogearSettingsModal` in `src/` to find where it's invoked, and verify edit flow there.

- [ ] **Step 7: Commit**

```bash
git add src/components/autogear/StatBonusRow.tsx src/components/autogear/StatBonusForm.tsx src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): edit support for stat bonuses"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full test suite + lint + typecheck**

```bash
npm test
npm run lint
npx tsc --noEmit
```

All clean.

- [ ] **Step 2: Production build smoke test**

```bash
npm run build
```

Builds without errors.

- [ ] **Step 3: Manual QA — full feature pass**

Run `npm start`. Walk through every interaction in the spec's acceptance scenarios:

1. **Inline number edit** on each list:
   - Stat Priority: `min`, `max`, `weight` all clickable; clearing `min`/`max` removes the chunk; clearing `weight` reverts (allowEmpty=false).
   - Set Priority: `count` clickable; clamped 0–6; empty reverts.
   - Stat Bonus: `percentage` clickable; min 0; empty reverts.
2. **Edit button** on each list:
   - Click → form scrolls into view, fills, shows Save+Cancel.
   - Save replaces at original index.
   - Cancel exits without changes.
   - Changing the stat name during edit doesn't create a duplicate.
3. **Single-active-edit constraint:**
   - Editing row A in list X, then clicking Edit on row B in list Y → A clears its `(editing)` mark, B gains it.
4. **Collapsed Secondary Priorities:**
   - When Secondary Priorities is collapsed, clicking Edit auto-expands it, then scrolls.
5. **Tutorial integration:**
   - The autogear-settings tutorial still triggers correctly (tests `data-tutorial` selectors that should still resolve to the same wrapper divs).
6. **Documentation page (`src/pages/DocumentationPage.tsx`):**
   - Per CLAUDE.md, update the Autogear section if it documents the priority list interactions. Search for "stat priorit" and "set priorit" inside `DocumentationPage.tsx`. Add a brief note about the new Edit button + inline edit if appropriate.

If documentation needs updating, do it now in a separate commit:

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: note autogear settings edit affordances"
```

- [ ] **Step 4: Final commit if any leftover formatting**

```bash
npm run format
git add -A
git diff --cached --quiet || git commit -m "chore: format"
```

---

## Notes for the implementer

- **DRY:** The three rows have very similar shapes but different field labels. Don't extract a shared `<Row>` until the third one is in place — premature abstraction will obscure the field-specific text. After Task 7, if all three rows look mechanically identical, consider a small follow-up refactor; if they don't, leave them be.
- **Tests:** Heavy unit tests on `InlineNumberEdit` (deterministic, isolated). Manual QA on the rows and forms (per project convention — see CLAUDE.md "UI components (integration testing via manual QA)"). Don't write component tests for the rows or forms unless a bug forces it.
- **Scroll timing:** If `requestAnimationFrame` lands before `CollapsibleForm`'s expand transition settles, the form may not be in the viewport. If you observe this, switch the timing to `setTimeout(() => ref.current?.scrollIntoView(...), 300)`. Verify visually.
- **Modal mirror:** `AutogearSettingsModal.tsx` mirrors the prop interface. Every `onUpdate*` prop must be passed through there too — easy to forget.
- **Existing upsert in `onAddPriority`:** Don't remove the existing upsert-by-stat in `onAddPriority`/`onAddSetPriority`/`onAddStatBonus` — it serves the Add flow correctly. The new `onUpdate*` handlers replace strictly at index for the Edit flow.
