# Board Geometry Resolver — Design

**Date:** 2026-06-13
**Status:** Approved (design), pending spec review
**Phase:** Positional combat — piece 1 of 5 (pure geometry layer)

## Context

The targeting data foundation (PR #105) gave us a parsed, structured model of every
ship's target + pattern (`src/utils/targetingParser.ts`). The next arc is positional
combat, decomposed into five sequential sub-projects:

1. **Board geometry resolver** (this spec) — pure: pattern + anchor → covered cells.
2. Engine positional target selection (column-priority, anchor selection, side-symmetric).
3. Forced targeting (Taunt/Provoke/Concentrate Fire) + stealth.
4. Multi-target consequences (AoE accounting, death-fallback retargeting, dead-recipient
   filtering, Harvester on-ally-destroyed, per-actor-per-side results).
5. Simulator page.

This spec covers only piece 1. It answers one question: **given a parsed pattern and an
anchor cell, which board cells does it cover, and at what role?** It is a pure,
dependency-free geometry layer — the same shape as the parser foundation: isolated, fully
unit-tested, no engine changes.

The 3×4 hex board already exists in the encounter feature (`src/types/encounters.ts`
`Position` = `T1–T4` / `M1–M4` / `B1–B4`; `FormationGrid.tsx`).

## Goal

Provide `resolveCells(parsedPattern, anchor) → role-tagged Positions` so the later engine
phases can apply patterns to the board without re-deriving geometry, and so the in-game
geometry ground-truth (the pattern PNGs) is encoded once, tested, and pinned.

## Confirmed game model (ground-truth, user-verified)

These were confirmed interactively against the in-game board and the pattern PNGs
(`~/Downloads/cc/Units/01_Target_Patterns/`, also on Cloudinary):

- **Board:** pointy-top hexes, 3 rows (T/M/B) × 4 columns. The **M row is offset half a
  hex** relative to T/B (left in the team's own frame — matches `FormationGrid` CSS
  `ml-[-12.5%]`).
- **Adjacency:** each cell has up to 6 neighbors. Canonical check: **M2 ↔ T1, T2, M1, M3,
  B1, B2**.
- **Columns & facing:** column `k = {Tk, Mk, Bk}`. **Column 4 = front** (nearest the
  enemy); column 1 = back. The enemy board is a **horizontal mirror** of the team board
  (their col 4 faces yours; their M row skews the opposite way).
- **Frame-agnostic:** each board is identical in its own frame (col 4 = front, M offset
  toward back). The mirror is a **display-only** concern. One set of per-shape offset
  tables works for both sides; the resolver returns Positions in the anchor's own board
  frame and needs no side parameter.
- **Pattern PNG convention:** the **bright hex = origin** (the anchor); **dark hexes =
  covered** cells; a small ship icon = the caster (reference only, never a covered cell).
- **Damage falloff:** **origin = 100% damage, covered = 50%**. Falloff applies to **damage
  only** — heals, buffs, and debuffs apply at full strength to every cell in the pattern.
- **Anchoring:** attack patterns anchor on a chosen enemy cell; **support patterns anchor
  on the caster's own cell** and stamp on the caster's own board. (Which cell is the
  anchor — column-priority, front/back/skip — is the *next* phase; this resolver takes the
  anchor as input.)

## Non-goals (later phases)

Anchor selection (column-priority, front/back/skip → which cell); living/dead/stealth
filtering; forced targeting; applying damage or the role→multiplier mapping; multi-target
accounting; any UI or simulator work.

## Design

### Module layout — new `src/utils/targeting/` folder

| File | Responsibility |
|------|----------------|
| `board.ts` | The 12 `Position`s, their axial hex coordinates, `neighbors()`, `inBounds()`, axial↔Position conversion. Encodes the confirmed adjacency and `col 4 = front`. |
| `patternOffsets.ts` | The per-shape offset tables (data): one entry per distinct corpus `(shape, range, modifiers)` signature (~34), each a list of `{ offset, role }` in canonical attacker-facing space, hand-derived from the PNGs. |
| `resolvePattern.ts` | `resolveCells(parsed, anchor)`: look up the table by pattern signature, translate by the anchor in axial space, drop off-board cells, return role-tagged Positions. Plus the signature/key helper. |
| `index.ts` (optional) | Re-export the public surface. |

`targetingParser.ts` stays where it is (consumed as-is via its `ParsedPattern` type).

### Coordinate model (`board.ts`)

- The 12 fixed `Position`s map to **axial hex coordinates** consistent with the confirmed
  adjacency. The depth axis runs front↔back (col 4 ↔ col 1); the row axis runs across
  T/M/B with the M-row half-offset.
- `neighbors(pos): Position[]` — the up-to-6 adjacent cells (verified by the M2 case and
  by every cell's expected neighbor set in tests).
- `inBounds(axial): boolean` and `axialToPosition` / `positionToAxial` — total over the 12
  cells, `undefined`/false off-board.
- Exact axial assignment is an implementation choice; the test suite pins adjacency so any
  valid assignment that reproduces it is acceptable.

### Offset tables (`patternOffsets.ts`)

- Keyed by a **normalized pattern signature** derived from the `ParsedPattern` (shape +
  range + the geometry-affecting modifiers). The parser already normalizes the `Patern`
  typo, so `Patern-Support-All` and `Pattern-Support-All` collapse to one entry.
  **`range` participates in the signature** (not just `shape`): the two special cases are
  keyed off *different* parts — `all` by `shape === 'all'`, `whole-lane` by
  `range === 'lane'` (whose shape is `line`). An implementer keying only on `shape` would
  mis-handle `whole-lane`.
- Each entry is a list of `{ offset: AxialDelta, role: 'origin' | 'covered' }` in canonical
  attacker-facing space (depth+ = toward enemy back; row± = across T/M/B), **hand-derived
  from that pattern's PNG**.
- **No assumed parametric scaling or rule-based modifier transforms.** `Range-1/2/3` are
  each derived from their own PNG; `reverse` / `back` / `from-centre` / `double` /
  `not-self` are baked into their own table (e.g. `not-self` simply omits the caster cell),
  not computed. This is deliberately conservative given the small/uncertain images.
- **Special cases:**
  - `shape: 'all'` (Pattern-All, Pattern-Support-All) → resolves to **all 12 positions**,
    all role `origin` (uniform full strength; the engine filters to living/targetable
    ships). No geometry/anchor dependence.
  - `whole-lane` (Pattern-Line-Support-whole-lane, Harvester/Volk) → a **caster-centered
    line: 2 forward + caster + 2 back = 5 cells** along the lane (depth axis), clipped to
    the board. Origin = the caster (anchor) cell.

### Resolution (`resolvePattern.ts`)

```ts
export type CellRole = 'origin' | 'covered';
export interface ResolvedCell { position: Position; role: CellRole; }

export function resolveCells(pattern: ParsedPattern, anchor: Position): ResolvedCell[];
```

Algorithm:
1. Build the signature from `pattern`; look up its offset table. **Unknown signature →
   throw** (the coverage gate — mirrors the parser's throw-on-unknown).
2. Handle the special `all` case directly (all 12, role `origin`).
3. Otherwise: `originAxial = positionToAxial(anchor)`; for each `{ offset, role }`, compute
   `originAxial + offset`, convert to a `Position`, **drop if off-board**.
4. Return the surviving role-tagged cells. Geometric patterns yield exactly one `origin`;
   `all` yields all-`origin`.

The resolver assumes a valid in-board `anchor` (the engine guarantees this when it selects
the anchor). The role→damage-multiplier mapping (origin ×1.0, covered ×0.5, damage only)
lives in the engine, not here.

### Data flow

```
ParsedPattern (from targetingParser)  ──┐
                                         ├─►  resolveCells(pattern, anchor)  ──►  ResolvedCell[]
anchor: Position (engine picks it)     ──┘                                         (own-frame Positions)
```

## Testing

- **`board.ts`:** unit tests for each cell's `neighbors` (incl. the M2 canonical case and
  edge cells like T4/B1), `inBounds`, and axial round-trip over all 12 cells.
- **`resolvePattern.ts` — golden per shape:** one test per distinct corpus pattern, anchored
  at a known cell, asserting the exact expected role-tagged Positions. **The PNG filename
  goes in the test name** so the maintainer can eyeball each golden against its image — the
  ~90%-confidence shapes surface here for correction.
- **Corpus gate:** for every distinct pattern string in `docs/ship-targeting.csv`,
  `parse → resolveCells` at a sample anchor (1) throws on no unknown signature, (2) returns
  exactly one `origin` (except `all`), and (3) returns only valid board Positions. Skips
  cleanly if the gitignored CSV is absent. **Read the CSV via `parseTargetingCsv`** (the
  parser's existing helper — handles the file's CRLF line endings), not a naive split.
- **Special cases tested explicitly:** `all` (12 cells), `whole-lane` (5-cell caster line,
  incl. clipping when the caster is near an edge), `not-self` (caster cell omitted), and a
  couple of clipping cases (origin near a board edge dropping off-board covered cells).

## Risks / notes

- **The offset tables are the bulk of the work and the main uncertainty** — ~34 tables
  hand-derived from small PNGs, some of which the maintainer is ~90% sure on. Mitigation:
  one golden test per shape named after its PNG; corrections are a one-line table edit +
  golden update. The plan should make each shape (or small group) its own task.
- **Axial assignment is free** as long as it reproduces the confirmed adjacency; tests pin
  behavior, not the coordinate choice.
- **`Reverse-*` shapes** likely mirror their base shape along the depth axis, but we encode
  them from their own PNG rather than computing a transform (conservative).
- The role model keeps geometry pure: `origin`/`covered` is structural; the 50% damage
  number is a combat constant applied later.

## Success criteria

- `board.ts` adjacency matches the confirmed model (M2 ↔ T1/T2/M1/M3/B1/B2; col 4 front).
- Every distinct `ship-targeting.csv` pattern resolves with no unknown-signature throw, a
  valid origin, and on-board Positions only.
- Golden tests pin each shape's footprint against its PNG.
- Pure module, no engine/UI changes; existing suite unchanged; `lint` + `tsc` clean.

## Appendix — corpus pattern work-list (~34 distinct signatures)

Derived from `docs/ship-targeting.csv` (active + charged). Each needs an offset table +
golden, derived from its PNG:

```
Pattern-Base                              Pattern-Circle-Range-1
Pattern-Base-Support                      Pattern-Circle-Support-Range-1
Pattern-Cone-Range-1                      Pattern-Backline-Range-1
Pattern-Cone-Back-Range-1                 Pattern-Backline-Range-2
Pattern-Cone-Support-Range-1              Pattern-Root-Range-1
Pattern-Prolonged_Cone-Support-Range-2    Pattern-Split-Range-1
Pattern-Prolonged_Cone-Support-Center-Range-2   Pattern-Range-3
Pattern-Reverse-Cone-Range-1              Pattern-Burst-Range-1
Pattern-Line-Range-1                      Pattern-Scattershot-Range-1
Pattern-Line-Range-2                      Pattern-Wings-Support-Not-Self-Range-2
Pattern-Line-Range-3                      Pattern-Support-Forward-Circle-Range-1
Pattern-Line-from-centre-Range-1          Pattern-Support-Double-Pickaxe-Range-1
Pattern-Line-Support-Range-1              Pattern-Support-Double-Pickaxe-Range-0
Pattern-Line-Support-Range-3              Pattern-Support-All  (== Patern-Support-All)
Pattern-Line-Support-Not-Self-Range-2     Pattern-All
Pattern-Line-Support-whole-lane           Pattern-Cross-Range-1
Pattern-Curve-Range-1                     Pattern-Reverse-Curve-Range-1
```
```

(`Pattern-All` and `Pattern-Support-All` use the `all` special case; `whole-lane` uses the
caster-line special case. The rest are PNG-derived offset tables.)
