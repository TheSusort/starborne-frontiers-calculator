# Autogear Settings Modal Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the autogear settings modal per `docs/plans/2026-04-25-autogear-settings-redesign-design.md` — collapse the six rarely-changed option toggles into an "Advanced options" accordion, replace the always-visible Secondary Priorities forms with a "Your tweaks" centerpiece (list → picker → form sub-flow), add up/down reorder chevrons on each tweak row, and apply plain-language copy throughout.

**Architecture:** Lands on top of the merged edit work (commit `9d0a68e`). A new `TweakView` state machine inside `AutogearSettings.tsx` drives three sub-views (list / picker / form) inside a unified "Your tweaks" card. The existing `EditTarget`/`startEdit` machinery from the edit plan is **replaced** by `TweakView` — row Edit clicks route directly into the form sub-view instead of expanding a Secondary Priorities accordion. Reorder is implemented via three new array-splice handlers in `AutogearPage.tsx`. Tutorial steps consolidate from seven to three by retargeting the picker/options surfaces.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Vitest, React Testing Library.

**Spec:** `docs/plans/2026-04-25-autogear-settings-redesign-design.md`

---

## File Structure

**New files:**
- `src/utils/arrayMove.ts` — pure helper for reordering array items by index pair
- `src/utils/__tests__/arrayMove.test.ts`

**Modified files:**
- `src/components/autogear/AutogearSettings.tsx` — biggest changes (sections 1, 7, 8, 9 of the plan)
- `src/components/autogear/AutogearSettingsModal.tsx` — prop pass-through for three new move handlers
- `src/components/autogear/StatPriorityRow.tsx` — chevrons + Hard Requirement copy
- `src/components/autogear/SetPriorityRow.tsx` — chevrons
- `src/components/autogear/StatBonusRow.tsx` — chevrons
- `src/pages/manager/AutogearPage.tsx` — three new move handlers, threaded to both `<AutogearSettings>` and `<AutogearSettingsModal>` invocations
- `src/constants/tutorialSteps.ts` — consolidate seven autogear-settings steps to three, retarget `data-tutorial` ids

---

## Task 1: `arrayMove` utility (TDD)

**Files:**
- Create: `src/utils/arrayMove.ts`
- Create: `src/utils/__tests__/arrayMove.test.ts`

**Behavior contract:**
- `arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[]` returns a new array with the item at `fromIndex` moved to `toIndex`.
- Out-of-range indices (`< 0` or `>= length`) → return the original array unchanged (no throw).
- `fromIndex === toIndex` → return the original array reference unchanged (cheap no-op).
- Does not mutate the input.

- [ ] **Step 1: Write failing tests**

Create `src/utils/__tests__/arrayMove.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arrayMove } from '../arrayMove';

describe('arrayMove', () => {
    it('moves item forward', () => {
        expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves item backward', () => {
        expect(arrayMove(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('returns same reference when from === to', () => {
        const input = ['a', 'b', 'c'];
        expect(arrayMove(input, 1, 1)).toBe(input);
    });

    it('returns same reference when fromIndex is out of range', () => {
        const input = ['a', 'b', 'c'];
        expect(arrayMove(input, -1, 1)).toBe(input);
        expect(arrayMove(input, 3, 1)).toBe(input);
    });

    it('returns same reference when toIndex is out of range', () => {
        const input = ['a', 'b', 'c'];
        expect(arrayMove(input, 0, -1)).toBe(input);
        expect(arrayMove(input, 0, 3)).toBe(input);
    });

    it('does not mutate the input', () => {
        const input = ['a', 'b', 'c'];
        const snapshot = [...input];
        arrayMove(input, 0, 2);
        expect(input).toEqual(snapshot);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest --run src/utils/__tests__/arrayMove.test.ts`
Expected: all tests fail (module not found).

- [ ] **Step 3: Implement `arrayMove`**

Create `src/utils/arrayMove.ts`:

```ts
export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
    if (fromIndex === toIndex) return array;
    if (fromIndex < 0 || fromIndex >= array.length) return array;
    if (toIndex < 0 || toIndex >= array.length) return array;
    const next = array.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest --run src/utils/__tests__/arrayMove.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/arrayMove.ts src/utils/__tests__/arrayMove.test.ts
git commit -m "feat(utils): add arrayMove helper"
```

---

## Task 2: Move handlers in `AutogearPage.tsx` + prop pass-through

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx` (props interface only)
- Modify: `src/components/autogear/AutogearSettingsModal.tsx` (props interface + pass-through)
- Modify: `src/pages/manager/AutogearPage.tsx` (handlers + invocation)

- [ ] **Step 1: Add three new props to `AutogearSettingsProps`**

In `src/components/autogear/AutogearSettings.tsx`, in the `AutogearSettingsProps` interface (search for the interface around line 60):

```ts
onMovePriority: (fromIndex: number, toIndex: number) => void;
onMoveSetPriority: (fromIndex: number, toIndex: number) => void;
onMoveStatBonus: (fromIndex: number, toIndex: number) => void;
```

Destructure them in the component signature alongside the other handlers. The component body will use them in Task 3–5; for now just thread them through (destructure and ignore).

- [ ] **Step 2: Mirror in `AutogearSettingsModal.tsx`**

Add the same three props to the modal's `AutogearSettingsModalProps` interface, and they'll already be spread via `{...settingsProps}` (verify by reading the existing pass-through pattern around line 50).

- [ ] **Step 3: Implement handlers in `AutogearPage.tsx`**

Find the single `<AutogearSettingsModal ...>` invocation (around line 1134) — that is the only call site. Locate the existing `onUpdatePriority` / `onUpdateSetPriority` / `onUpdateStatBonus` props for context.

Add the import at the top:

```ts
import { arrayMove } from '../../utils/arrayMove';
```

Add three handlers next to the existing `onUpdate*` handlers on the modal invocation:

```tsx
onMovePriority={(fromIndex, toIndex) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            statPriorities: arrayMove(config.statPriorities, fromIndex, toIndex),
        });
    }
}}
onMoveSetPriority={(fromIndex, toIndex) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            setPriorities: arrayMove(config.setPriorities, fromIndex, toIndex),
        });
    }
}}
onMoveStatBonus={(fromIndex, toIndex) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            statBonuses: arrayMove(config.statBonuses, fromIndex, toIndex),
        });
    }
}}
```

(There is only one invocation — `<AutogearSettingsModal>`. Confirm with `grep -n "<AutogearSettings" src/pages/manager/AutogearPage.tsx` if you want to double-check.)

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): add reorder handlers for tweaks"
```

---

## Task 3: Up/down chevrons on `StatPriorityRow`

**Files:**
- Modify: `src/components/autogear/StatPriorityRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx` (pass new props at the row invocation)

**Row contract additions:**
```ts
canMoveUp: boolean;
canMoveDown: boolean;
onMoveUp: () => void;
onMoveDown: () => void;
```

- [ ] **Step 1: Update `StatPriorityRow.tsx`**

At the top, add to the imports (replace the existing `Button, CloseIcon, ...` import line by adding `ChevronUpIcon, ChevronDownIcon`):

```ts
import { Button, ChevronUpIcon, ChevronDownIcon, CloseIcon, EditIcon, InlineNumberEdit, Tooltip } from '../ui';
```

(If `EditIcon` import already exists, leave it; just add the chevrons.)

Update the props interface:

```ts
interface StatPriorityRowProps {
    priority: StatPriority;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (priority: StatPriority) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}
```

Inside the component (`StatPriorityRow`), prepend a chevron group **before** the existing `<span>` text content. Replace the outer `<div className="flex items-center text-sm gap-2 ...">` body so its first children are the chevrons:

```tsx
return (
    <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
        <div className="flex flex-col">
            <Button
                aria-label="Move priority up"
                variant="secondary"
                size="xs"
                onClick={onMoveUp}
                disabled={!canMoveUp || isEditing}
                className="!p-0.5"
            >
                <ChevronUpIcon className="w-3 h-3" />
            </Button>
            <Button
                aria-label="Move priority down"
                variant="secondary"
                size="xs"
                onClick={onMoveDown}
                disabled={!canMoveDown || isEditing}
                className="!p-0.5"
            >
                <ChevronDownIcon className="w-3 h-3" />
            </Button>
        </div>
        <span>
            {/* ...existing stat label + InlineNumberEdit chunks unchanged... */}
        </span>
        {/* ...existing Edit + Remove buttons unchanged... */}
    </div>
);
```

(Keep all the existing `<span>` content for stat label / min / max / weight / hard requirement intact — just prepend the chevron group.)

- [ ] **Step 2: Pass new props in `AutogearSettings.tsx`**

Find the `<StatPriorityRow ... />` invocation. Add the four new props:

```tsx
<StatPriorityRow
    key={index}
    priority={priority}
    isEditing={editTarget?.kind === 'priority' && editTarget.index === index}
    canMoveUp={index > 0}
    canMoveDown={index < priorities.length - 1}
    onUpdate={(updated) => onUpdatePriority(index, updated)}
    onEdit={() => startEdit({ kind: 'priority', index })}
    onMoveUp={() => onMovePriority(index, index - 1)}
    onMoveDown={() => onMovePriority(index, index + 1)}
    onRemove={() => {
        if (editTarget?.kind === 'priority' && editTarget.index === index) {
            setEditTarget(null);
        }
        onRemovePriority(index);
    }}
/>
```

- [ ] **Step 3: Verify build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Manual QA**

Run: `npm start`. In a browser:
1. Open the autogear page, select a ship, set a role with stat priorities, open Settings modal, expand Secondary Priorities.
2. Verify each priority row has up/down chevrons on the left.
3. Top row: up chevron is disabled.
4. Bottom row: down chevron is disabled.
5. Click down on row 1 → rows 1 and 2 swap. Click up on row 2 (now at index 0... wait, on whichever was just at index 0) → swaps back.
6. Click Edit on a row → chevrons disable across the row while in edit mode.
7. Verify the change persists across modal close/reopen (i.e. `updateShipConfig` actually wrote).

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/StatPriorityRow.tsx src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): reorder chevrons on stat priority rows"
```

---

## Task 4: Up/down chevrons on `SetPriorityRow`

**Files:**
- Modify: `src/components/autogear/SetPriorityRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`

Identical pattern to Task 3, applied to the set-priorities list.

- [ ] **Step 1: Update `SetPriorityRow.tsx`**

Add `ChevronUpIcon`, `ChevronDownIcon` to the existing UI import. Update props:

```ts
interface SetPriorityRowProps {
    priority: SetPriority;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (priority: SetPriority) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}
```

Prepend the same chevron group as Task 3 Step 1 (with `aria-label="Move set priority up/down"`).

- [ ] **Step 2: Pass new props in `AutogearSettings.tsx`**

Find the `<SetPriorityRow ... />` invocation. Wire the same way as the priority row (using `setPriorities.length` for the boundary, `onMoveSetPriority` for the handler).

- [ ] **Step 3: Verify build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Manual QA**

Add 2+ set requirements to a ship, verify chevrons reorder them, boundaries disable correctly, edit-mode disables them.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/SetPriorityRow.tsx src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): reorder chevrons on set priority rows"
```

---

## Task 5: Up/down chevrons on `StatBonusRow`

**Files:**
- Modify: `src/components/autogear/StatBonusRow.tsx`
- Modify: `src/components/autogear/AutogearSettings.tsx`

Identical pattern, applied to the stat bonuses list.

- [ ] **Step 1: Update `StatBonusRow.tsx`**

Add chevron icons to imports. Update props:

```ts
interface StatBonusRowProps {
    bonus: StatBonus;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (bonus: StatBonus) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}
```

Prepend chevron group (`aria-label="Move bonus up/down"`).

- [ ] **Step 2: Pass new props in `AutogearSettings.tsx`**

Wire the `<StatBonusRow ... />` invocation with `statBonuses.length` boundary + `onMoveStatBonus` handler.

- [ ] **Step 3: Verify build + lint + manual QA + commit**

Same checks as Task 4.

```bash
git add src/components/autogear/StatBonusRow.tsx src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): reorder chevrons on stat bonus rows"
```

---

## Task 6: Update Hard Requirement tooltip copy

**Files:**
- Modify: `src/components/autogear/StatPriorityRow.tsx`
- Modify: `src/components/stats/StatPriorityForm.tsx`

The same `"this time it's personal"` joke tooltip appears in two places: the row component (when displayed in the configured list) and the form component (when adding/editing a priority and ticking Hard Requirement). Update both.

- [ ] **Step 1: Update tooltip text in `StatPriorityRow.tsx`**

Find the line:
```tsx
<p className="text-xs">this time it&apos;s personal</p>
```

Replace with:
```tsx
<p className="text-xs">Skip the entire suggestion if this stat target isn&apos;t reachable.</p>
```

- [ ] **Step 2: Update tooltip text in `StatPriorityForm.tsx`**

The same line exists at `src/components/stats/StatPriorityForm.tsx:168`. Apply the same replacement.

- [ ] **Step 3: Verify build + manual QA**

Run: `npx tsc --noEmit && npm run lint`

In browser:
- Hover the "— Hard Requirement" amber text on a configured row → tooltip shows new copy.
- Open the Add tweak / Edit form for a stat priority, tick the Hard Requirement checkbox, hover the matching info element → tooltip shows the same new copy.

- [ ] **Step 4: Commit**

```bash
git add src/components/autogear/StatPriorityRow.tsx src/components/stats/StatPriorityForm.tsx
git commit -m "feat(autogear): clarify Hard Requirement tooltip copy"
```

---

## Task 7: Strategy section relabel + reset → icon button

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

The current Strategy card (around line 285–306 — find by searching for `data-tutorial="autogear-role-selector"`) shows:

```tsx
<div className="card space-y-2" data-tutorial="autogear-role-selector">
    <div className="flex justify-between items-center">
        <span className="text-sm">Predefined Strategies</span>
        {selectedShip && (
            <Button
                variant="danger"
                size="sm"
                onClick={onResetConfig}
                className="text-xs"
            >
                Reset Configuration
            </Button>
        )}
    </div>
    <RoleSelector
        value={selectedShipRole || ''}
        onChange={onRoleSelect}
        noDefaultSelection
        defaultOption="Manual"
    />
</div>
```

- [ ] **Step 1: Replace caption + reset button**

Replace the whole `<div className="flex justify-between items-center">` block above with a more compact layout. Also need to import a refresh/reset icon — check `src/components/ui/icons/` for an existing one:

Run: `ls src/components/ui/icons/ | grep -i "refresh\|reset\|restore\|reload\|repeat"`

If one exists, use it. If not, render the unicode `↺` symbol as button content (no new icon file — YAGNI).

Updated Strategy card body:

```tsx
<div className="card space-y-2" data-tutorial="autogear-role-selector">
    <span className="text-xs uppercase tracking-wide text-theme-text-secondary">Strategy</span>
    <div className="flex gap-2 items-center">
        <div className="flex-1">
            <RoleSelector
                value={selectedShipRole || ''}
                onChange={onRoleSelect}
                noDefaultSelection
                defaultOption="Manual"
            />
        </div>
        {selectedShip && (
            <Button
                aria-label="Reset to role defaults"
                title="Reset to role defaults"
                variant="secondary"
                size="sm"
                onClick={onResetConfig}
            >
                ↺
            </Button>
        )}
    </div>
</div>
```

- [ ] **Step 2: Verify build + lint**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 3: Manual QA**

Open modal → Strategy caption reads "STRATEGY" in small caps; dropdown stretches; reset is a small icon button to the right with hover tooltip.

- [ ] **Step 4: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): compact strategy section with icon reset"
```

---

## Task 8: Stat Bonus form caption + Mode as radio group with tooltips

**Files:**
- Modify: `src/components/autogear/StatBonusForm.tsx`

Per spec section "Stat Bonus form specifically" (`docs/plans/2026-04-25-autogear-settings-redesign-design.md`) and the Copy changes summary, the form needs:

1. A trimmed leading caption inside the form: *"Make scoring scale with another stat. Pick Additive or Multiplier below."* (replaces the long header paragraph that lives in `AutogearSettings.tsx` today and is removed in Task 10 Step 3).
2. Mode picker converted from a `Select` to a two-button radio-style group, with **per-option hover tooltips** showing the additive/multiplier explanations.

The current `helpLabel` on the `Select` shows mode-specific text but is bound to label-level info and does not satisfy "per-radio tooltips" (Copy changes table rows for Additive/Multiplier).

- [ ] **Step 1: Add the caption + restructure the Mode picker**

In `src/components/autogear/StatBonusForm.tsx`, modify the imports to include `Tooltip`:

```ts
import { Button, Select, Input, Tooltip } from '../ui';
```

Add tooltip refs + visibility state at the top of the component body (alongside the existing `useState` hooks):

```ts
const additiveRef = useRef<HTMLButtonElement>(null);
const multiplierRef = useRef<HTMLButtonElement>(null);
const [showAdditiveTip, setShowAdditiveTip] = useState(false);
const [showMultiplierTip, setShowMultiplierTip] = useState(false);
```

Add `useRef` to the existing React imports.

Inside the form's outermost `<div>` (above the existing `<form>`), prepend the caption:

```tsx
<p className="text-sm text-theme-text-secondary">
    Make scoring scale with another stat. Pick Additive or Multiplier below.
</p>
```

Within the existing `<div className="flex gap-4 items-end">` row, replace the Mode `<Select ...>` with a labelled radio-style button group:

```tsx
<div>
    <span className="block text-xs uppercase tracking-wide text-theme-text-secondary mb-1">
        Mode
    </span>
    <div className="flex gap-2">
        <Button
            ref={additiveRef}
            type="button"
            variant={mode === 'additive' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMode('additive')}
            onMouseEnter={() => setShowAdditiveTip(true)}
            onMouseLeave={() => setShowAdditiveTip(false)}
        >
            Additive
        </Button>
        <Tooltip
            isVisible={showAdditiveTip}
            targetElement={additiveRef.current}
            className="bg-dark border border-dark-lighter p-2 max-w-xs"
        >
            <p className="text-xs">
                Adds stat × % directly to the role score (e.g. defense @ 80% for a skill
                dealing 80% of defense as damage).
            </p>
        </Tooltip>
        <Button
            ref={multiplierRef}
            type="button"
            variant={mode === 'multiplier' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMode('multiplier')}
            onMouseEnter={() => setShowMultiplierTip(true)}
            onMouseLeave={() => setShowMultiplierTip(false)}
        >
            Multiplier
        </Button>
        <Tooltip
            isVisible={showMultiplierTip}
            targetElement={multiplierRef.current}
            className="bg-dark border border-dark-lighter p-2 max-w-xs"
        >
            <p className="text-xs">
                Multiplies the role score by stat × % (e.g. hacking @ 50% makes DPS scale with
                hacking).
            </p>
        </Tooltip>
    </div>
</div>
```

(The `Button` component already accepts a `ref` via `forwardRef` if it's set up that way; if not, wrap each in a `<span ref={additiveRef}>`/`<span ref={multiplierRef}>` and apply `onMouseEnter`/`onMouseLeave` on the span instead. Verify by inspecting `src/components/ui/Button.tsx` first.)

The `helpText` constant and the now-unused `helpLabel` props on the Stat select / Percentage input can be **removed** (the explanation lives in the Mode tooltips now). Keep the `Stat` and `Percentage` field labels intact.

- [ ] **Step 2: Verify build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Manual QA**

Open the autogear modal, set a role, expand Secondary Priorities (still present pre-Task 10), scroll to the Stat Bonuses card, attempt to add a stat bonus:
1. Caption "Make scoring scale with another stat. Pick Additive or Multiplier below." appears above the form fields.
2. Mode picker shows two side-by-side buttons; the active one has the primary color treatment.
3. Hover Additive → tooltip with the additive explanation.
4. Hover Multiplier → tooltip with the multiplier explanation.
5. Clicking a button switches the active mode.
6. Submitting a bonus still adds it correctly (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/components/autogear/StatBonusForm.tsx
git commit -m "feat(autogear): radio mode picker + per-option tooltips on stat bonus form"
```

---

## Task 9: Wrap Options in "Advanced options" accordion

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

Replace the always-visible `<div className="card space-y-2"><h3>Options</h3>...</div>` block (find by searching for `<h3 className="font-semibold">Options</h3>`) with a `CollapsibleAccordion` wrapped in a clickable header that toggles open state and shows a count badge.

- [ ] **Step 1: Add imports**

`CollapsibleAccordion` exists at `src/components/ui/CollapsibleAccordion.tsx` but is **not** currently exported from `src/components/ui/index.tsx`. Add the export there first:

```ts
export { CollapsibleAccordion } from './CollapsibleAccordion';
```

(Place it alongside `export * from './layout/CollapsibleForm';` in the barrel.)

Then in `AutogearSettings.tsx`, add to the existing UI import:

```ts
import { ..., CollapsibleAccordion, ChevronDownIcon, ... } from '../ui';
```

(`ChevronDownIcon` is already exported from `../ui/icons/ChevronIcons.tsx` via the barrel.)

- [ ] **Step 2: Add local state for the accordion + a count helper**

Inside the `AutogearSettings` component (with the other `useState` declarations), add:

```ts
const [advancedOpen, setAdvancedOpen] = useState(false);
```

Compute the enabled count near the top of the render body (just before `return (`):

```ts
const advancedEnabledCount =
    (ignoreEquipped ? 1 : 0) +
    (ignoreUnleveled ? 1 : 0) +
    (useUpgradedStats ? 1 : 0) +
    (tryToCompleteSets ? 1 : 0) +
    (optimizeImplants ? 1 : 0) +
    (includeCalibratedGear ? 1 : 0) +
    (activeSeason && useArenaModifiers ? 1 : 0);
const advancedTotal = activeSeason ? 7 : 6;
```

- [ ] **Step 3: Replace the Options card block**

Find the block starting `<div className="card space-y-2"><h3 className="font-semibold">Options</h3>` and ending at its closing `</div>` (the matching outer card div). Replace with:

```tsx
<div className="card space-y-2">
    <Button
        variant="link"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="w-full flex justify-between items-center"
        data-tutorial="autogear-advanced-options"
    >
        <span className="flex items-center gap-2">
            <ChevronDownIcon
                className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${
                    advancedOpen ? 'rotate-180' : ''
                }`}
            />
            Advanced options
        </span>
        <span className="text-xs text-theme-text-secondary">
            {advancedEnabledCount} of {advancedTotal} enabled
        </span>
    </Button>
    <CollapsibleAccordion isOpen={advancedOpen}>
        <div className="space-y-2">
            {/* existing checkbox blocks UNCHANGED — copy them verbatim from current file:
                - data-tutorial="autogear-ignore-options" group
                - data-tutorial="autogear-upgrade-options" group
                - data-tutorial="autogear-extra-options" group + arena-modifiers block
              */}
        </div>
    </CollapsibleAccordion>
</div>
```

(Move all existing checkbox markup verbatim into the `CollapsibleAccordion`'s inner `<div className="space-y-2">`.)

Make sure `ChevronDownIcon` is in the UI imports if not already.

- [ ] **Step 4: Verify build + lint**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 5: Manual QA**

1. Open modal → "Advanced options (X of Y enabled)" header visible, accordion closed.
2. Click header → expands smoothly, all 6 (or 7 with arena) checkboxes visible.
3. Toggle a checkbox → count updates immediately.
4. Close modal → reopen → accordion is closed again (no persistence — by design).

- [ ] **Step 6: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): collapse options into Advanced accordion"
```

---

## Task 10: TweakView state machine + "Your tweaks" centerpiece (the big one)

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`
- Modify: `src/constants/tutorialSteps.ts`

This task replaces the always-visible Secondary Priorities forms + the Show/Hide toggle + the bottom-of-modal configured-items section with a single unified "Your tweaks" card driven by a `TweakView` state machine. The existing `EditTarget`/`startEdit` machinery is **removed** and replaced. Tutorial steps are also retargeted in this task because the DOM structure changes.

Read the spec's "Your tweaks section" and "Sub-flow state" sections (`docs/plans/2026-04-25-autogear-settings-redesign-design.md`) for the full visual contract.

- [ ] **Step 1: Add TweakView type + state**

In `AutogearSettings.tsx`, replace the existing `EditTarget` type with `TweakView`:

```ts
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus'; editIndex: number | null };
```

Inside the `AutogearSettings` component, replace the `editTarget` state and `startEdit`/`cancelEdit` helpers:

```ts
const [tweakView, setTweakView] = useState<TweakView>({ mode: 'list' });

const openPicker = () => setTweakView({ mode: 'picker' });
const openForm = (type: 'priority' | 'setPriority' | 'statBonus', editIndex: number | null = null) =>
    setTweakView({ mode: 'form', type, editIndex });
const backToList = () => setTweakView({ mode: 'list' });

// derived helpers
const isEditingPriority = (index: number) =>
    tweakView.mode === 'form' && tweakView.type === 'priority' && tweakView.editIndex === index;
const isEditingSetPriority = (index: number) =>
    tweakView.mode === 'form' && tweakView.type === 'setPriority' && tweakView.editIndex === index;
const isEditingStatBonus = (index: number) =>
    tweakView.mode === 'form' && tweakView.type === 'statBonus' && tweakView.editIndex === index;

const isSubFlow = tweakView.mode !== 'list';
```

Remove the form refs (`priorityFormRef`, `setPriorityFormRef`, `statBonusFormRef`) — no longer needed since the sub-flow renders forms in place.

Remove the `useTutorial` auto-expand effect (search for `activeGroup?.id === 'autogear-settings'`) — no longer applicable since Secondary Priorities goes away. After deletion, the `useTutorial` import becomes unused — remove the line `import { useTutorial } from '../../contexts/TutorialContext';` to keep `npm run lint` green (or rely on ESLint to surface it).

- [ ] **Step 2: Remove the Show/Hide Secondary Priorities toggle**

Find the `{selectedShipRole && (` block that contains the `<Button variant="link" ...>{showSecondaryRequirements ? 'Hide' : 'Show'} Secondary Priorities</Button>` and its surrounding tooltip. **Delete the entire block.**

Also delete:
- The `showSecondaryRequirementsTooltip` `useState` and `secondaryRequirementsTooltipRef`.
- The `<CollapsibleForm isVisible={...}>` wrapper around the three forms (we'll replace what's inside next).
- The `showSecondaryRequirements` and `onToggleSecondaryRequirements` props can stay in the interface (still used by parent state? — verify) but are no longer consumed by this component. **If `AutogearPage.tsx` only reads/writes them via this component, remove them entirely** — search `showSecondaryRequirements` across the codebase to confirm.

- [ ] **Step 3: Remove the existing always-visible forms + the bottom configured-items card**

Find and delete:
- The `<div data-tutorial="autogear-stat-priorities"><StatPriorityForm ... /></div>` block.
- The `<div className="card space-y-2" data-tutorial="autogear-set-priorities" ...><SetPriorityForm ... /></div>` block.
- The `<div className="card space-y-2" data-tutorial="autogear-stat-bonuses" ...><h3>Stat Bonuses</h3><p>...</p><StatBonusForm ... /></div>` block.
- The `{(statBonuses.length > 0 || priorities.length > 0 || setPriorities.length > 0) && (...)` block at the bottom that renders the configured rows. (We'll re-render those inside the new "Your tweaks" card.)

The Stat Bonuses long header paragraph (`"Add stat bonuses that contribute to the role score..."`) is removed in this step.

- [ ] **Step 4: Build the new "Your tweaks" card**

Insert this block in the position where the old Secondary Priorities sections used to live (between Strategy and Advanced options):

```tsx
{selectedShipRole && (
    <div className={`card space-y-3 ${isSubFlow ? 'ring-1 ring-theme-primary' : ''}`}>
        {tweakView.mode === 'list' && (
            <>
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold">
                        Your tweaks{' '}
                        <span className="font-normal text-theme-text-secondary">
                            ({priorities.length + setPriorities.length + statBonuses.length})
                        </span>
                    </h3>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={openPicker}
                        data-tutorial="autogear-add-tweak"
                    >
                        + Add tweak
                    </Button>
                </div>

                {priorities.length + setPriorities.length + statBonuses.length === 0 ? (
                    <p className="text-sm text-theme-text-secondary text-center py-4">
                        No tweaks yet. The role&apos;s defaults will be used as-is.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {priorities.length > 0 && (
                            <div className="space-y-1">
                                <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                    Stat priorities
                                </h4>
                                {priorities.map((priority, index) => (
                                    <StatPriorityRow
                                        key={`priority-${index}`}
                                        priority={priority}
                                        isEditing={isEditingPriority(index)}
                                        canMoveUp={index > 0}
                                        canMoveDown={index < priorities.length - 1}
                                        onUpdate={(updated) => onUpdatePriority(index, updated)}
                                        onEdit={() => openForm('priority', index)}
                                        onMoveUp={() => onMovePriority(index, index - 1)}
                                        onMoveDown={() => onMovePriority(index, index + 1)}
                                        onRemove={() => onRemovePriority(index)}
                                    />
                                ))}
                            </div>
                        )}
                        {setPriorities.length > 0 && (
                            <div className="space-y-1">
                                <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                    Set requirements
                                </h4>
                                {setPriorities.map((priority, index) => (
                                    <SetPriorityRow
                                        key={`set-${index}`}
                                        priority={priority}
                                        isEditing={isEditingSetPriority(index)}
                                        canMoveUp={index > 0}
                                        canMoveDown={index < setPriorities.length - 1}
                                        onUpdate={(updated) => onUpdateSetPriority(index, updated)}
                                        onEdit={() => openForm('setPriority', index)}
                                        onMoveUp={() => onMoveSetPriority(index, index - 1)}
                                        onMoveDown={() => onMoveSetPriority(index, index + 1)}
                                        onRemove={() => onRemoveSetPriority(index)}
                                    />
                                ))}
                            </div>
                        )}
                        {statBonuses.length > 0 && (
                            <div className="space-y-1">
                                <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                    Stat bonuses
                                </h4>
                                {statBonuses.map((bonus, index) => (
                                    <StatBonusRow
                                        key={`bonus-${index}`}
                                        bonus={bonus}
                                        isEditing={isEditingStatBonus(index)}
                                        canMoveUp={index > 0}
                                        canMoveDown={index < statBonuses.length - 1}
                                        onUpdate={(updated) => onUpdateStatBonus(index, updated)}
                                        onEdit={() => openForm('statBonus', index)}
                                        onMoveUp={() => onMoveStatBonus(index, index - 1)}
                                        onMoveDown={() => onMoveStatBonus(index, index + 1)}
                                        onRemove={() => onRemoveStatBonus(index)}
                                    />
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-theme-text-secondary italic">
                            Order matters — higher tweaks weigh more.
                        </p>
                    </div>
                )}
            </>
        )}

        {tweakView.mode === 'picker' && (
            <>
                <div className="flex items-center gap-2 text-sm">
                    <Button variant="link" size="sm" onClick={backToList} className="!p-0">
                        ← Your tweaks
                    </Button>
                    <span className="text-theme-text-secondary">·</span>
                    <span>Add tweak</span>
                </div>
                <h3 className="font-semibold">What do you want to add?</h3>
                <div className="space-y-2">
                    <button
                        type="button"
                        className="w-full text-left p-3 bg-dark border border-dark-border hover:border-theme-primary rounded transition-colors"
                        onClick={() => openForm('priority')}
                    >
                        <div className="font-semibold">📊 Stat priority</div>
                        <div className="text-xs text-theme-text-secondary">
                            Prioritize a stat (e.g. crit damage). Optionally set min, max, or weight.
                        </div>
                    </button>
                    <button
                        type="button"
                        className="w-full text-left p-3 bg-dark border border-dark-border hover:border-theme-primary rounded transition-colors"
                        onClick={() => openForm('setPriority')}
                    >
                        <div className="font-semibold">🛡 Set requirement</div>
                        <div className="text-xs text-theme-text-secondary">
                            Require a number of pieces from a gear set (e.g. 2× Stealth).
                        </div>
                    </button>
                    <button
                        type="button"
                        className="w-full text-left p-3 bg-dark border border-dark-border hover:border-theme-primary rounded transition-colors"
                        onClick={() => openForm('statBonus')}
                    >
                        <div className="font-semibold">
                            ⚙ Stat bonus{' '}
                            <span className="text-xs text-theme-text-secondary font-normal">
                                (advanced)
                            </span>
                        </div>
                        <div className="text-xs text-theme-text-secondary">
                            Make scoring scale with another stat (e.g. hacking +50% multiplier).
                        </div>
                    </button>
                </div>
            </>
        )}

        {tweakView.mode === 'form' && (
            <>
                <div className="flex items-center gap-2 text-sm">
                    <Button variant="link" size="sm" onClick={backToList} className="!p-0">
                        ← Your tweaks
                    </Button>
                    <span className="text-theme-text-secondary">·</span>
                    <span>
                        {tweakView.editIndex === null ? 'Add' : 'Edit'}{' '}
                        {tweakView.type === 'priority'
                            ? 'stat priority'
                            : tweakView.type === 'setPriority'
                              ? 'set requirement'
                              : 'stat bonus'}
                    </span>
                </div>
                {tweakView.type === 'priority' && (
                    <StatPriorityForm
                        onAdd={(p) => {
                            onAddPriority(p);
                            backToList();
                        }}
                        existingPriorities={priorities}
                        editingValue={
                            tweakView.editIndex !== null
                                ? priorities[tweakView.editIndex]
                                : undefined
                        }
                        onSave={(p) => {
                            if (tweakView.mode === 'form' && tweakView.editIndex !== null) {
                                onUpdatePriority(tweakView.editIndex, p);
                                backToList();
                            }
                        }}
                        onCancel={backToList}
                    />
                )}
                {tweakView.type === 'setPriority' && (
                    <SetPriorityForm
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
                {tweakView.type === 'statBonus' && (
                    <StatBonusForm
                        onAdd={(b) => {
                            onAddStatBonus(b);
                            backToList();
                        }}
                        editingValue={
                            tweakView.editIndex !== null
                                ? statBonuses[tweakView.editIndex]
                                : undefined
                        }
                        onSave={(b) => {
                            if (tweakView.mode === 'form' && tweakView.editIndex !== null) {
                                onUpdateStatBonus(tweakView.editIndex, b);
                                backToList();
                            }
                        }}
                        onCancel={backToList}
                    />
                )}
            </>
        )}
    </div>
)}
```

Notes:
- The `SetPriorityForm` is currently defined inline at the top of `AutogearSettings.tsx`. It already has `editingValue`/`onSave`/`onCancel` props from the edit plan — the inline definition stays where it is, just the **invocation** moves into the form sub-view.
- `existingPriorities` is passed to `StatPriorityForm` (as it is today) so weight auto-increment continues to work.
- The current StatPriorityForm `onAdd` callback in the existing code wraps with index logic; verify the call signature matches before pasting.

- [ ] **Step 4.5: Dim Strategy + Advanced cards during sub-flow**

Wrap (or modify) the Strategy card and Advanced accordion so they receive `opacity-60 pointer-events-none` classes when `isSubFlow === true`. Easiest approach: add a class conditionally on each card's outer `<div>`:

For Strategy:
```tsx
<div className={`card space-y-2 ${isSubFlow ? 'opacity-60 pointer-events-none' : ''}`} data-tutorial="autogear-role-selector">
```

For Advanced options:
```tsx
<div className={`card space-y-2 ${isSubFlow ? 'opacity-60 pointer-events-none' : ''}`}>
```

Verify the `card` class still composes correctly with the appended classes.

- [ ] **Step 4.6: Add the sticky Find Optimal Gear footer to the modal**

Per spec section "Sticky footer" and acceptance criterion #11, the modal needs a sticky bottom area showing:
- **List view:** primary `Find Optimal Gear` button (full-width).
- **Picker view:** secondary `Cancel` button (returns to list).
- **Form view:** nothing (the form's own Save/Cancel handle action; a duplicate primary CTA would confuse).

Today this button only exists on the autogear page (`AutogearQuickSettings.tsx`); there is no analogous button inside the modal. The modal's wrapper (`AutogearSettingsModal.tsx`) already calls `settingsProps.onFindOptimalGear()` from a `handleFindOptimalGear` helper but never renders it. We hook the new in-modal button to the same prop.

At the **bottom of the `AutogearSettings` component's outer `<div>`** (after the Advanced accordion), append:

```tsx
{tweakView.mode === 'list' && (
    <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-dark border-t border-dark-border">
        <Button
            onClick={onFindOptimalGear}
            variant="primary"
            className="w-full"
            data-testid="autogear-modal-start"
        >
            Find Optimal Gear
        </Button>
    </div>
)}
{tweakView.mode === 'picker' && (
    <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-dark border-t border-dark-border">
        <Button onClick={backToList} variant="secondary" className="w-full">
            Cancel
        </Button>
    </div>
)}
```

(In form view, no footer is rendered — the form's own buttons sit just above the empty space. If the form-view layout looks unanchored, a `<div className="h-16" />` spacer is acceptable.)

The `onFindOptimalGear` prop is already passed through from `AutogearPage` → `AutogearSettingsModal` → `AutogearSettings` (it's used today by `AutogearQuickSettings`, and the modal handler chains close-after-find via `handleFindOptimalGear`). Verify the modal's existing `handleFindOptimalGear` still wires up correctly — the in-modal button will route through it because `AutogearSettingsModal` passes `onFindOptimalGear={handleFindOptimalGear}` to `AutogearSettings` (verify in `AutogearSettingsModal.tsx`).

If `onFindOptimalGear` in the rendered settings actually points to the unwrapped page handler instead of the close-on-finish wrapper, fix the modal pass-through to use `handleFindOptimalGear` so the modal closes when the user clicks Find Optimal Gear.

- [ ] **Step 5: Update tutorial steps**

In `src/constants/tutorialSteps.ts`, find `AUTOGEAR_SETTINGS_TUTORIAL` (around line 97). Replace the entire `steps` array with:

```ts
steps: [
    {
        targetId: 'autogear-role-selector',
        title: 'Strategy',
        description:
            'Pick a role to auto-fill stat priorities, or choose Manual to configure everything yourself.',
    },
    {
        targetId: 'autogear-add-tweak',
        title: 'Your tweaks',
        description:
            'Add stat priorities, set requirements, or stat bonuses on top of the role defaults. Order matters — higher tweaks weigh more. Use the chevrons to reorder, or click Edit to change a value.',
    },
    {
        targetId: 'autogear-advanced-options',
        title: 'Advanced options',
        description:
            'Filters that change which gear is available to the optimizer (ignore equipped, ignore unleveled, use upgraded stats, complete sets, optimize implants, include calibrated). Click to expand.',
    },
],
```

This collapses 7 steps to 3. Run a manual tutorial replay during QA to confirm nothing else is broken.

- [ ] **Step 6: Verify build + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean. (Tests should still all pass — no test references the removed `EditTarget` or `showSecondaryRequirements` symbols, but verify.)

- [ ] **Step 7: Manual QA — full pass**

Run `npm start`. Walk through each acceptance criterion from the spec (`docs/plans/2026-04-25-autogear-settings-redesign-design.md` Acceptance criteria section):

1. Modal opens; ≤ 6 tweaks visible without scrolling on a typical desktop viewport (1080p).
2. Role dropdown changes role; defaults apply.
3. Reset icon clears configuration.
4. `+ Add tweak` → picker view with 3 tiles in correct order; clicking back/Cancel returns to list.
5. Click a picker tile → empty form; Add adds + returns to list.
6. Click Edit on a row → form pre-filled; Save replaces at index; Cancel exits.
7. Chevrons reorder within their list type; boundaries disable correctly.
8. Reorder persists across modal close/reopen.
9. Inline number editing on row values still works (regression check).
10. Advanced accordion is closed on open; count is correct; toggling a checkbox updates the count.
11. Find Optimal Gear button visible in list view.
12. Hard Requirement tooltip displays new copy.
13. Stat Bonus form helpLabel tooltips on Stat/Mode/Percentage selectors still display additive/multiplier explanations.
14. Tutorial flow completes: trigger the autogear-settings tutorial (open settings modal for first time, or use replay button), walk through all 3 steps without errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx src/constants/tutorialSteps.ts
git commit -m "feat(autogear): your tweaks centerpiece with picker/form sub-flow"
```

---

## Task 11: Final verification

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

- [ ] **Step 3: Format pass**

```bash
npm run format
git diff --quiet || git add -A && git commit -m "chore: format"
```

- [ ] **Step 4: Documentation page sync (per CLAUDE.md guidance)**

Open `src/pages/DocumentationPage.tsx` and search for `autogear` and `secondary` and `priorit`. If any user-facing copy describes the modal's previous structure (Secondary Priorities, Stat Priority List, etc.), update it to reflect the redesign:
- "Secondary Priorities" → "Your tweaks"
- "Stat Priority List" / "Set Priority List" / "Role Stat Bonuses" → "Tweaks (stat priorities, set requirements, stat bonuses)"
- Mention reorder chevrons and the "+ Add tweak" picker if relevant

If updates are made:

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: update autogear modal description for redesign"
```

If nothing relevant exists, skip.

- [ ] **Step 5: Final manual QA pass — cross-feature regressions**

Verify no surrounding features broke:
1. **Community recommendations panel** still renders next to ship selectors and shows recommendation content. (No code changes there, but the parent page restructuring could have side effects.)
2. **Autogear from Locked Ships** flow (re-run from a previous result) still works.
3. **Per-ship config persistence** survives refresh: configure a ship, refresh page, modal reopens with same tweaks.
4. **Tutorial replay button** for the autogear-settings group still triggers the tutorial.

---

## Notes for the implementer

- **DRY:** The three row components (`StatPriorityRow`, `SetPriorityRow`, `StatBonusRow`) gain identical chevron groups in Tasks 3–5. After Task 5 lands, if all three look mechanically identical at the chevron-group level, consider extracting a small `<RowReorderChevrons canMoveUp canMoveDown onMoveUp onMoveDown disabled />` primitive in a follow-up. **Do not extract preemptively** — the rest of the rows differ.
- **YAGNI:** Don't add drag-and-drop, don't persist accordion state, don't add a tweak templates feature, don't add per-row edit icons (the existing `Edit` button is enough). All explicitly out of scope per the spec.
- **TDD scope:** Only `arrayMove` (Task 1) is unit-tested. The rest is UI per project convention (CLAUDE.md: "UI components: integration testing via manual QA").
- **Edit plan symbols to remove cleanly:** `EditTarget` (type), `editTarget` (state), `setEditTarget`, `priorityFormRef`, `setPriorityFormRef`, `statBonusFormRef`, `startEdit`, `cancelEdit`, `showSecondaryRequirementsTooltip`, `secondaryRequirementsTooltipRef`, the `useTutorial` auto-expand effect, the `<CollapsibleForm>` wrapper. Search after Task 10 to verify nothing dangles.
- **Props to verify:** `showSecondaryRequirements` and `onToggleSecondaryRequirements` may still be defined on `AutogearSettingsProps`/`AutogearSettingsModalProps`/`AutogearPage.tsx` state. After Task 10, grep for both — if no consumer remains, remove them. If `AutogearPage.tsx` keeps state for them, that's dead state and should also go.
- **Picker/form transitions:** No animations specified. Plain swap is fine. If QA flags abrupt feel, a 150ms fade can be added later.
- **Picker → form `onAdd` upsert behavior:** The existing `onAddPriority` / `onAddSetPriority` / `onAddStatBonus` handlers in `AutogearPage.tsx` perform an **upsert by stat (or set/bonus name)** — adding a tweak for a stat that already has one will replace in place, not append. The new picker→form add flow piggybacks on these unchanged handlers. UX impact: a user who picks "Stat priority" and submits crit damage when crit damage is already configured will see no new row appear; the existing row's values are silently replaced. This matches today's behavior — do **not** change the page handlers to append-only. If QA flags the silent-replace as confusing, address it as a follow-up (e.g., showing an in-form warning when the picked stat is already configured).
- **Removed import after Task 10 Step 1:** Removing the `useTutorial` auto-expand effect leaves `import { useTutorial } from '../../contexts/TutorialContext';` unused. Drop the import. Same caution applies to any other imports that were only needed for `EditTarget` / `startEdit` (e.g. the form refs).
