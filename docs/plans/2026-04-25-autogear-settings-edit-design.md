# Autogear settings edit (inline + form) — design

Date: 2026-04-25
Status: Spec

## Problem

Autogear configuration today is add-only: the user adds a stat priority, set priority, or role stat bonus via the form, and the only mutation available on the resulting list row is **Remove**. To change a single number — say, raising a `min: 100` to `min: 120` — the user must remove the row and re-add it from scratch, re-entering every other field. This is friction, especially for tuning during testing.

We want two complementary edit affordances on every list row:

1. **Inline number edit** — click a number in the row text and type a new value.
2. **Edit button** — opens the row's full form pre-filled in edit mode for changes that go beyond a single number (different stat, toggling hard requirement, etc.).

## Scope

Both features apply to all three lists rendered in the bottom card of `AutogearSettings.tsx`:

| List | Form component | Numeric fields per row |
|---|---|---|
| Stat Priority List | `StatPriorityForm` | `min`, `max`, `weight` |
| Set Priority List | inline `SetPriorityForm` (in `AutogearSettings.tsx`) | `count` |
| Role Stat Bonuses | `StatBonusForm` | `percentage` |

## Out of scope

- Reordering rows (drag handles, up/down buttons).
- Inline editing of non-numeric fields (stat name, set name, mode, hard-requirement checkbox). These remain form-only.
- Changes to the autogear algorithm or scoring.

## Feature 1 — Inline number edit

### Interaction

Each numeric value rendered in a list row is wrapped in a clickable span. Clicking the number swaps the span for a small numeric `<input>`, autofocused with its text selected.

- **Enter** or **blur** → save.
- **Escape** → cancel and revert.

### Save semantics

| Field | Empty value | Invalid (NaN) |
|---|---|---|
| `min`, `max`, `weight` | clears the field (and its parenthetical chunk in the row); `weight` defaults back to `1` | revert |
| `count` (set priority) | revert (required) | revert |
| `percentage` (stat bonus) | revert (required) | revert |

All other fields on the row are preserved untouched. The save calls the corresponding `onUpdate*` handler with a full row object built from the existing values plus the changed field.

### Visual

- Numbers are styled with a dotted underline and `cursor-pointer` to communicate clickability.
- The input that replaces the span uses the same font size as the row text and a fixed width sized to ~5 characters.
- No "save" or "cancel" buttons — keyboard-driven only.
- Out-of-range values (below `min` or above `max` props) revert rather than clamp — keeps the rule consistent with NaN handling.

### Implementation

Add `src/components/ui/InlineNumberEdit.tsx`:

```ts
interface InlineNumberEditProps {
    value: number | undefined;
    onSave: (value: number | undefined) => void;
    allowEmpty?: boolean; // if true, empty saves as undefined; otherwise reverts
    min?: number;
    max?: number;
    className?: string;
    children: React.ReactNode; // the rendered display (e.g., "min: 100")
}
```

The component renders `children` by default with the click affordance. On click, it switches to an input pre-populated with `value`. Enter/blur calls `onSave`, Escape reverts. Empty input → `onSave(undefined)` if `allowEmpty`, else revert.

Used by all three row components.

## Feature 2 — Edit button + form edit mode

### Interaction

Each row gets an **Edit** button placed between the row text and the existing **Remove** button: `[row text] [Edit] [Remove]`. The button uses `Button` from `src/components/ui/`, `variant="secondary"`, `size="sm"` to match the existing Remove button's footprint.

Clicking Edit:

1. If Secondary Priorities is collapsed → call `onToggleSecondaryRequirements(true)`.
2. Scroll the corresponding form into view via `scrollIntoView({ behavior: 'smooth', block: 'center' })` on a form ref.
3. Set the matching edit-state index (see below). The form receives `editingValue` and switches to **Edit mode**:
   - Inputs pre-filled with the row's values.
   - "Add" button replaced by **Save** + **Cancel**.
4. **Save** → call `onUpdate*(index, value)`, clear edit state.
5. **Cancel** → clear edit state, no mutation.

### Single-active-edit constraint

Only one row across all three lists can be in form-edit mode at a time. Starting an edit on a different row (or list) cancels any in-progress edit. Implemented via a single setter that reads "which list" + "which index" and clears the others.

### Visual

The source row being edited gets `opacity-60` and an inline "(editing)" suffix in muted text. Inline number edits inside that row are disabled (not clickable) while the row is in form-edit mode, to avoid two competing edit paths on the same row.

### Implementation

#### `AutogearSettings.tsx`

State:

```ts
type EditTarget =
    | { kind: 'priority'; index: number }
    | { kind: 'setPriority'; index: number }
    | { kind: 'statBonus'; index: number }
    | null;

const [editTarget, setEditTarget] = useState<EditTarget>(null);
```

Refs for scroll:

```ts
const priorityFormRef = useRef<HTMLDivElement>(null);
const setPriorityFormRef = useRef<HTMLDivElement>(null);
const statBonusFormRef = useRef<HTMLDivElement>(null);
```

`startEdit(target)` helper:
- sets `editTarget`
- calls `onToggleSecondaryRequirements(true)` if currently false
- calls `scrollIntoView` on the matching form ref. Schedule the call via `requestAnimationFrame` so the expand animation has started; if a single rAF lands before `CollapsibleForm`'s transition settles, fall back to a `setTimeout` matching the transition duration (verify during implementation).

Each list row gets an **Edit** button that calls `startEdit({ kind, index })`.

#### Row components

Refactor existing inline JSX into three small components:

- `StatPriorityRow` (already exists) — extend with edit button + inline number edits for `minLimit`, `maxLimit`, `weight`.
- `SetPriorityRow` (new) — replace the inline JSX in `AutogearSettings.tsx` with a component that takes `priority`, `onUpdate`, `onRemove`, `onEdit`, `isEditing`.
- `StatBonusRow` (new) — same pattern for the bonus list.

Each receives:

```ts
interface RowProps<T> {
    value: T;
    isEditing: boolean;
    onUpdate: (value: T) => void;
    onRemove: () => void;
    onEdit: () => void;
}
```

#### Form components — edit mode

Add to all three forms (`StatPriorityForm`, `StatBonusForm`, inline `SetPriorityForm`):

```ts
interface EditModeProps {
    editingValue?: T;
    onSave?: (value: T) => void;
    onCancel?: () => void;
}
```

Behavior when `editingValue` is set:
- `useEffect` syncs the form's local state from `editingValue` whenever it changes (including switches between rows).
- Submit calls `onSave` instead of `onAdd`.
- Renders **Save** + **Cancel** buttons instead of **Add**.
- Does NOT clear local state on submit — the parent clears `editingValue` (which triggers the sync effect).

When `editingValue` is undefined, forms behave exactly as today (Add mode).

#### Parent (`AutogearPage.tsx`)

Add three new handlers:

```ts
onUpdatePriority: (index: number, priority: StatPriority) => {
    if (!shipSettings) return;
    const config = getShipConfig(shipSettings.id);
    updateShipConfig(shipSettings.id, {
        statPriorities: config.statPriorities.map((p, i) =>
            i === index ? priority : p
        ),
    });
}
```

Same shape for `onUpdateSetPriority` and `onUpdateStatBonus`.

These differ from the existing `onAdd*` upsert-by-name handlers: they replace strictly at `index`, regardless of whether the stat/set name changed. This is required because edit mode allows changing the stat (e.g., editing a `crit` priority to `critDamage`) — upsert-by-name would create a duplicate and leave the original in place.

#### `AutogearSettingsModal.tsx`

This file mirrors the `AutogearSettings` prop interface. Add the same three new props and pass them through.

## Data flow summary

```
AutogearPage  ── onUpdatePriority(idx, priority) ──► updateShipConfig
     │
     │ priorities, setPriorities, statBonuses, onAdd*, onRemove*, onUpdate*
     ▼
AutogearSettings (owns editTarget + form refs)
     │
     ├─► StatPriorityForm   (editingValue, onSave, onCancel)
     ├─► SetPriorityForm    (editingValue, onSave, onCancel)
     ├─► StatBonusForm      (editingValue, onSave, onCancel)
     │
     ├─► StatPriorityRow    (value, isEditing, onUpdate, onEdit, onRemove)
     ├─► SetPriorityRow     (same)
     └─► StatBonusRow       (same)
            │
            └─► InlineNumberEdit (per numeric field)
```

## Edge cases

- **Edit then change stat to one that already exists in another row.** The update lands at the original index; the duplicate-stat row is left untouched. Acceptable — matches what the user explicitly typed and is no worse than the current Add behavior allows.
- **Edit a row, then click Remove on it.** Remove cancels edit mode (clears `editTarget`) and removes the row.
- **Inline-edit `weight` to 0.** Allowed; treat 0 as "no weight" (parent stores it as-is). Negative not allowed (clamped to 0).
- **Inline-edit while form-edit is active on the same row.** Inline edits disabled while the row is in form-edit mode (per visual section above).
- **Inline-edit creates an empty `min`/`max` chunk.** When a chunk is cleared, it disappears from the row text on next render.

## Testing

Unit tests for `InlineNumberEdit` covering: enter saves, blur saves, escape cancels, empty + `allowEmpty=true` calls `onSave(undefined)`, empty + `allowEmpty=false` reverts, NaN reverts.

Component tests for one of each row type covering: edit click sets edit target, save calls update with correct index, cancel doesn't mutate, inline edit calls update with the right field changed.

No new tests for the form components beyond verifying that `editingValue` swaps button labels and pre-fills inputs.

## Files touched

New:
- `src/components/ui/InlineNumberEdit.tsx`
- `src/components/autogear/SetPriorityRow.tsx`
- `src/components/autogear/StatBonusRow.tsx`
- Tests for the above.

Modified:
- `src/components/autogear/AutogearSettings.tsx` — edit state, scroll refs, Edit buttons, row component usage.
- `src/components/autogear/StatPriorityForm.tsx` — edit mode props.
- `src/components/autogear/StatBonusForm.tsx` — edit mode props.
- `src/components/autogear/AutogearSettingsModal.tsx` — pass-through props.
- `src/pages/manager/AutogearPage.tsx` — three new update handlers.
