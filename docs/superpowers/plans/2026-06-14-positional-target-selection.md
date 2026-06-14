# Positional Target-Selection (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the combat engine the ability to select *which* opposing ship an attacker
hits, from board positions (row-first scan + within-row front/back/skip), wired
side-symmetrically — gated so that with no positions the engine behaves exactly as today.

**Architecture:** A new pure `selectTargets` module (positions + parsed target → ordered
list + anchor) layered on the existing geometry resolver, plus an *optional overlay* on the
engine: positions/targets are optional inputs; positional mode is entered only when a
positioned opposing roster exists AND the acting actor has a position, otherwise the engine
uses today's hard-coded dummy-sink / heal-target binding. Phase 2 applies single-target
(the selected anchor); AoE/stealth/forced-targeting/per-target accounting are later phases.

**Tech Stack:** TypeScript, Vitest. Pure modules in `src/utils/targeting/`; engine in
`src/utils/combat/engine.ts` + `playerTurn.ts`.

**Spec:** `docs/superpowers/specs/2026-06-14-positional-target-selection-design.md`

**Worktree:** all work happens in `.worktrees/positional-target-selection`
(branch `feat/combat-engine-positional-target-selection`). A parallel session owns the main
working directory — never `git checkout` there.

**Workflow notes (from project memory):**
- Run tests with `npm test` (Vitest). Lint: `npm run lint` (max-warnings 0). Types: `npx tsc --noEmit`.
- **Never** regenerate goldens with `vitest -u`. Goldens must stay byte-identical; if one
  changes, the positional gating is leaking — STOP and fix the gate, don't update the golden.
- `git commit` runs a pre-commit hook that runs the full suite. For docs-only commits use
  `--no-verify`. For code commits, let the hook run (it's the regression gate).
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/utils/targeting/board.ts` | board geometry (exists) | **Modify** — add `rowOf`/`colOf` accessors + `BoardRow` type |
| `src/utils/targeting/selectTargets.ts` | pure selection: parsed target + occupancy → ordered list + anchor | **Create** |
| `src/utils/targeting/selectTargets.test.ts` | unit + golden selection tests (**co-located**, project convention) | **Create** |
| `src/utils/targeting/board.test.ts` | board tests (exists, **co-located**) | **Modify** — add `rowOf`/`colOf` tests |
| `src/utils/combat/positionalBinding.ts` | engine↔selectTargets glue: `isPositional`, `resolvePositionalTarget` (keeps `engine.ts` focused + unit-testable) | **Create** |
| `src/utils/combat/state.ts` | `CombatActor` (exists) | **Modify** — add `position?: Position`; widen `createActor` param to accept it |
| `src/utils/combat/engine.ts` | engine input + target binding seam | **Modify** — optional position/target on `CombatEngineInput`+`TeamActorEngineInput`+`enemyAttackers`(768)+`EnemyActorInput`(304); set `position` on actors; gated binding at 3 `runPlayerTurn` sites |
| `src/utils/combat/__tests__/positionalSelection.test.ts` | engine integration tests (synthetic positioned teams) | **Create** |

> **Test-file convention:** `src/utils/targeting/` uses **co-located** tests
> (`board.test.ts` imports `'./board'`) — there is NO `__tests__/` subdir there. Put
> `selectTargets.test.ts` co-located (`import { selectTargets } from './selectTargets'`,
> `import type { ParsedTarget } from '../targetingParser'`). `src/utils/combat/` uses a
> `__tests__/` subdir — `positionalSelection.test.ts` goes there.

**Decomposition:** Part A is pure and carries zero engine risk — land it fully first. Part B
adds optional input fields + the internal selection helper with **no behavior change**
(goldens byte-identical). Part C wires the gated positional branch into the three
`runPlayerTurn` binding sites.

---

## Part A — Pure selection module

### Task A1: board accessors `rowOf` / `colOf`

**Files:**
- Modify: `src/utils/targeting/board.ts`
- Test: `src/utils/targeting/board.test.ts` (co-located, exists)

- [ ] **Step 1: Write failing tests** — append to `board.test.ts` (co-located; it imports
  from `'./board'`):

```ts
import { rowOf, colOf } from './board';

describe('rowOf / colOf', () => {
  it('extracts the row letter', () => {
    expect(rowOf('T1')).toBe('T');
    expect(rowOf('M3')).toBe('M');
    expect(rowOf('B4')).toBe('B');
  });
  it('extracts the column number', () => {
    expect(colOf('T1')).toBe(1);
    expect(colOf('M3')).toBe(3);
    expect(colOf('B4')).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/utils/targeting/board.test.ts`
Expected: FAIL — `rowOf`/`colOf` not exported.

- [ ] **Step 3: Implement** — add to `board.ts`:

```ts
export type BoardRow = 'T' | 'M' | 'B';

/** The row letter of a Position ('T1' -> 'T'). */
export function rowOf(pos: Position): BoardRow {
    return pos[0] as BoardRow;
}

/** The 1-based column of a Position ('M3' -> 3); column 4 = front (nearest enemy). */
export function colOf(pos: Position): number {
    return Number(pos[1]);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/utils/targeting/board.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/targeting/board.ts src/utils/targeting/board.test.ts
git commit -m "feat(targeting): rowOf/colOf board accessors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: `selectTargets` — ally, empty, and enemy front/back/skip

**Files:**
- Create: `src/utils/targeting/selectTargets.ts`
- Test: `src/utils/targeting/selectTargets.test.ts` (co-located)

- [ ] **Step 1: Write failing tests** — create `selectTargets.test.ts` co-located. Use board
layouts in the test names (the eyeball-against-game gate). `ParsedTarget` shapes mirror
`targetingParser` output.

```ts
import { describe, it, expect } from 'vitest';
import { selectTargets, rowScanOrder } from './selectTargets';
import type { ParsedTarget } from '../targetingParser';

const enemy = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: `enemy-${selection}`, side: 'enemy', selection,
});
const ally = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: `ally-${selection}`, side: 'ally', selection,
});

describe('rowScanOrder — caster row, descend with wraparound', () => {
    it('T -> [T,M,B]', () => expect(rowScanOrder('T')).toEqual(['T', 'M', 'B']));
    it('M -> [M,B,T]', () => expect(rowScanOrder('M')).toEqual(['M', 'B', 'T']));
    it('B -> [B,T,M]', () => expect(rowScanOrder('B')).toEqual(['B', 'T', 'M']));
});

describe('selectTargets — ally side anchors on the caster', () => {
    it('team/others/all/self all anchor on caster, ordered [caster]', () => {
        for (const sel of ['team', 'others', 'all', 'self'] as const) {
            const r = selectTargets(ally(sel), { casterPosition: 'M2', enemyOccupied: [], allyOccupied: ['M2', 'M3'] });
            expect(r).toEqual({ ordered: ['M2'], anchor: 'M2' });
        }
    });
});

describe('selectTargets — empty enemy side', () => {
    it('returns null anchor', () => {
        expect(selectTargets(enemy('front'), { casterPosition: 'M2', enemyOccupied: [] }))
            .toEqual({ ordered: [], anchor: null });
    });
});

describe('selectTargets — within-row front/back/skip (caster M4 vs enemies M4,M2,M1)', () => {
    const ctx = { casterPosition: 'M4' as const, enemyOccupied: ['M4', 'M2', 'M1'] as const };
    it('front -> [M4,M2,M1], anchor M4', () => {
        expect(selectTargets(enemy('front'), ctx)).toEqual({ ordered: ['M4', 'M2', 'M1'], anchor: 'M4' });
    });
    it('skip -> [M2,M1,M4], anchor M2', () => {
        expect(selectTargets(enemy('skip'), ctx)).toEqual({ ordered: ['M2', 'M1', 'M4'], anchor: 'M2' });
    });
    it('back -> [M1,M2,M4], anchor M1', () => {
        expect(selectTargets(enemy('back'), ctx)).toEqual({ ordered: ['M1', 'M2', 'M4'], anchor: 'M1' });
    });
});

describe('selectTargets — single/two occupied fallbacks (caster M4)', () => {
    it('skip with two enemies M4,M1 -> anchor M1, ordered [M1,M4]', () => {
        expect(selectTargets(enemy('skip'), { casterPosition: 'M4', enemyOccupied: ['M4', 'M1'] }))
            .toEqual({ ordered: ['M1', 'M4'], anchor: 'M1' });
    });
    it('one enemy M4: front/back/skip all -> [M4], anchor M4', () => {
        for (const sel of ['front', 'back', 'skip'] as const) {
            expect(selectTargets(enemy(sel), { casterPosition: 'M4', enemyOccupied: ['M4'] }))
                .toEqual({ ordered: ['M4'], anchor: 'M4' });
        }
    });
});

describe('selectTargets — row-first scan (caster M, enemies only in top row T1,T3)', () => {
    it('front descends M(empty)->B(empty)->T, picks front-most T3', () => {
        expect(selectTargets(enemy('front'), { casterPosition: 'M2', enemyOccupied: ['T1', 'T3'] }))
            .toEqual({ ordered: ['T3', 'T1'], anchor: 'T3' });
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/utils/targeting/selectTargets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `selectTargets.ts`:

```ts
import { Position } from '../../types/encounters';
import { ParsedTarget } from '../targetingParser';
import { BoardRow, rowOf, colOf } from './board';

export interface SelectTargetsContext {
    /** The acting actor's own cell — REQUIRED (drives the row scan). */
    casterPosition: Position;
    /** Living, targetable enemy cells in the acting side's own frame (≤1 actor per cell). */
    enemyOccupied: Position[];
    /** Forward-looking (Phase-4 ally splash). UNUSED in Phase-2 selection. */
    allyOccupied?: Position[];
}

export interface SelectionResult {
    /** Full ordered target list; head === anchor. */
    ordered: Position[];
    /** null when the requested side has no living target. */
    anchor: Position | null;
}

const ROWS: BoardRow[] = ['T', 'M', 'B'];

/** Row scan order: start at the caster's row, descend a row, wrap bottom->top. */
export function rowScanOrder(casterRow: BoardRow): BoardRow[] {
    const i = ROWS.indexOf(casterRow);
    return [ROWS[i], ROWS[(i + 1) % 3], ROWS[(i + 2) % 3]];
}

/** Occupied cells of `row`, sorted front->back (column 4 first). */
function colsFrontToBack(row: BoardRow, occupied: Position[]): Position[] {
    return occupied.filter((p) => rowOf(p) === row).sort((a, b) => colOf(b) - colOf(a));
}

export function selectTargets(target: ParsedTarget, ctx: SelectTargetsContext): SelectionResult {
    // Ally side: support patterns anchor on the caster's own cell.
    if (target.side === 'ally') {
        return { ordered: [ctx.casterPosition], anchor: ctx.casterPosition };
    }

    // Enemy side.
    if (ctx.enemyOccupied.length === 0) {
        return { ordered: [], anchor: null };
    }

    const scan = rowScanOrder(rowOf(ctx.casterPosition));

    // `all`: every living enemy, row-scan order then front->back within each row.
    if (target.selection === 'all') {
        const ordered = scan.flatMap((row) => colsFrontToBack(row, ctx.enemyOccupied));
        return { ordered, anchor: ordered[0] };
    }

    // front/back/skip: first row in scan order with >=1 enemy.
    const targetRow = scan.find((row) => ctx.enemyOccupied.some((p) => rowOf(p) === row))!;
    const cols = colsFrontToBack(targetRow, ctx.enemyOccupied); // front->back

    let ordered: Position[];
    switch (target.selection) {
        case 'back':
            ordered = [...cols].reverse();
            break;
        case 'skip':
            // 2nd-from-front anchor; continue toward the back, skipped front-most goes last.
            // length 1 -> degrades to [cols[0]] (== front).
            ordered = cols.length === 1 ? cols : [...cols.slice(1), cols[0]];
            break;
        case 'front':
        default:
            ordered = cols;
            break;
    }
    return { ordered, anchor: ordered[0] };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/utils/targeting/selectTargets.test.ts` → PASS.

- [ ] **Step 5: Lint + types**

Run: `npm run lint && npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/targeting/selectTargets.ts src/utils/targeting/selectTargets.test.ts
git commit -m "feat(targeting): selectTargets — row-first anchor selection (front/back/skip/ally)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: `selectTargets` — enemy `all` cross-row ordering

**Files:**
- Test: `src/utils/targeting/selectTargets.test.ts` (append)

(The implementation already handles `all` in A2; this task pins its cross-row behavior with
dedicated goldens. If A2's `all` branch is already covered, this is a fast confirmation
task — still write the explicit cross-row golden.)

- [ ] **Step 1: Write failing/confirming test** — append:

```ts
describe('selectTargets — enemy all spans every row in scan order (caster M2)', () => {
    it('orders M row first (front->back), then B, then T', () => {
        const r = selectTargets(
            { raw: 'all', side: 'enemy', selection: 'all' },
            { casterPosition: 'M2', enemyOccupied: ['T1', 'B3', 'M1', 'M4'] }
        );
        // scan M,B,T: M front->back = M4,M1 ; B = B3 ; T = T1
        expect(r.ordered).toEqual(['M4', 'M1', 'B3', 'T1']);
        expect(r.anchor).toBe('M4');
    });
});
```

- [ ] **Step 2: Run** → PASS (already implemented). If it FAILS, fix the `all` branch in
`selectTargets.ts` to match.

- [ ] **Step 3: Commit** (only if any change was needed; otherwise fold into A2's commit by
running before committing A2 — implementer's choice).

```bash
git add src/utils/targeting/selectTargets.test.ts
git commit -m "test(targeting): pin selectTargets enemy-all cross-row ordering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part B — Engine input model + internal selection helper (no behavior change)

> Goal: add the optional plumbing and the internal helper, **consumed by nothing yet**.
> After every task in Part B the full suite + all DPS/healing goldens stay **byte-identical**.

### Task B1: optional position/target fields on the engine input

**Files:**
- Modify: `src/utils/combat/engine.ts` (`CombatEngineInput` ~716; `TeamActorEngineInput`;
  the inline `enemyAttackers` entry type ~768; **`EnemyActorInput` ~304**)

Read the current `CombatEngineInput`, `TeamActorEngineInput`, the inline `enemyAttackers`
entry, and `EnemyActorInput` first. **Note:** there are TWO enemy-attacker input shapes —
the inline `CombatEngineInput['enemyAttackers'][number]` (~768) AND the separate
`EnemyActorInput` interface (~304) that `buildEnemyPlayerActorRuntime` actually consumes.
The field must be added to **both** or it never reaches the actor builder.

- [ ] **Step 1: Add optional fields (no consumption):**
  - `CombatEngineInput`: `position?: Position;` and `target?: ParsedTarget;` (the focus
    attacker's cell + parsed targeting).
  - `TeamActorEngineInput`: `position?: Position;` and `target?: ParsedTarget;`.
  - inline `enemyAttackers[]` entry (~768): `position?: Position;` and `target?: ParsedTarget;`.
  - **`EnemyActorInput` (~304): `position?: Position;` and `target?: ParsedTarget;`** (the
    shape `buildEnemyPlayerActorRuntime` reads).
  - Add imports: `import { Position } from '../../types/encounters';` and
    `import { ParsedTarget } from '../targetingParser';` (check they aren't already imported).

- [ ] **Step 2: Verify nothing consumes them yet** — `npx tsc --noEmit` clean; no logic
  references the new fields.

- [ ] **Step 3: Run full suite + goldens**

Run: `npm test`
Expected: ALL pass, goldens byte-identical (optional fields, zero behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): optional position/target fields on engine input (positional plumbing)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2a: `CombatActor.position` + `createActor` widening (set everywhere, read nowhere)

**Files:**
- Modify: `src/utils/combat/state.ts` (`CombatActor` ~93; `createActor` param ~116)
- Modify: `src/utils/combat/engine.ts` (the 3 `createActor` call sites)

- [ ] **Step 1:** Add `position?: Position;` to the `CombatActor` interface (state.ts ~93;
  add `import { Position } from '../../types/encounters'` there if absent).

- [ ] **Step 2:** Widen `createActor`'s param (state.ts ~116) — its accepted partial is
  `Pick<CombatActor,'id'|'side'|'kind'> & { stats; chargeCount?; startCharged? }`, which does
  NOT include `position`. Add `position?: Position;` to that inline type and assign it onto
  the returned actor (e.g. `position: partial.position` / spread).

- [ ] **Step 3:** Set `position` at the 3 construction sites:
  - attacker `createActor` (engine.ts ~961): `position: input.position` (the focus cell).
  - team-actor `createActor` (engine.ts ~1007 region): `position: <teamActorInput>.position`.
  - enemy-attacker `createActor` **inside `buildEnemyPlayerActorRuntime`** (engine.ts ~394):
    `position: e.position` (from `EnemyActorInput`). This is a DIFFERENT function from the
    top-level attacker/team setup — the enemy actor is built there, not in the main loop.

- [ ] **Step 4:** `npx tsc --noEmit` clean; `npm test` — full suite green, **goldens
  byte-identical** (`position` is set but read nowhere yet).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/state.ts src/utils/combat/engine.ts
git commit -m "feat(combat): CombatActor.position threaded through createActor (unused)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2b: `positionalBinding.ts` — the selectTargets↔actor glue (built, unused)

**Files:**
- Create: `src/utils/combat/positionalBinding.ts`
- Test: `src/utils/combat/positionalBinding.test.ts` (co-located; `src/utils/combat/` also has
  a `__tests__/` dir, but a small co-located unit test for a pure helper is fine — match
  whichever the implementer prefers; engine-integration tests go in `__tests__/`)

Extract the glue into its own module so `engine.ts` doesn't grow and the helpers are
unit-testable without importing the 3000-line engine.

- [ ] **Step 1: Write failing tests** with hand-built `CombatActor`-shaped objects (only the
  fields the helpers read: `id`, `position`, `currentHp`). Cases:

```ts
// caster M4, positioned enemies front M4 / back M1, target front -> selects the M4 actor
// same, target skip -> selects the M1 actor (2nd-from-front == back-most here)
// caster has no position -> isPositional() === false
// all opposing actors currentHp <= 0 -> resolvePositionalTarget() === null
// opposing roster has no positions -> isPositional() === false
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `positionalBinding.ts`:**

```ts
import { Position } from '../../types/encounters';
import { ParsedTarget } from '../targetingParser';
import { CombatActor } from './state';
import { selectTargets } from '../targeting/selectTargets';

/** Positional selection runs for an actor only when it has a position AND the opposing
 *  side has at least one positioned actor (the spec's exact predicate). */
export function isPositional(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some((a) => a.position !== undefined);
}

/** Map the selectTargets anchor back to a single living positioned opposing actor.
 *  null = no valid target (empty side / anchor null). Invariant: ≤1 living actor per cell. */
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[]
): CombatActor | null {
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) byCell.set(a.position, a);
    }
    const { anchor } = selectTargets(target, {
        casterPosition: actorPosition,
        enemyOccupied: [...byCell.keys()],
    });
    return anchor ? byCell.get(anchor) ?? null : null;
}
```

- [ ] **Step 4: Run** new test → PASS. Full suite → goldens byte-identical (nothing in the
  engine imports this module yet).

- [ ] **Step 5: Lint + types** clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/positionalBinding.ts src/utils/combat/positionalBinding.test.ts
git commit -m "feat(combat): positionalBinding glue (isPositional/resolvePositionalTarget, unused)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part C — Wire the gated positional branch into the binding sites

> Each task gates strictly on `isPositional(...)`. With no positions passed, every branch
> takes the existing path → goldens byte-identical. **Scoped OUT of Phase 2** (Phase 4):
> multi-enemy DoT/bomb ticking, per-target cumulative HP decline, per-target damage
> accounting. Phase-2 tests assert *selection* (which actor is bound / receives), not totals.

### Task C1: player attacker → selected enemy (focus turn, engine.ts ~2360)

**Files:**
- Modify: `src/utils/combat/engine.ts` (focus-turn `runPlayerTurn` call ~2360)
- Test: `src/utils/combat/__tests__/positionalSelection.test.ts`

Read the focus-turn `runPlayerTurn({...})` call (~2360) and how `enemy`, `targetId`,
`enemyDefense`, `enemyHpDecline`, and the DoT containers are passed. The dummy `enemy`
(created ~969) is the current binding.

- [ ] **Step 1: Write failing engine test.** **Required setup:** `enemyAttackerActors` is
  only populated when `enemyAttackers` is non-empty AND `healTargetId` is set — `engine.ts`
  ~1311 **throws** `enemyAttackers require healTargetId` otherwise (verified). So the test
  MUST set `healTargetId` to a player actor id; there is no DPS-mode-only path to a positioned
  enemy roster. Build: focus attacker positioned with `target: front`; `enemyAttackers` =
  ≥2 entries each given a `position` (e.g. front M4 / back M1) + low/zero attack so they're
  effectively pure targets; `healTargetId` = the focus (or a team) actor id. Tap the `bus`
  and assert the focus attacker's `ability-performed` event carries `targetId === <M4 enemy
  id>`. Add a second case: `target: back` → `targetId === <M1 enemy id>`.

- [ ] **Step 2: Run** → FAIL (still binds the dummy; targetId === 'enemy').

- [ ] **Step 3: Implement the gated branch** at the focus-turn call: compute
  `const selectedEnemy = isPositional(focusPosition, enemyAttackerActors) ? resolvePositionalTarget(focusPosition!, focusTarget!, enemyAttackerActors) : null;`
  then when `selectedEnemy`, swap the bare module vars the call currently passes (`enemy`,
  `enemyDefense`, `enemyHp`, `corrosionEntries`/`infernoEntries`/`pendingBombs`/
  `pendingAccumulators`, and `enemyHpDecline: cumulativeDamage + cumulativeTeamDamage`) for the
  selected actor's fields:
  - bind `enemy: selectedEnemy`, `targetId: selectedEnemy.id`,
  - pass `selectedEnemy`'s OWN DoT/bomb/accumulator containers
    (`selectedEnemy.corrosionEntries`, etc. — enemy attackers are real `CombatActor`s, so
    these exist),
  - `enemyDefense: selectedEnemy.stats.defence`,
  - `enemyHp: selectedEnemy.stats.hp` (the selected actor's **max** HP — NOT `currentHp`,
    which may have declined; and NOT the dummy's `enemyHp`),
  - `enemyHpDecline: 0` — explicitly override the cumulative expression; per-target decline
    is Phase 4 (gates read the target's entering HP — see spec).
  Otherwise the existing dummy binding, unchanged.
  - If `isPositional` but `selectedEnemy` is null (no living target), fall through to the
    legacy dummy binding (`tgt = selectedEnemy ?? enemy` → `enemy`); the action still
    resolves against the legacy target. A true no-op / death-fallback retarget is Phase 4.

- [ ] **Step 4: Run** the new test → PASS. **Run full suite → goldens byte-identical.** If a
  golden moved, the gate is leaking (a non-positional input entered the branch) — fix the
  gate; do NOT update the golden.

- [ ] **Step 5: Lint + types** clean. **Commit.**

```bash
git commit -am "feat(combat): positional target selection for player attacker (focus turn)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: team actors → selected enemy (team turn, engine.ts ~2450)

**Files:**
- Modify: `src/utils/combat/engine.ts` (team-turn `runPlayerTurn` call ~2450)
- Test: `positionalSelection.test.ts`

- [ ] **Step 1: Write failing test** — a positioned *team actor* (with its own `target`)
  selecting among the positioned enemy roster; assert its `ability-performed` `targetId` is
  the correctly-selected enemy (e.g. team actor in row B, `front` → enemy front-most in the
  scan from B).

- [ ] **Step 2: Run** → FAIL (binds dummy).

- [ ] **Step 3: Implement** the same gated branch at the team-turn call, using the team
  actor's `position` + `target` (carried on its `CombatActor` / `TeamActorEngineInput`).
  Reuse `resolvePositionalTarget` and the same field-swap as C1 (selected actor's
  defence/max-HP/containers, `enemyHpDecline: 0`). As in C1: `isPositional` but `selected`
  null → fall through to the legacy dummy binding (`?? enemy`); death-fallback is Phase 4.

- [ ] **Step 4: Run** new test → PASS; **full suite goldens byte-identical.**

- [ ] **Step 5: Lint + types clean. Commit.**

```bash
git commit -am "feat(combat): positional target selection for team actors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: enemy attackers → selected player actor (enemy turn, engine.ts ~2700) — side-symmetry

**Files:**
- Modify: `src/utils/combat/engine.ts` (enemy-attacker `runPlayerTurn` call ~2700;
  `applyIncomingToTarget` ~2814)
- Test: `positionalSelection.test.ts`

Read the enemy-attacker binding (~2700, `enemy: healTarget!`) and `applyIncomingToTarget`
(~2814) which applies the enemy's damage to the heal target.

- [ ] **Step 1: Write failing test** — positioned player team (focus + a team actor, each
  with `position`), a positioned enemy attacker with `target` = `front`, `healTargetId` set
  so the enemy walk runs. Assert the enemy's incoming routes to the *selected* player actor
  (the one `selectTargets` picks from the enemy's frame over the player team), not
  unconditionally to `healTargetId`. Observe via that actor's incoming/HP (the
  `applyIncomingToTarget` target).

- [ ] **Step 2: Run** → FAIL (always hits `healTarget`).

- [ ] **Step 3: Implement** the gated branch: the opposing side for an enemy attacker is the
  *player team* = `allPlayerActors`. When
  `isPositional(enemyActor.position, allPlayerActors)`, compute
  `selectedPlayer = resolvePositionalTarget(enemyActor.position!, enemyTarget!, allPlayerActors)`,
  and bind `enemy: selectedPlayer`, `targetId: selectedPlayer.id`, and route
  `applyIncomingToTarget` to `selectedPlayer` (generalize the helper from the hard-coded
  `healTarget`). Otherwise the existing `healTarget` binding.
  - `selectedPlayer` null → fall through to the legacy `healTarget` binding (`?? healTarget`);
    the enemy still attacks the legacy victim. Death-fallback retarget is Phase 4.

- [ ] **Step 4: Run** new test → PASS; **full suite goldens byte-identical** (no caller
  passes enemy positions).

- [ ] **Step 5: Lint + types clean. Commit.**

```bash
git commit -am "feat(combat): positional target selection for enemy attackers (side-symmetric)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: documentation + changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx` (only if a user-facing surface changed — it does
  NOT this phase; capability-only, no UI). **Likely skip.**
- Modify: `src/constants/changelog.ts` — **skip**: no user-visible behavior change this
  phase (no caller passes positions). Add a changelog entry only when the simulator (Phase 5)
  exposes it.

- [ ] **Step 1:** Confirm no user-facing behavior changed; record in the PR description that
  this is engine-capability-only with goldens byte-identical. No changelog/doc edit.

---

## Final verification (before requesting review / PR)

- [ ] `npm test` — full suite green; **all DPS/healing goldens byte-identical** (diff the
  golden files against `main` to be certain).
- [ ] `npm run lint` — 0 warnings.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Re-read the spec's success criteria and confirm each is met.
- [ ] `git diff main --stat` — only `src/utils/targeting/*`, `src/utils/combat/*` (+ the new
  test files) changed; no golden file content changed.
- [ ] Request code review (superpowers:requesting-code-review) before opening the PR.

## Notes for the executor

- **The fragile part is Part C.** The single safety property is: *no caller passes positions,
  so `isPositional` is always false in every existing test → the existing path runs → goldens
  byte-identical.* If any golden changes, STOP — the gate leaked; fix the predicate.
- Phase-2 tests assert **selection** (which actor is bound / which `targetId` is emitted /
  which player actor receives), never per-target damage totals (that accounting is Phase 4).
- `resolveCells` (the geometry footprint resolver) is intentionally **not** imported by the
  engine this phase.
- The `selectTargets`-to-actor glue lives in `src/utils/combat/positionalBinding.ts`
  (Task B2b) — keeps `engine.ts` from growing and makes the helpers unit-testable without
  importing the engine. `engine.ts` imports `{ isPositional, resolvePositionalTarget }` from it.
