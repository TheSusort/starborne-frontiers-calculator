# Damage Deconstruction Calculator — UI Cleanup

**Date:** 2026-06-07
**Scope:** Visual + structural cleanup of `src/pages/calculators/DamageDeconstructionPage.tsx`. No change to the calculation math or results semantics.

## Problem

The page works but looks rough next to sibling calculators (DPS, Healing, Speed):

- Three full-width cards stacked vertically; every input is a full-width row, making the form long and sparse.
- Attacker and Defender each get their own full-width card even though each holds only a few fields — wasted horizontal space on desktop.
- Buff/debuff sections are built from raw `<label>` and `<p>` markup instead of shared UI primitives.
- Results render as plain `<p>` text lines rather than the `StatCard` metric cards used elsewhere.
- A large `console.log` debug block is left in `calculateDamage()` and ships to production.

## Goal

Match the look and structure of the other calculators while keeping all current behavior, field set, and the math identical.

## Design

### Layout

Approved mockup: **Attacker and Defender side-by-side**, results below as stat cards.

- Wrap the two role panels in a responsive grid: `grid grid-cols-1 lg:grid-cols-2 gap-4` (stacks on mobile, side-by-side on `lg+`). This is consistent with the responsive-grid convention used across the calculators (exact breakpoints vary per page — don't copy them verbatim).
- Each panel keeps the `card` class. Give each a header row (existing `h4`) with a small colored dot — blue for Attacker, red for Defender — and a bottom border separating header from fields. The dot/border is plain Tailwind on the heading; no new component needed.
- Inside the Attacker panel, pair related single inputs into a 2-up grid (`grid grid-cols-1 sm:grid-cols-2 gap-4`): Ship Base Attack + Skill Attack %, then Defense Penetration % + the Critical Hit checkbox/Critical Damage % cluster. Actual Damage Dealt stays full-width at the top.
- The Calculate button stays inside the Defender panel, full-width, as today.

### Buff/debuff sections

`renderBuffDebuffSection` is rewritten to use shared primitives instead of raw HTML:

- Group each section in a nested sub-container using the `card` class (or a `bg-dark`/border wrapper consistent with `card`) so buff groups read as distinct blocks.
- Section title + optional help text: use the `Input`/section-label conventions already in the file's UI kit. Title via a styled heading; help text via the existing `helpLabel` prop on `Input` where the value input lives, or a small secondary-text paragraph using the project's `text-theme-text-secondary` class (this matches existing usage — acceptable since there is no dedicated label primitive).
- Each buff row: value `Input` (numeric, fixed/narrow width), description `Input` (flex-grow), and the remove `Button variant="danger"` with `CloseIcon`. Align consistently using a flex/grid row so the remove button lines up.
- "+ Add …" stays a `Button variant="secondary"`.

No behavioral change to add/remove/update handlers.

### Results

Replace the `<p>` lines with `StatCard` components in a grid (`grid grid-cols-1 sm:grid-cols-3 gap-4`):

- **Actual damage reduction** — always shown — `color="green"`, value `${x.toFixed(2)}%`.
- **Base damage reduction** — only when `results.hasModifiers` — `color="blue"`.
- **Enemy defense estimate** — always shown — `color="yellow"`, value `Math.round(...)`.

When `hasModifiers` is false, two cards render (grid still works). The explanatory notes move below the cards into a single subdued callout block (keep both existing note sentences; merge presentation). Use existing `text-theme-text-secondary` styling consistent with the current notes.

### Cleanup

- Remove the entire `console.log` debug block (and its `eslint-disable`/`enable` comments) from `calculateDamage()`.

## Non-goals

- No change to `calculateDamage()` math, the formula, or `calculateDamageReduction` usage.
- No change to the form data model (`DamageDeconstructionForm`), the ship-prefill logic, or the `shipId` URL handling.
- No new shared UI components unless an existing one genuinely doesn't fit; prefer reusing `Input`, `Button`, `Checkbox`, `StatCard`, `card`.

## Testing / verification

- This page has no existing unit tests and the change is presentational; verification is manual: run the app, open `/damage-deconstruction`, confirm layout matches the mockup, all inputs still bind, add/remove buff rows works, Calculate produces the same numbers as before, and results render as stat cards.
- `npm run lint` (max-warnings 0) and `npm test` must pass.

## Docs / changelog

- This is a visual polish of an existing page. Add a short `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` noting the Damage Deconstruction calculator got a cleaner layout.
- No `DocumentationPage.tsx` change needed (no new feature/behavior).
