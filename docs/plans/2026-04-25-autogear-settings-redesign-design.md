# Autogear Settings Modal Redesign

**Goal:** Reduce scrolling and lower the new-player learning curve in the autogear settings modal by reorganising it around the user's actual workflow — daily tweaks at the centre, set-and-forget options collapsed, and plain-English labels throughout.

**Sequencing:** Lands **after** `docs/plans/2026-04-25-autogear-settings-edit-plan.md` ships. That plan delivers the row-level Edit button, inline number editing on `min`/`max`/`weight`/`count`/`percentage`, and the `editingValue`/`onSave`/`onCancel` props on `StatPriorityForm`/`SetPriorityForm`/`StatBonusForm`. This redesign consumes those primitives.

---

## Problem Statement

The current modal (see `src/components/autogear/AutogearSettings.tsx`):

1. **Forces scrolling to verify changes.** The list of currently configured priorities/sets/bonuses lives at the bottom of the modal, below all input forms. Users (especially power users tweaking daily) scroll past inputs to confirm an addition landed.
2. **Speaks in jargon.** "Predefined Strategies", "Secondary Priorities", "Stat Bonuses" with "Additive vs Multiplier" wall-of-text, the joke tooltip on "Hard Requirement" — newcomers have no path to "what do I do first?".
3. **Hides important behaviour.** Tweak order materially affects scoring (`priorityScore.ts:329` applies `2^(length - index - 1)`, so the first priority is 8× the fourth in a 4-item list), but the UI gives no signal that order matters.
4. **Treats rare and frequent controls the same.** Six checkboxes that users set once and never revisit ("Ignore equipped gear", "Use upgraded stats", etc.) compete for vertical space with the daily-edit zone.

## Workflow Insight

For the primary user (validated during brainstorming):

- **Role:** set once, rarely changed.
- **Six option toggles:** set once, rarely changed.
- **Stat priorities, set requirements, stat bonuses ("the tweaks"):** changed daily.

So the layout must put tweaks first and compress everything else.

---

## Design

### Container

Stays in the existing `Modal` with `fullHeight={true}`. Single column. No tabs, no offcanvas.

### Sections (top to bottom)

1. **Strategy** — compact card.
2. **Your tweaks** — centerpiece card with picker→form sub-flow.
3. **Advanced options** — collapsed accordion.
4. **Sticky footer** — primary action.

---

### 1. Strategy section

```
┌─────────────────────────────────────┐
│ STRATEGY                            │
│ ┌──────────────────────┐ ┌───┐      │
│ │ ⚔ Attacker        ▾  │ │ ↺ │      │
│ └──────────────────────┘ └───┘      │
└─────────────────────────────────────┘
```

- Caption "Strategy" (replaces "Predefined Strategies").
- Existing `RoleSelector` dropdown — same component, just relabeled.
- Reset → small icon button (`↺`) with `title="Reset to role defaults"`. Replaces the current red `Reset Configuration` button. Less visual weight, still discoverable.
- The current "Show/Hide Secondary Priorities" toggle is **removed**. Its function is subsumed into the Tweaks section's sub-flow.

### 2. Your tweaks section (centerpiece)

#### List view (default)

```
┌─────────────────────────────────────┐
│ Your tweaks (3)         [+ Add tweak]│
│ ┌─────────────────────────────────┐ │
│ │ ↑↓ 1. Crit Damage          [Edit]✕│
│ │ ↑↓ 2. Attack % (min: 250)  [Edit]✕│
│ │ ↑↓ 3. Stealth (set, 2 pcs) [Edit]✕│
│ └─────────────────────────────────┘ │
│ ↑ order matters — higher = stronger │
└─────────────────────────────────────┘
```

- Card header: **"Your tweaks (N)"** plus a primary `+ Add tweak` button.
- Body: the configured rows, rendered using `StatPriorityRow` / `SetPriorityRow` / `StatBonusRow` from the edit plan, in this order: stat priorities, set requirements, stat bonuses (with their existing section labels intact).
- **Reordering:** each row gains up/down chevron buttons on the left (added to the row components from the edit plan). Reordering is bounded within a list type — i.e. you can reorder stat priorities among stat priorities, set priorities among set priorities, stat bonuses among stat bonuses. No cross-list reordering.
- Caption beneath the list: **"Order matters — higher tweaks weigh more."** Always visible when the list is non-empty.
- Empty state: helper text "No tweaks yet. The role's defaults will be used as-is." with a centered `+ Add tweak` button.

#### Picker view (replaces list)

Triggered by `+ Add tweak`. The Tweaks card body swaps from list to picker. Strategy + Advanced sections **dim** (visible, not interactive).

```
┌─────────────────────────────────────┐
│ ← Your tweaks · Add tweak           │
│ What do you want to add?            │
│ ┌─────────────────────────────────┐ │
│ │ 📊 Stat priority                │ │
│ │ Prioritize a stat (e.g. crit    │ │
│ │ damage). Optionally set min,    │ │
│ │ max, or weight.                 │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🛡 Set requirement              │ │
│ │ Require a number of pieces from │ │
│ │ a gear set (e.g. 2× Stealth).   │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ ⚙ Stat bonus  (advanced)        │ │
│ │ Make scoring scale with another │ │
│ │ stat (e.g. hacking +50%         │ │
│ │ multiplier).                    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- All three tiles always shown, in the order above. **No memory of last choice** — the picker resets every time `+ Add tweak` is clicked.
- "Stat bonus" tile is tagged `(advanced)` to set newcomer expectations.
- `← Your tweaks` breadcrumb at top — clicking it cancels back to the list view.
- Footer: secondary `Cancel` button.

#### Form view (replaces picker)

Triggered by clicking a picker tile or by clicking a row's `Edit` button (which routes here directly, skipping the picker).

- Mounts the matching form component (`StatPriorityForm` / `SetPriorityForm` / `StatBonusForm`) inside the Tweaks card body.
- In **add** mode (entered via picker): empty form, `Add` button.
- In **edit** mode (entered via row Edit): pre-filled via `editingValue` (from the edit plan), `Save` + `Cancel` buttons.
- Breadcrumb at top: `← Your tweaks · Add tweak · {Type}` (add mode) or `← Your tweaks · Edit {Type}` (edit mode). Clicking the leftmost segment cancels.
- **Stat Bonus form** specifically:
  - The current header paragraph is trimmed to: *"Make scoring scale with another stat. Pick Additive or Multiplier below."*
  - The Additive vs Multiplier explanation moves to per-radio tooltips:
    - **Additive:** `"Adds stat × % directly to the role score (e.g. defense @ 80% for a skill dealing 80% of defense as damage)."`
    - **Multiplier:** `"Multiplies the role score by stat × % (e.g. hacking @ 50% makes DPS scale with hacking)."`
- The form's own buttons drive return-to-list — no duplicate footer button while in form view.

#### Sub-flow state

A single component-local state in `AutogearSettings.tsx`:

```ts
type TweakView =
  | { mode: 'list' }
  | { mode: 'picker' }
  | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus'; editIndex: number | null };
```

Routing rules:
- Default: `{ mode: 'list' }`.
- `+ Add tweak` → `{ mode: 'picker' }`.
- Picker tile click → `{ mode: 'form', type: <chosen>, editIndex: null }`.
- Row Edit click → `{ mode: 'form', type: <row's type>, editIndex: <row index> }`. (Replaces the edit plan's auto-expand-Secondary-Priorities + scroll behaviour, which is removed.)
- Form Save / Cancel / breadcrumb → `{ mode: 'list' }`.
- Picker breadcrumb / Cancel → `{ mode: 'list' }`.

The edit plan's `EditTarget` state and `startEdit` helper are **superseded** by `TweakView` in this redesign. The `onUpdatePriority` / `onUpdateSetPriority` / `onUpdateStatBonus` handlers it added are kept as-is.

### 3. Advanced options accordion

```
┌─────────────────────────────────────┐
│ ▸ Advanced options  (2 of 6 enabled)│
└─────────────────────────────────────┘
```

- `CollapsibleAccordion` titled **"Advanced options"** with a count badge of how many of its toggles are currently enabled (out of 6, +1 if the arena modifiers toggle exists for the active season).
- Closed by default. Expanded state is **not persisted** — every modal open starts collapsed. (Rationale: the user said these are set-and-forget; expanding by accident is more annoying than re-clicking on the rare occasion you do want to change one.)
- Contents (unchanged from today):
  - Ignore equipped gear on other ships
  - Ignore unleveled gear
  - Use upgraded stats
  - Try to complete gear sets
  - Optimize implants (EXPERIMENTAL)
  - Include calibrated gear
  - Apply arena modifiers (when `activeSeason` exists), with the current rules display

### 4. Sticky footer

```
┌─────────────────────────────────────┐
│ [    Find Optimal Gear    ]         │
└─────────────────────────────────────┘
```

- List view: primary `Find Optimal Gear` button (full-width).
- Picker view: secondary `Cancel` button.
- Form view: empty (the form's own Save+Cancel handle the action — keeping a duplicate primary CTA in the footer would be confusing).

---

## Copy changes summary

| Where | Before | After |
|-------|--------|-------|
| Strategy caption | "Predefined Strategies" | "Strategy" |
| Reset button | red `Reset Configuration` button | small `↺` icon button with `title` |
| Show/Hide toggle | "Show/Hide Secondary Priorities" | _removed_ |
| Tweaks header | "Stat Priority List" / "Set Priority List" / "Role Stat Bonuses" (3 separate sections) | "Your tweaks (N)" header; sub-section labels retained inside the list |
| Order hint | _none_ | "Order matters — higher tweaks weigh more." |
| Picker tile (priority) | _form was always open_ | "📊 Stat priority — Prioritize a stat (e.g. crit damage). Optionally set min, max, or weight." |
| Picker tile (set) | _form was always open_ | "🛡 Set requirement — Require a number of pieces from a gear set (e.g. 2× Stealth)." |
| Picker tile (bonus) | _form was always open_ | "⚙ Stat bonus _(advanced)_ — Make scoring scale with another stat (e.g. hacking +50% multiplier)." |
| Hard Requirement tooltip | "this time it's personal" | "Skip the entire suggestion if this stat target isn't reachable." |
| Stat Bonus header | Long Additive/Multiplier paragraph | "Make scoring scale with another stat. Pick Additive or Multiplier below." |
| Additive radio tooltip | _(none)_ | "Adds stat × % directly to the role score (e.g. defense @ 80%…)." |
| Multiplier radio tooltip | _(none)_ | "Multiplies the role score by stat × % (e.g. hacking @ 50%…)." |
| Advanced section | "Options" heading with 6 always-visible checkboxes | "Advanced options (N of 6 enabled)" — collapsed accordion |

---

## Component changes (high level)

**Modified:**
- `src/components/autogear/AutogearSettings.tsx`
  - Replaces structure described in Sections 1–4 above.
  - Removes the `showSecondaryRequirements` toggle and the auto-expand-on-tutorial effect (no longer applicable; sub-flow handles disclosure).
  - Adds `TweakView` state + sub-flow rendering.
  - Removes `EditTarget` state and `startEdit` helper from the edit plan; replaces with `TweakView` routing.
  - Wraps Advanced options in `CollapsibleAccordion`.
- `src/components/autogear/StatPriorityRow.tsx` / `SetPriorityRow.tsx` / `StatBonusRow.tsx` (from the edit plan)
  - Add up/down chevron buttons on the left. Disabled at boundaries (top of list can't go up; bottom can't go down).
  - New props: `canMoveUp: boolean`, `canMoveDown: boolean`, `onMoveUp: () => void`, `onMoveDown: () => void`.
- `src/components/autogear/StatBonusForm.tsx`
  - Trim header text. Add tooltips to Additive/Multiplier radios.
- `src/components/autogear/AutogearSettingsModal.tsx`
  - Add new pass-through props: `onMovePriority`, `onMoveSetPriority`, `onMoveStatBonus` (each `(fromIndex, toIndex) => void`).
- `src/pages/manager/AutogearPage.tsx`
  - Add three move handlers that splice-and-reinsert in the corresponding array (priorities / setPriorities / statBonuses), using `updateShipConfig`.
- `src/components/autogear/StatPriorityForm.tsx` / `SetPriorityForm.tsx`
  - No structural changes from the edit plan, but verify breadcrumb hosting works with current layout. (May need to render breadcrumb in `AutogearSettings.tsx` above the form rather than inside it — implementation detail.)

**Removed:**
- The "Show/Hide Secondary Priorities" toggle button and its surrounding tooltip in `AutogearSettings.tsx`.
- The `useTutorial` auto-expand effect tied to `autogear-settings` group in `AutogearSettings.tsx`.

**Tutorial:**
- The `data-tutorial` attributes (`autogear-stat-priorities`, `autogear-set-priorities`, `autogear-stat-bonuses`, `autogear-ignore-options`, `autogear-upgrade-options`, `autogear-extra-options`) currently target always-visible elements. After this redesign, those targets are inside the picker / form sub-flow or behind the Advanced accordion. The tutorial flow may need to either:
  1. Programmatically open the picker/accordion at the relevant tutorial step, or
  2. Re-target attributes onto the new control surface (e.g. `+ Add tweak` button, picker tiles, accordion header).

The tutorial integration is **in scope for implementation planning** — the implementer should pick option 1 or 2 based on which keeps the existing tutorial copy intact. Updates to `src/constants/tutorialSteps.ts` are expected.

---

## Acceptance criteria

1. Opening the modal for a ship with existing tweaks shows the list view with all tweaks visible without scrolling (assuming ≤ 6 tweaks total — typical case).
2. Strategy dropdown still selects roles via the existing `RoleSelector` component; selecting a role still applies role defaults.
3. Reset (`↺`) clears configuration the same way the existing `Reset Configuration` button does.
4. Clicking `+ Add tweak` opens the picker with all three tiles in the documented order. Clicking outside / Cancel returns to the list with no changes.
5. Clicking a picker tile opens the corresponding empty form. Submitting it adds the tweak to the bottom of the list and returns to the list view.
6. Clicking `Edit` on a row opens the form pre-filled with that row's values; saving replaces at the original index; cancelling exits without changes.
7. Up/down chevrons reorder within the list type (priorities ↔ priorities, sets ↔ sets, bonuses ↔ bonuses). Boundary chevrons are disabled.
8. Reordering immediately persists via `updateShipConfig` (no separate save step).
9. Inline number editing on row values (from the edit plan) continues to work in the list view.
10. Advanced options accordion is collapsed when the modal opens. Header shows accurate "(N of M enabled)" count.
11. Find Optimal Gear button is sticky in the footer in list view; replaced by Cancel in picker view; absent in form view.
12. Hard Requirement tooltip displays the new copy.
13. Stat Bonus form shows trimmed header copy; Additive/Multiplier tooltips show the full explanations on hover.
14. Tutorial flow still completes successfully (steps may show different target controls — copy unchanged unless the target itself no longer exists).

---

## Non-goals

- **No drag-to-reorder.** Up/down chevrons only — drag-and-drop is over-engineering for typically-short lists.
- **No bulk editing** (multi-select, batch delete, batch reorder).
- **No new template/preset feature.** Existing per-ship config persistence (`autogear_configs` storage + `updateShipConfig`) stays untouched.
- **No changes to the autogear scoring algorithm.** Order weighting (`2^(length - index - 1)`) and weight semantics stay as they are. The redesign exposes order; it does not change how it's used.
- **No changes outside the modal.** `CommunityRecommendations` panel, `AutogearQuickSettings`, ship selector, and the autogear page layout are untouched.
- **No documentation page rewrite** — `src/pages/DocumentationPage.tsx` may need a small update to mention the new tweak picker, but a full rewrite is out of scope; the implementer should make a minimal targeted update if relevant copy exists.

---

## Open questions / Risks

1. **Tutorial integration choice (in-scope, deferred to plan):** option 1 (programmatically open sub-flow at relevant steps) vs option 2 (retarget `data-tutorial` to surface controls). Implementer's call during planning.
2. **Breadcrumb host:** rendering the breadcrumb inside the form components couples them to the redesign; rendering it in `AutogearSettings.tsx` above the form keeps forms reusable. Lean toward the latter — implementer's call.
3. **Reorder atomicity:** moving a tweak fires `updateShipConfig` immediately. If the user spams up/down on a ship that's also syncing to Supabase, multiple rapid writes could race. Risk is low (Supabase upserts converge), but worth a debounce if QA flags it.
4. **Visual signalling for "dimmed" Strategy/Advanced sections during sub-flow:** opacity reduction (e.g. `opacity-60`) plus `pointer-events: none` on those cards is the simplest implementation. Verify this doesn't trap focus accessibility-wise (keyboard users should still be able to escape the sub-flow via the breadcrumb / Cancel).

---

## References

- Brainstorm session: this design was shaped over a multi-turn conversation captured in `.superpowers/brainstorm/50394-1777094974/` (HTML mockups: `before-after-c.html`, `after-c-v2.html`, `add-tweak-flow.html`).
- Predecessor plan: `docs/plans/2026-04-25-autogear-settings-edit-plan.md` — must ship before this redesign.
- Scoring formula reference: `src/utils/autogear/priorityScore.ts:329` (`getOrderMultipliers`).
- Component touchpoints: `src/components/autogear/AutogearSettings.tsx`, `AutogearSettingsModal.tsx`, `StatPriorityForm.tsx`, `StatBonusForm.tsx`, `src/pages/manager/AutogearPage.tsx`.
