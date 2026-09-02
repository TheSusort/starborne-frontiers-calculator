# Skill Audit Section — Design Spec

**Date:** 2026-05-27
**Status:** Approved

## Overview

Add a "Skill Audit" area to the admin panel's Templates tab. It consists of two collapsible sub-panels:

1. **Audit Report** — scans all ship templates from Supabase for skill text issues and surfaces them in a filterable table.
2. **Skill Parser Inspector** — lets the admin select a ship and see both the rendered skill text (visual) and the structured `SkillEffect[]` output from `parseSkillEffects`.

## Goals

- Give admins a fast way to spot formatting errors and missing buff descriptions across all ship templates.
- Verify that the skill text parser (used by the DPS/simulation calculators) is extracting the correct effects for a given ship.

## Non-Goals

- Auto-fixing issues (read-only reporting).
- Validating the SHIPS TypeScript constant (`ships.ts`) — only Supabase templates are in scope.
- Adding a new top-level admin tab.

## Data Source

`allTemplates: ShipTemplate[]` — already fetched by `AdminPanel` on mount. No additional Supabase calls needed.

## Location

`SkillAuditSection` component, rendered inside the `template-proposals` tab in `AdminPanel.tsx`, below the existing add/edit template forms and the `TemplateProposalsTable`.

`AdminPanel` passes two props:
- `allTemplates: ShipTemplate[]`
- `onSelectTemplate: (template: ShipTemplate) => void` — calls the existing `handleSelectTemplate` from `AdminPanel`, which sets `selectedTemplate`, sets `templateSearchQuery` to the ship name, and sets `showEditTemplateForm` to `true`. This intentionally opens the edit form so the admin can immediately fix the flagged issue.

## Prerequisite: Export `findBuffDescription`

`findBuffDescription` in `src/utils/skillTextParser.ts` is currently unexported. Before implementing `SkillAuditSection`, export it so the audit logic can call it directly without duplicating the Roman-numeral lookup logic.

## Component Structure

```
src/components/admin/
  SkillAuditSection.tsx   ← new file, contains both sub-panels
```

`SkillAuditSection` holds two independent `useState<boolean>` values (`auditOpen`, `inspectorOpen`) that drive the `isVisible` props on each `CollapsibleForm`. Each sub-panel has a `Button` (variant `secondary`) that toggles its own open/closed state. The buttons are placed above the respective `CollapsibleForm`.

---

## Sub-panel 1: Audit Report

### Toggle

A `Button` labeled "Show Skill Audit" / "Hide Skill Audit" toggles `auditOpen`. The button also shows the top-level issue count in its label when there are issues and the panel is closed: "Show Skill Audit (3 errors, 5 warnings, 2 info)".

### Validation

Run synchronously in a `useMemo` over `allTemplates`. For each template, check each of the five skill text fields in order: `active_skill_text`, `charge_skill_text`, `first_passive_skill_text`, `second_passive_skill_text`, `third_passive_skill_text`.

**Checks run per non-empty skill text field:**

| Severity | Check | Detail |
|---|---|---|
| `error` | Unknown tag name | Any `<tag>` in the text where tag is not in the known-good set (see Tag Validation Logic below) |
| `error` | Unclosed / mismatched tag | Opening tag with no matching closing tag, or a closing tag with no matching open tag (stack-based; runs after bad-`<br>` variants are excluded — see Tag Validation Logic) |
| `warning` | Buff not in BUFFS | `<unit-skill>X</unit-skill>` where `findBuffDescription(X)` returns `undefined` |
| `warning` | Bad `<br>` format | Text contains `<br>` or `<br/>` (without the space-slash) |
| `warning` | Empty tag content | `<unit-skill></unit-skill>`, `<unit-damage></unit-damage>`, or `<unit-aid></unit-aid>` |

**Check run at template level (not per-slot):**

| Severity | Check | Detail |
|---|---|---|
| `info` | No skill texts | All five skill text fields are null or empty string |

Each issue record: `{ templateId: string, shipName: string, slot: string, severity: 'error' | 'warning' | 'info', message: string }`.

For the template-level `info` check, `slot` is `'—'`.

### Filter chips and zero state

Four chips: **All** | **Errors** | **Warnings** | **Info**. "All" is selected by default and shows every issue including `info`. The active chip filters the table rows.

Zero state: when no issues exist across all severity levels, show a single green "No issues found" message. When a filter chip is active and has no matching rows (but other severities do have rows), show "No [severity] issues found."

### Display

- Summary line above the table: "X errors, Y warnings, Z info" — all three counts always shown, even if zero. When all are zero, the summary is replaced by the green zero state message.
- Filter chips below the summary.
- `DataTable` columns: Ship Name (rendered as a clickable text that calls `onSelectTemplate`), Slot, Severity (badge: red for error, yellow for warning, gray for info), Issue.
- The issues array is **pre-sorted in `useMemo`** before being passed to `DataTable`: errors first, then warnings, then info; alphabetical by ship name within each group. `DataTable` columns are **not** made user-sortable for this table. Pass a `getRowKey` of `(_, index) => String(index)` since issue records have no guaranteed unique field.

---

## Sub-panel 2: Skill Parser Inspector

### Toggle

A `Button` labeled "Show Skill Parser Inspector" / "Hide Skill Parser Inspector" toggles `inspectorOpen`.

### Ship Selection

Type-ahead search input (same pattern as the existing template edit search in `AdminPanel`): filter results appear when ≥2 characters are typed, matching `allTemplates` by name case-insensitively. Selecting a ship populates the inspector below and clears the search input (replaced by the ship name).

**Empty state (no ship selected):** A `"Select a ship above to inspect its skill texts."` placeholder paragraph replaces the inspector output area.

### Inspector Output

For each of the five skill slots that has non-empty text, render a card (using the `card` CSS class) with:

- **Header:** slot label + source identifier, e.g. "Active (active)", "Charge (charge)", "Passive R0 (passive1)", "Passive R2 (passive2)", "Passive R4 (passive3)"
- **Left column — Rendered:** `<SkillTooltip skillText={...} skillType={slotLabel} inline />` — exact same visual output the ship database shows users.
- **Right column — Parsed Effects:** A table of `parseSkillEffects(text, source)` output with columns: Buff Name, Target, Duration, Stacks, Trigger, Source. If the effects array is empty, show a "No effects parsed" placeholder. Optional fields (`stacks`, `stackTrigger`) show `—` when absent. The Trigger column displays the raw `StackTrigger` string value as-is (`per-round`, `per-active`, `per-charge`).

Slots with null or empty skill text are omitted entirely.

### Slot → SkillSource mapping

| Slot field | `slotLabel` | `SkillSource` passed to `parseSkillEffects` |
|---|---|---|
| `active_skill_text` | `"Active"` | `'active'` |
| `charge_skill_text` | `"Charge"` | `'charge'` |
| `first_passive_skill_text` | `"Passive R0"` | `'passive1'` |
| `second_passive_skill_text` | `"Passive R2"` | `'passive2'` |
| `third_passive_skill_text` | `"Passive R4"` | `'passive3'` |

---

## Tag Validation Logic (detail)

### Step 1 — Unknown tag check

Use `/<([^>]+)>/g` to find all tags in the raw text. For each match, check whether the captured content is in the known-good set:

```
unit-skill  /unit-skill  unit-damage  /unit-damage  unit-aid  /unit-aid  br /  br  br/
```

`br`, `br/`, and `br /` are all in the known-good set for Step 1 — bad-format `<br>` variants are **not** flagged here as unknown tags. They are deferred entirely to Step 2. This prevents double-reporting (same token as both an unknown-tag error and a bad-format warning).

Any tag content not in this set is flagged as an `error` with message `Unknown tag: <{tag}>`.

### Step 2 — Bad `<br>` format check

Scan the raw text for `<br>` or `<br/>` (without the space before the slash). Flag each occurrence as a `warning` with message `Bad <br> format: use <br /> instead`.

### Step 3 — Unclosed tag check

Work on a copy of the text with **all three `<br>` variants** (`<br />`, `<br>`, `<br/>`) removed — regardless of whether they were flagged in Step 2. This prevents stray `<br>` tokens from appearing as unclosed tags to the stack.

Use a stack. Iterate over all `/<\/?(unit-skill|unit-damage|unit-aid)>/g` matches (no leading space in the alternation):
- Opening tag → push tag name onto stack.
- Closing tag → if top of stack matches, pop. Otherwise flag `error`: `Mismatched closing tag: </{tag}>`.

After iteration, any remaining items on the stack are flagged as `error`: `Unclosed tag: <{tag}>`.

---

## Existing Code Reused

- `parseSkillText` / `parseSkillEffects` / `findBuffDescription` (after export) from `src/utils/skillTextParser.ts`
- `SkillTooltip` (with `inline` prop) from `src/components/ship/SkillTooltip.tsx`
- `CollapsibleForm`, `DataTable`, `Button` from `src/components/ui`
- `allTemplates` state and `handleSelectTemplate` from `AdminPanel`

## Implementation Notes

- The inspector uses `CollapsibleForm` which has a hard-coded `max-h-[3300px]` cap. Ships with all five skill slots populated plus long effect tables may approach this limit. Pass `className="!max-h-none"` (Tailwind `!important` modifier) on the inspector's `CollapsibleForm` to guarantee the cap is lifted — a plain `max-h-none` class will lose to the hard-coded value due to Tailwind class ordering.

## Testing

No new unit tests required for the component itself — it's a display component. The validation logic (tag checks, buff lookup) is simple enough to verify visually against known-bad templates. Existing `skillTextParser.ts` tests cover `parseSkillEffects` and `parseSkillText`.
