# Skill Targeting Footprint in Hovercards — Design

**Date:** 2026-06-14
**Status:** Approved (design), pending spec review
**Area:** Frontend / ship skill display (consumes positional geometry resolver, PR #106)

## Context

The positional-targeting foundation is merged:

- **Data** (`src/utils/targetingParser.ts`, PR #105): `parseShipTargeting(ship)` →
  `ShipTargeting { active?, charged? }`. Each `SkillTargeting` is
  `{ target: ParsedTarget, pattern: ParsedPattern }`. Charged inheritance is already
  handled (empty `chargedTarget`/`chargedPattern` fall back to the active values).
- **Geometry** (`src/utils/targeting/`, PR #106): `resolveCells(pattern, anchor)` →
  `ResolvedCell[]`, each `{ position: Position, role: 'origin' | 'covered' }`. Off-board
  cells are clipped (not returned). `board.ts` exposes `ALL_POSITIONS` and axial-coordinate
  helpers (`positionToAxial`). `'all'` patterns return all 12 cells; `'lane'` (support
  whole-lane) is caster-centered and clips at the board edges.

None of this is surfaced to users yet. Ship skills render as text only. We want to show
each Active/Charge skill's targeting **footprint** as a small board diagram inside the
existing skill hovercard, modeled on the approved prototype
(`.superpowers/pattern-footprints-review-v3.html`): **red = origin** (caster / primary
target), **orange = covered** (splash), dim = empty.

This is a display-only feature. It does not touch the combat engine or the
positional target-selection work (that is a separate arc, piece 2 of 5).

### Where skills render today

`SkillTooltip` (`src/components/ship/SkillTooltip.tsx`) is the single skill-rendering
component. Confirmed call sites:

- `ShipSkillList` (`src/components/ship/ShipSkillList.tsx`) — iterates
  `getShipSkillRows(ship)` (Active, Charge, the refit-active Passive) and renders one
  `SkillTooltip` per row, `inline`. Has `ship` in scope.
- `ShipIndexPage` (`src/pages/database/ShipIndexPage.tsx`) — renders Active (line ~409),
  Charge (~454), and Passives via `SkillTooltip` inside the portal `Tooltip`. Has `ship`
  in scope.
- `SkillAuditSection`, `SkillEditorModal` — admin/editor surfaces. They will not pass
  targeting; the new prop is optional, so they are unaffected.

Because every surface routes through `SkillTooltip`, integrating there satisfies
"everywhere `SkillTooltip` renders" (the chosen scope).

## Goal

Render a compact SVG board diagram of a skill's targeting footprint beneath the skill text,
for Active and Charge skills that carry targeting data. Passives show nothing (the data
model has no passive targeting). Faithful to the prototype: attacker patterns show a
two-board layout (your team + mirrored enemy with a `▶` arrow); support patterns show a
single own-board.

## Non-goals

- No engine / target-selection behavior change.
- No interactivity (no click, no anchor picking by the user).
- No new targeting data; we consume what `parseShipTargeting` already produces.
- Passive-skill footprints.

## Design

### 1. Display-anchor selection — `src/utils/targeting/displayAnchor.ts` (new)

```ts
export function pickDisplayAnchor(pattern: ParsedPattern): Position
```

The footprint is defined relative to an anchor cell; a bad anchor pushes cells off-board
where `resolveCells` clips them, misrepresenting the shape. We pick the anchor
**algorithmically** (auto-fit), since `resolveCells` already does the clipping for us:

- For each candidate in `ALL_POSITIONS`, compute `resolveCells(pattern, candidate).length`.
- Choose the candidate with the **most** on-board cells (= least clipped).
- Break ties using a fixed preference order biased toward front-center
  (e.g. `M3, M4, M2, M1, T3, …`) so previews echo the prototype's framing and are
  deterministic.

No offset-table introspection and no hand-maintained per-pattern table. `'all'` resolves
full from any anchor; `'lane'` always clips slightly on a 4-wide board, so "most on-board"
yields the best available framing. Pure and unit-tested.

**Non-goal:** pixel-identical reproduction of the prototype's hand-picked anchors. The
prototype framed back-anchored / forward-support patterns at specific cells (e.g.
`Cone-Back` → M2, `Backline` → M1); several candidates can yield the same on-board count,
so auto-fit may frame those differently. Tests therefore assert "fully on-board / sensible
and deterministic", **not** "equals the prototype anchor".

### 2. Board diagram — `src/components/ship/SkillTargetingBoard.tsx` (new)

Presentational, SVG-based (adapts the prototype's `hexPath` / `rawXY` / mirror math,
driven by `board.ts` axial coords — no new dependencies, not the heavy interactive
`HexButton`).

```tsx
interface SkillTargetingBoardProps {
    targeting: SkillTargeting;
}
```

Behavior:

1. `anchor = pickDisplayAnchor(targeting.pattern)`.
2. `cells = resolveCells(targeting.pattern, anchor)` → build a `Map<Position, CellRole>`.
3. **Support vs attacker:** support when `targeting.pattern.modifiers.support === true`
   **or** `targeting.target.side === 'ally'`.
   - **Support:** one own-board. The footprint includes the caster unless the pattern is
     `notSelf` (whose offset table has no origin cell, so no red renders — matches the
     prototype's "no origin").
   - **Attacker:** two boards — your team (decorative/empty) on the left, a `▶` arrow, and
     the mirrored enemy board on the right carrying the footprint.
4. Render each of the 12 hexes: red fill for `origin`, orange for `covered`, dim otherwise,
   with the position label (T1…B4).
5. **Caption + legend:** a short human-readable caption derived from `ParsedTarget` +
   `ParsedPattern` (e.g. `Cone · Range 1 · enemy front`) and a minimal origin/covered
   legend. Kept compact for tooltip use.

A small `targetingLabel(targeting): string` helper (co-located in the component file or in
`displayAnchor.ts`/a sibling util) produces the caption from the parsed shape, range,
modifiers, side, and selection. Range rendering rules (pin these in the plan):

- numeric `range: 0` → omit the range segment entirely (e.g. base/point-blank reads
  `Single target · enemy front`, not `Range 0`);
- `range: 'all'` → `Whole board` (no separate range segment);
- `range: 'lane'` → `Whole lane`;
- numeric `range >= 1` → `Range N`.

Modifiers (`reverse`, `prolonged`, `notSelf`, `double`, `fromCentre`, `anchorMod`) are
appended as short qualifiers where present; shape name is title-cased.

### 3. `SkillTooltip` integration

Add an optional prop:

```tsx
targeting?: SkillTargeting;
```

When present, render `<SkillTargetingBoard targeting={targeting} />` after the parsed skill
text. When absent, behavior is unchanged.

### 4. Callers

- **`ShipSkillList`:** compute `const targeting = parseShipTargeting(ship)` once. For the
  Active row pass `targeting.active`; for the Charge row pass `targeting.charged`; pass
  nothing for the Passive row. Row identity comes from the existing `row.label` — match the
  exact strings `'Active'` and `'Charge'` (passive labels are `Passive R0` / `Passive R2` /
  `Passive R4`, per `getShipSkillRows`), **not** a prefix match.
- **`ShipIndexPage`:** same — compute `parseShipTargeting(ship)` and pass `.active` to the
  Active `SkillTooltip` and `.charged` to the Charge `SkillTooltip`.

### Data flow

`ship` → `parseShipTargeting(ship)` → `{ active?, charged? }` → row-matched
`SkillTargeting` → `SkillTargetingBoard` → `pickDisplayAnchor` + `resolveCells` → role map
→ SVG board(s) + caption.

## Edge cases

- **No targeting on the ship** (`activePattern` empty / not backfilled): `parseShipTargeting`
  yields `undefined` for that skill; the prop is undefined; nothing extra renders.
- **`'all'` pattern:** whole board highlighted.
- **`'lane'` (support whole-lane):** auto-fit minimizes edge clipping.
- **`notSelf` patterns:** offset table has no origin cell → no red origin (intended).
- **Charged inheritance:** already resolved by `parseShipTargeting`.
- **Single-target `base` pattern:** renders a single origin cell — still informative
  (shows front/back single-target); shown.

## Testing

- **`displayAnchor` unit tests:** representative patterns (line/cone/circle/backline) resolve
  to an anchor whose footprint is fully on-board; `'all'` and `'lane'` do not throw and
  return a sensible anchor; tie-break is deterministic.
- **`SkillTargetingBoard` render tests (RTL):** support pattern renders one board; attacker
  pattern renders two boards plus the arrow; the expected origin/covered positions are
  present with the right roles; caption text is present.

## Docs & changelog

- Add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`.
- Update the relevant skill/targeting section of `src/pages/DocumentationPage.tsx`.

## Files

- New: `src/utils/targeting/displayAnchor.ts` (+ test)
- New: `src/components/ship/SkillTargetingBoard.tsx` (+ test)
- Edit: `src/components/ship/SkillTooltip.tsx` (optional `targeting` prop)
- Edit: `src/components/ship/ShipSkillList.tsx` (pass targeting per row)
- Edit: `src/pages/database/ShipIndexPage.tsx` (pass targeting to Active/Charge)
- Edit: `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx`
