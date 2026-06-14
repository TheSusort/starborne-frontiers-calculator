# Positional Target-Selection (Engine) — Design

**Date:** 2026-06-14
**Status:** Approved (design), pending spec review
**Phase:** Positional combat — piece 2 of 5 (engine target selection)

## Context

The positional-combat arc is decomposed into five sequential sub-projects:

1. **Board geometry resolver** (PR #106) — pure: pattern + anchor → covered cells.
2. **Engine positional target selection** (this spec) — column/row-priority + anchor
   selection, wired into the engine, side-symmetric.
3. Forced targeting (Taunt/Provoke/Concentrate Fire) + stealth.
4. Multi-target consequences (AoE accounting, death-fallback retargeting, dead-recipient
   filtering, Harvester on-ally-destroyed, per-actor-per-side results).
5. Simulator page.

Pieces 1 (geometry resolver, `src/utils/targeting/`) and the data foundation (PR #105,
`src/utils/targetingParser.ts` → `ParsedTarget` / `ParsedPattern`) are merged. This spec is
piece 2.

### The problem this phase solves

The combat engine today is pure focus-fire with **no target choice**:

- Every player actor (attacker + team) attacks a single dummy `enemy` stat-block (DPS mode)
  — the damage *sink*; its HP is never reduced, only a cumulative-damage scalar is tracked
  for HP%-gates.
- In healing mode, enemy attackers all hit the pre-bound `healTarget`.

There is no board, no multiple targetable ships, and no selection logic anywhere. Real
positional *selection* (which enemy gets hit) only becomes meaningful once the receiving
side is a *positioned team of several ships*. This phase introduces that capability.

### Scope decisions (ratified during brainstorming)

- **Approach: optional positioned overlay on the existing engine** (not a new
  team-agnostic entry point, not a positions-drive-selection-but-funnel-to-sink stub).
  Positions are an *optional* addition; when present, target binding routes through a new
  selection step; when absent, the engine behaves exactly as today.
- **Capability-only — no UI.** No production caller passes positions in this phase. The
  existing DPS/healing calculators are untouched and hit the backward-compat fallback, so
  all existing goldens stay **byte-identical**. The new positional path is exercised solely
  by new synthetic engine tests. The Phase-5 simulator becomes the first real caller.
- **Full ordered-list selection, single-anchor apply.** `selectTargets` resolves every
  target type to an ordered target list, but Phase 2 only *applies* to the **primary
  anchor** (list head). `front`/`back`/`skip` (122 of the 147 corpus ships) get their
  complete, correct single-target behavior now. The inherently multi-target selections
  (`all`, ally `team`/`others`/`all-allies`) resolve to an ordered list + a deterministic
  primary anchor; the *splash to the rest of the list* is deferred to Phase 4.

## Non-goals (later phases)

- Covered-cell AoE application and the role→damage-multiplier mapping (origin ×1.0,
  covered ×0.5) — Phase 4. `resolveCells` is therefore **not wired into the engine** this
  phase.
- Stealth exclusion and forced targeting (Taunt/Provoke/Concentrate Fire) — Phase 3.
- Death-fallback retargeting (a target dies mid-resolution → retarget), dead-recipient
  filtering polish, per-actor-per-side result/reporting surface — Phase 4.
- Any UI or simulator work — Phase 5.

Phase 2 selects over the **living set at selection time** and stops there.

## Confirmed selection model (ground-truth, user-ratified)

Targeting is **row-first, then column within the row**. (Rows map directly between the two
boards — T↔T, M↔M, B↔B — even though the columns are a horizontal mirror; see the geometry
resolver spec.)

### Row priority

Scan starts at the **caster's own row** and **descends with wraparound** (down a row;
bottom wraps to top), covering all three rows:

| Caster row | Row scan order |
|------------|----------------|
| T | T, M, B |
| M | M, B, T |
| B | B, T, M |

`targetRow` = the **first row in that order that contains ≥1 living enemy**.

Example: a front attacker in the middle row, with an enemy only in the top row → scan
M (empty), B (empty), T (occupied) → targetRow = T.

### Column within the target row

Let `cols` = the occupied columns of `targetRow`, sorted **front→back** (column 4 is the
front / nearest the attacker; column 1 is the back). Then:

| Selection | Anchor | Ordered list |
|-----------|--------|--------------|
| `front` | front-most (`cols[0]`) | `cols` (front→back) |
| `back` | back-most (`cols[last]`) | `cols` reversed (back→front) |
| `skip` | 2nd-from-front (`cols[1]`) | `[cols[1], cols[2], …, cols[last], cols[0]]` — continue toward the back, the skipped front-most goes **last** |

`front` and `back` degrade naturally for any `cols.length ≥ 1` (no special case). **`skip`
needs a single-occupied fallback:** when `cols.length === 1`, `skip` resolves like `front`
— `ordered = cols`, anchor `cols[0]`. (So for `cols.length === 1`, all three selections
yield `ordered = cols`, anchor `cols[0]`.)

Worked examples:

- 3 enemies at M4, M2, M1 (`cols = [4, 2, 1]`):
  - `front` → ordered `[M4, M2, M1]`, anchor M4
  - `skip`  → ordered `[M2, M1, M4]`, anchor M2
  - `back`  → ordered `[M1, M2, M4]`, anchor M1
- 2 enemies at M4, M1 (`cols = [4, 1]`): `skip` → anchor `cols[1]` = M1, ordered
  `[cols[1], cols[0]] = [M1, M4]`.
- 1 enemy at M4 (`cols = [4]`): `front`/`back`/`skip` all → anchor M4, ordered `[M4]`.

### Enemy `all` and ally selections

- **`all` (enemy)** → ordered list = every living enemy, in (row-scan order, then front→back
  within each row); anchor = head. (Splash to the full list is Phase 4.)
- **Ally `team` / `others` / `all-allies` / `self`** → support patterns **anchor on the
  caster's own cell** (the geometry resolver's confirmed rule); the `not-self`/`others`
  exclusion is already baked into the pattern offset tables. So for `side: 'ally'`,
  `anchor = casterPosition`. The ordered ally list (for Phase-4 splash) is the caster-frame
  footprint, not a selection scan.

### Empty side

No living targets on the requested side → `anchor: null` (the engine treats this as "no
valid target for this action"; death-fallback *retargeting* is Phase 4).

## Design

### New pure module — `src/utils/targeting/selectTargets.ts`

Sits beside `board.ts` / `patternOffsets.ts` / `resolvePattern.ts`; dependency-free, fully
unit-tested — the same isolation as the rest of the geometry layer.

```ts
export interface SelectTargetsContext {
  casterPosition: Position;  // the acting actor's own cell — REQUIRED (drives the row scan)
  enemyOccupied: Position[]; // living, targetable enemy cells (own frame); ≤1 actor per cell
  allyOccupied?: Position[]; // forward-looking (Phase-4 ally splash); UNUSED in Phase-2 selection
}

export interface SelectionResult {
  ordered: Position[];        // full ordered target list (head = anchor)
  anchor: Position | null;    // null when the requested side has no living target
}

export function selectTargets(
  target: ParsedTarget,        // from targetingParser: { side, selection, raw }
  ctx: SelectTargetsContext
): SelectionResult;
```

Algorithm (branch on `target.side`/`selection` *before* the single-row work):

1. **Ally side** (`target.side === 'ally'`): `anchor = ctx.casterPosition`; `ordered` =
   `[casterPosition]` for Phase 2 (full ally footprint is Phase-4 splash). `self` is the
   same — caster only. (`allyOccupied` is not consulted.)
2. **Enemy side:** if `ctx.enemyOccupied` is empty → `{ ordered: [], anchor: null }`.
3. **Enemy `all`:** iterate every row in `casterPosition`'s row-scan order, each row's cols
   front→back; `ordered` = that full living-enemy list; `anchor = ordered[0]`. (Does **not**
   use a single `targetRow`.) Return.
4. **Enemy `front`/`back`/`skip`:** compute the row scan order from `casterPosition`'s row
   (table above); `targetRow` = first row in that order with ≥1 cell in `enemyOccupied`;
   `cols` = occupied columns of `targetRow`, sorted front→back; apply the within-row rule
   (table above) to produce `ordered`; `anchor = ordered[0]`.

The row/column helpers (`rowScanOrder(row)`, `colsFrontToBack`) live in or beside
`board.ts` (which already encodes "col 4 = front" and row/column extraction from a
`Position`).

### Engine integration (`src/utils/combat/engine.ts`, `playerTurn.ts`)

**Positions in the model (all optional):**

- `position?: Position` on the attacker input, each team actor input, and each enemy
  attacker input.
- A new optional **positioned enemy roster** input: real `CombatActor`s (built with the
  existing `createActor`, carrying HP + DoT/bomb/accumulator containers like enemy
  attackers already do). Player team actors are already real `CombatActor`s — they gain a
  `position` and become targetable.

**Positional mode detection — exact predicate:** positional mode is on **iff a positioned
receiving roster is supplied AND the acting actor has a `position`**. Any other shape
(no roster, or the acting actor lacks a position) → non-positional fallback. This is the
precondition that guarantees `selectTargets` always has a `casterPosition`; a
partially-positioned input never enters the positional branch (so it can never half-bind or
regress). When the predicate is false, every binding below uses today's exact path.

**One-actor-per-cell invariant:** at most one living actor occupies any `Position`. The
engine builds a `Map<Position, CombatActor>` over the *living, positioned* actors of the
target side and feeds exactly that map's keys to `selectTargets` as `enemyOccupied`.
`selectTargets` only ever returns Positions drawn from that input, so a non-null `anchor`
always round-trips to exactly one actor. Actors without a `position` are **not** in the
occupied set and are not targetable in positional mode.

**Target binding (the seam):** at the points where the target is currently hard-coded —
the player attacker's `enemy` (engine.ts ~969 / damage emission in `runPlayerTurn`) and the
enemy attacker's `healTarget` binding (engine.ts ~2700–2747) — branch on positional mode:

- **Positional:** build the living-positioned `Map<Position, CombatActor>` for the target
  side (own frame for the acting side), call `selectTargets` with its keys as
  `enemyOccupied`, map the returned `anchor` Position → that map's actor → the target for
  this action. (`anchor: null` → no valid target this action.)
- **Non-positional:** today's binding (dummy sink for player attacks; `healTarget` for
  enemy attacks). **Goldens byte-identical.**

**Single-target apply:** only the anchor actor takes damage. `resolveCells` is not invoked.

**Side-symmetry:** enemy attackers in positional mode select among the positioned player
team via the *same* `selectTargets`; their incoming routes through the existing
`applyIncomingToTarget` path, generalized from "the heal target" to "the selected actor".

**DPS HP%-gates:** in positional mode read the selected anchor's real `currentHp` (each
positioned enemy is a real HP-tracking actor) rather than the dummy-sink cumulative scalar.

### Data flow

```
ParsedTarget (targetingParser) ─┐
                                 ├─► selectTargets(target, ctx) ─► { ordered, anchor }
caster + living occupied cells ─┘                                        │
                                                                         ▼
                                              engine maps anchor Position → CombatActor
                                              → single-target damage apply (anchor only)
```

## Testing

- **`selectTargets` unit + golden tests:** named goldens (board layout in the test name, to
  eyeball against the game) for: row-scan with caster-row wraparound (incl. the
  empty-near-rows case); `front`/`back`/`skip` column choice + ordered list on the
  M4/M2/M1 worked example; `skip`/`back` single-occupied fallback; `all` cross-row ordering;
  ally→caster anchor; empty-side `null`.
- **Engine integration tests (synthetic positioned teams):** damage routes to the *selected*
  anchor (front attacker hits front enemy; same-row-empty descends to the next row;
  skip/back pick the right cell); a side-symmetric case (enemy attacker selecting among a
  positioned player team and routing incoming to the selected actor).
- **Regression:** full existing suite + all DPS/healing goldens **byte-identical** — the
  fallback path proves no caller passes positions.
- **Optional verification aid:** an HTML board visualization for selection cases, mirroring
  the geometry-resolver verification path, if the maintainer wants to eyeball the row-scan.

## Risks / notes

- **The row/column tiebreaks are the ground-truth-sensitive part.** They live in one
  documented place (`selectTargets` + the row-scan table) and are pinned by named golden
  tests; a correction is a one-line edit + golden update — the same containment the offset
  tables use.
- **Touching the engine's most fragile seam** (the hard-coded target binding). Mitigation:
  the positional branch is strictly additive and gated; the non-positional path is
  unchanged and proven byte-identical by the golden regression. The selection seam is built
  **side-symmetric**, so it is the team-agnostic seam the simulator (Phase 5) inherits — not
  throwaway scaffolding.
- **`resolveCells` stays unused by the engine** until Phase 4; computing footprints now
  would be dead work given single-target apply.

## Success criteria

- `selectTargets` reproduces the confirmed row-first / within-row model, including the
  M4/M2/M1 worked example and the caster-row wraparound.
- In positional mode, player attacks and enemy attacks both route single-target damage to
  the `selectTargets` anchor, via the same machinery (side-symmetric).
- No caller passes positions → existing behavior unchanged; all DPS/healing goldens
  byte-identical; full suite green; `lint` + `tsc` clean.
