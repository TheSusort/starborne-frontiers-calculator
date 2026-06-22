# Fortifying Shroud (D-PR11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the Fortifying Shroud implant — "Every turn, X% chance to grant all adjacent allies Defense Up 1 for 1 turn" — in the combat engine, by adding a reusable `start-of-turn` trigger and an `adjacent-allies` recipient scope.

**Architecture:** A new `start-of-turn` reactive trigger rides the already-emitted per-actor `turn-started` event (self-scoped, team-agnostic). A new `adjacent-allies` `AbilityTarget` is resolved at drain time via a new per-side `adjacentAllyIdsFor(ownerId)` delegate, computed from board positions by a pure `adjacency.ts` helper (positional → `neighbors(owner.pos)` ∩ living same-side allies; non-positional → all same-side allies). The implant is one registry entry using the existing `mkNamedBuffGrant` helper.

**Tech Stack:** TypeScript, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-22-implant-gearset-abilities-D-pr11-design.md`

**Worktree:** `.worktrees/d-pr11-fortifying-shroud` (branch `feat/combat-d-pr11-fortifying-shroud`, stacked on D-PR10 tip `3138f1fa`). All commands run from this worktree.

**Global invariants (do NOT violate):**
- DPS + healing goldens stay **byte-identical**. If a golden moves, a gate leaked — fix the gate, never `vitest -u` to mask it. (No fixture equips Fortifying Shroud, so churn = a real bug.)
- `npm run audit:skills` stays 141 ships / 0 findings.
- `npm run lint` (max-warnings 0) + `tsc` clean.
- Commit after every green task. Pre-commit hook runs the full suite; that's expected. Docs-only commits use `git add -f` (docs/ is gitignored) + `--no-verify`.

---

### Task 1: Pure adjacency helper

**Files:**
- Create: `src/utils/combat/adjacency.ts`
- Test: `src/utils/combat/__tests__/adjacency.test.ts`

The recipient math, extracted pure so it's unit-testable independent of the engine. `CombatActor` structurally satisfies the `{ id, position?, destroyedRound? }` param.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { adjacentAllyIds } from '../adjacency';
import type { Position } from '../../../types/encounters';

// Board adjacency (board.ts neighbors): M2 neighbors = T1,T2,M1,M3,B1,B2.
const a = (id: string, position?: Position, destroyedRound?: number) => ({
    id,
    position,
    destroyedRound,
});

describe('adjacentAllyIds', () => {
    it('positional: returns living same-side allies on neighbouring cells, owner excluded', () => {
        const actors = [
            a('owner', 'M2'),
            a('adjT2', 'T2'), // neighbour of M2
            a('adjM3', 'M3'), // neighbour of M2
            a('farB4', 'B4'), // not a neighbour
        ];
        expect(adjacentAllyIds('owner', actors).sort()).toEqual(['adjM3', 'adjT2']);
    });

    it('positional: excludes a destroyed adjacent ally', () => {
        const actors = [a('owner', 'M2'), a('deadT2', 'T2', 3), a('adjM3', 'M3')];
        expect(adjacentAllyIds('owner', actors)).toEqual(['adjM3']);
    });

    it('non-positional (owner has no position): falls back to all living same-side allies', () => {
        const actors = [a('owner'), a('ally1'), a('ally2'), a('dead', undefined, 2)];
        expect(adjacentAllyIds('owner', actors).sort()).toEqual(['ally1', 'ally2']);
    });

    it('positional but no other actor positioned: falls back to all living allies', () => {
        const actors = [a('owner', 'M2'), a('ally1')]; // ally1 unpositioned
        expect(adjacentAllyIds('owner', actors)).toEqual(['ally1']);
    });

    it('empty / owner-only roster → []', () => {
        expect(adjacentAllyIds('owner', [a('owner', 'M2')])).toEqual([]);
        expect(adjacentAllyIds('owner', [])).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/combat/__tests__/adjacency.test.ts`
Expected: FAIL — `adjacentAllyIds` not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { neighbors } from '../targeting/board';
import type { Position } from '../../types/encounters';

/** Minimal shape this helper needs from a combat actor. CombatActor satisfies it. */
interface AdjacencyActor {
    id: string;
    position?: Position;
    destroyedRound?: number;
}

/**
 * Resolve the recipient id list for an `adjacent-allies` grant.
 *
 * Positional (the owner AND at least one OTHER actor carry a board position):
 *   living same-side actors whose position is a hex-neighbour of the owner's, owner excluded.
 * Non-positional (no board positions wired — every current production path):
 *   all living same-side actors, owner excluded (the all-allies fallback, per spec §3.3).
 *
 * "Living" = `destroyedRound === undefined` (engine's canonical destroyed signal).
 */
export function adjacentAllyIds(ownerId: string, actors: AdjacencyActor[]): string[] {
    const living = actors.filter((x) => x.destroyedRound === undefined && x.id !== ownerId);
    const owner = actors.find((x) => x.id === ownerId);
    const anyOtherPositioned = actors.some((x) => x.id !== ownerId && x.position != null);
    if (owner?.position != null && anyOtherPositioned) {
        const nbrs = new Set<Position>(neighbors(owner.position));
        return living.filter((x) => x.position != null && nbrs.has(x.position)).map((x) => x.id);
    }
    return living.map((x) => x.id);
}
```

> Confirm the `Position` import path: `neighbors` lives in `src/utils/targeting/board.ts`; `Position` is exported from `src/types/encounters.ts` (used by board.ts). Adjust the import if board.ts re-exports it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/combat/__tests__/adjacency.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/adjacency.ts src/utils/combat/__tests__/adjacency.test.ts
git commit -m "feat(combat): D-PR11 — pure adjacentAllyIds helper"
```

---

### Task 2: `start-of-turn` trigger

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union ~line 38-68; LIVE_TRIGGERS set ~line 78)
- Modify: `src/utils/combat/triggers.ts` (listener registration switch, near `start-of-round` ~line 346)
- Test: `src/utils/combat/__tests__/triggers.test.ts` (or the nearest existing trigger-registration test file — search for a `start-of-round` registration test and co-locate)

- [ ] **Step 1: Write the failing test**

Add a test that registering a `start-of-turn` ability enqueues the intent **only** when `turn-started` fires with `actorId === ownerId`, not for another actor's turn. Mirror the existing `on-charged-cast` / `start-of-round` registration tests in that file (find one and copy its harness — it builds a bus, registers listeners for an owner, emits events, asserts the queue). Example shape:

```ts
it('start-of-turn enqueues on the owner\'s own turn-started, not another actor\'s', () => {
    // …existing harness: register a start-of-turn buff ability for owner 'A'…
    bus.emit({ type: 'turn-started', actorId: 'B', round: 1 });
    expect(queue.length).toBe(0);
    bus.emit({ type: 'turn-started', actorId: 'A', round: 1 });
    expect(queue.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/combat/__tests__/triggers.test.ts -t "start-of-turn"`
Expected: FAIL — `'start-of-turn'` not assignable to `AbilityTrigger` (tsc) / no enqueue.

- [ ] **Step 3: Implement**

In `src/types/abilities.ts`, add `'start-of-turn'` to the `AbilityTrigger` union (place it next to `'start-of-round'` with a comment) AND to the `LIVE_TRIGGERS` set:

```ts
    | 'start-of-round'
    | 'start-of-turn' // Fortifying Shroud: fires at the OWNER's own turn-start (rides
                      // the per-actor turn-started event; self-scoped on actorId === ownerId)
```

```ts
// in LIVE_TRIGGERS:
    'start-of-round',
    'start-of-turn',
```

In `src/utils/combat/triggers.ts`, add a case beside `start-of-round` (~line 346):

```ts
                case 'start-of-turn':
                    bus.on('turn-started', (e) => {
                        // Self-scoped: THIS owner's own turn began. turn-started fires once per
                        // actor (both sides run the same turn path), so the ownerId guard scopes
                        // it per registered owner — team-agnostic, like on-charged-cast.
                        if (e.actorId === ownerId) enqueue(intent);
                    });
                    break;
```

> The `turn-started` event payload is `{ type: 'turn-started'; actorId: string; round: number }` (events.ts:36). No new event needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/combat/__tests__/triggers.test.ts -t "start-of-turn"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): D-PR11 — start-of-turn trigger (rides turn-started, self-scoped)"
```

---

### Task 3: `adjacent-allies` target + buff-branch recipient resolution

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTarget union ~line 29)
- Modify: `src/utils/combat/triggers.ts` (IntentExecContext interface ~line 607 region; buff-branch recipients ~line 1069)
- Test: the executor test file covering the buff branch (search for a test exercising `cfg.type === 'buff'` recipient resolution / `reactiveRecipients` siblings; co-locate there)

- [ ] **Step 1: Write the failing test**

Test the buff-branch recipient resolution: an intent whose `ability.target === 'adjacent-allies'` resolves recipients via `ctx.adjacentAllyIdsFor(ownerId)`, and falls back to `ctx.playerIds` when the delegate is absent. Drive `executeIntent` with a stub ctx whose `adjacentAllyIdsFor` returns a fixed set, assert the Defense Up status lands on exactly those ids. Mirror an existing D-PR8/D-PR9 buff-grant executor test (e.g. the Spearhead/Ambush tests) for the harness.

```ts
it('adjacent-allies buff grants to ctx.adjacentAllyIdsFor result', () => {
    // stub ctx.adjacentAllyIdsFor = () => ['ally1', 'ally2']
    // intent: buff Defense Up I, target 'adjacent-allies', start-of-turn
    // executeIntent(intent, ctx)
    // assert applyTimedAbilityStatus called for ally1 and ally2 only (not owner, not ally3)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- <that test file> -t "adjacent-allies"`
Expected: FAIL — `'adjacent-allies'` not assignable to `AbilityTarget` (tsc) / recipients empty.

- [ ] **Step 3: Implement**

In `src/types/abilities.ts`, add to `AbilityTarget` (~line 29):

```ts
export type AbilityTarget =
    | 'self'
    | 'ally'
    | 'all-allies'
    | 'adjacent-allies' // Fortifying Shroud: living same-side allies on neighbouring board
                        // cells (non-positional → all same-side allies). Resolved via
                        // IntentExecContext.adjacentAllyIdsFor.
    | 'enemy'
    | 'all-enemies'
    | 'enemy-most-buffs';
```

In `src/utils/combat/triggers.ts`, add the delegate to `IntentExecContext` (beside `isLowestSpeedAllyFor` ~line 607):

```ts
    /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded), feeding the
     *  `adjacent-allies` buff target. Engine-populated per side. Absent / undefined → the
     *  recipient resolver falls back to ctx.playerIds (all same-side allies). */
    adjacentAllyIdsFor?: (ownerId: string) => string[];
```

In the buff branch recipient ternary (~line 1069), prepend the `adjacent-allies` branch:

```ts
        const recipients: string[] =
            intent.ability.target === 'adjacent-allies'
                ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ?? ctx.playerIds)
                : intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
                  ? intent.eventCtx.repairedAllyIds
                  : intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
                    ? [intent.eventCtx.damagedAllyId]
                    : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
                      ? ctx.playerIds
                      : [intent.ownerId];
```

> Only the buff branch needs this (Fortifying Shroud is a buff). Do NOT touch `reactiveRecipients` (heal/cleanse/purge) — no adjacent-allies heal exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- <that test file> -t "adjacent-allies"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts <test file>
git commit -m "feat(combat): D-PR11 — adjacent-allies buff target + recipient resolution"
```

---

### Task 4: Engine `adjacentAllyIdsFor` per-side wiring

**Files:**
- Modify: `src/utils/combat/engine.ts`
  - `SideContext` interface (~line 1735)
  - `buildSideContext` closure (~line 1749)
  - `ReactiveSideCtx` interface (~line 1024)
  - `drainQueue` ctx literal (~line 3376, beside `isLowestSpeedAllyFor: sideCtx.isLowestSpeedAllyFor`)
  - `drainIntents` sideCtx literal (~line 3401)
  - `drainEnemyIntents` sideCtx literal (~line 3422)
  - import `adjacentAllyIds` from `./adjacency`

This is plumbing of an already-tested pure helper; covered end-to-end by Task 6's integration test (no separate unit test — the closure is a one-liner over `adjacentAllyIds`).

- [ ] **Step 1: Implement**

Add the import near the other combat-util imports:

```ts
import { adjacentAllyIds } from './adjacency';
```

`SideContext` interface (~1735) — add a field:

```ts
        /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded). Positional
         *  → board neighbours; non-positional (no positions wired) → all living same-side allies. */
        adjacentAllyIdsFor: (ownerId: string) => string[];
```

`buildSideContext` return object (~1751, beside `lowestSpeedIds`):

```ts
            adjacentAllyIdsFor: (ownerId: string): string[] => adjacentAllyIds(ownerId, actors),
```

`ReactiveSideCtx` interface (~1024) — add:

```ts
    /** Per-side adjacent-allies resolver (Fortifying Shroud). See IntentExecContext. */
    adjacentAllyIdsFor: (ownerId: string) => string[];
```

`drainQueue` ctx literal (~3376, after `wasHitThisRoundFor`):

```ts
                        // D-PR11: live adjacent-allies resolver (Fortifying Shroud). Sourced
                        // per-side from sideCtx; positional neighbours, else all same-side allies.
                        adjacentAllyIdsFor: sideCtx.adjacentAllyIdsFor,
```

`drainIntents` literal (~3401):

```ts
                adjacentAllyIdsFor: bySide('player').adjacentAllyIdsFor,
```

`drainEnemyIntents` literal (~3422):

```ts
                adjacentAllyIdsFor: bySide('enemy').adjacentAllyIdsFor,
```

- [ ] **Step 2: Verify tsc + existing engine tests pass**

Run: `npx tsc --noEmit` → clean.
Run: `npm test -- src/utils/combat/__tests__/` → all green (no behavioural change yet; delegate unused until an ability targets `adjacent-allies`).

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): D-PR11 — wire per-side adjacentAllyIdsFor delegate into the drain ctx"
```

---

### Task 5: Fortifying Shroud registry entry + coverage

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (proc-chance constant; `mkNamedBuffGrant` target type ~line 319; `IMPLANT_ABILITIES.FORTIFYING_SHROUD`)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (the `implementedImplants` `.toEqual` array AND the `Set`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (or the existing equipment-abilities registry test file)

- [ ] **Step 1: Write the failing test**

```ts
it('emits Fortifying Shroud as an adjacent-allies start-of-turn Defense Up I buff', () => {
    // ship with a legendary Fortifying Shroud implant equipped (getGearPiece returns
    // { setBonus: 'Fortifying Shroud', rarity: 'legendary', … })
    const abilities = buildEquipmentAbilities(ship, getGearPiece);
    const a = abilities.find((x) => x.id.startsWith('equip-implant-FORTIFYING_SHROUD'));
    expect(a).toBeDefined();
    expect(a!.type).toBe('buff');
    expect(a!.target).toBe('adjacent-allies');
    expect(a!.trigger).toBe('start-of-turn');
    expect(a!.procChance).toBeCloseTo(0.32);
    expect(a!.config).toMatchObject({ type: 'buff', buffName: 'Defense Up I', duration: 1 });
});
```

(Mirror the exact ship/getGearPiece fixture shape from an existing implant test in that file — e.g. the Bloodthirst or Ambush test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- <registry test file> -t "Fortifying Shroud"`
Expected: FAIL — no FORTIFYING_SHROUD entry.

- [ ] **Step 3: Implement**

Widen `mkNamedBuffGrant`'s `target` param (~line 319):

```ts
    target: 'self' | 'ally' | 'all-allies' | 'adjacent-allies',
```

Add the proc-chance constant beside the other implant tables (match the existing per-rarity `Record<string, number>` style, e.g. `BLOODTHIRST_PROC_CHANCE`):

```ts
const FORTIFYING_SHROUD_PROC_CHANCE: Record<string, number> = {
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};
```

Add the registry entry to `IMPLANT_ABILITIES`:

```ts
    // Fortifying Shroud: at the start of its own turn, a proc chance to grant all adjacent
    // allies Defense Up I for 1 turn. The adjacent-allies target resolves to board neighbours
    // in the simulator and to all same-side allies in non-positional modes.
    FORTIFYING_SHROUD: (rarity) => {
        const procChance = FORTIFYING_SHROUD_PROC_CHANCE[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Defense Up I', 'adjacent-allies', 'start-of-turn', 1, {
            procChance,
        });
    },
```

Coverage test (`equipmentCoverage.test.ts`) — add `'FORTIFYING_SHROUD'` to BOTH:
- the `implementedImplants` `.toEqual([...])` array, in `IMPLANTS` **declaration order** (check where `FORTIFYING_SHROUD` sits in `implants.ts` relative to the others already listed), AND
- the `implementedImplants` `new Set([...])`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- <registry test file> -t "Fortifying Shroud"` → PASS.
Run: `npm test -- src/utils/abilities/__tests__/equipmentCoverage.test.ts` → PASS.
Run: `npm run audit:skills` → 141 ships, 0 findings.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts <registry test file>
git commit -m "feat(combat): D-PR11 — Fortifying Shroud implant registry entry + coverage"
```

---

### Task 6: Editor exhaustiveness stubs

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (`TARGET_OPTIONS` ~line 64; `TRIGGER_OPTIONS` ~line 126)

UI completeness only — no combat behaviour. The new union members may already force `tsc` errors at exhaustive sites; run `tsc` first to find them all.

- [ ] **Step 1: Find every exhaustive site**

Run: `npx tsc --noEmit`
Expected: errors at any `Record<AbilityTarget, …>` / `Record<AbilityTrigger, …>` or exhaustive `switch`. Fix each.

- [ ] **Step 2: Add the picker options**

`TARGET_OPTIONS` (~line 64):

```ts
    { value: 'adjacent-allies', label: 'Adjacent allies' },
```

`TRIGGER_OPTIONS` (~line 126):

```ts
    { value: 'start-of-turn', label: 'Start of own turn' },
```

Add any other stub entries `tsc` demanded.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npm run lint` → 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/components/skills/AbilityCard.tsx <any other tsc-forced files>
git commit -m "feat(combat): D-PR11 — editor stubs for start-of-turn / adjacent-allies"
```

---

### Task 7: Engine integration test (positional + enemy mirror) + golden gate

**Files:**
- Test: a new or existing combat integration test file (e.g. `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` — the file D-PR2/D-PR4 used for fold/engine smoke tests)

- [ ] **Step 1: Write the positional integration test**

Use the positional board harness used by D-PR3/D-PR4 (search for `perVictimLeech`-style board fixtures / tests that set `position` on actors and pass them into `simulateBattle` / `runCombat`). Build a player team where the owner carries Fortifying Shroud and sits at a cell with 2 adjacent + 1 non-adjacent living ally; force the proc gate (legendary, or seed the accumulator so it crosses 1). Assert after the owner's turn:
- the 2 adjacent allies carry a `Defense Up I` status;
- the non-adjacent ally does NOT;
- the owner does NOT (excluded from its own grant).

- [ ] **Step 2: Write the enemy-side mirror test**

Same board on the enemy side (an enemy carries Fortifying Shroud). Assert its enemy-side adjacent allies get Defense Up — proving team-agnosticism with zero production change.

- [ ] **Step 3: Run the new tests**

Run: `npm test -- <integration file> -t "Fortifying Shroud"`
Expected: PASS.

- [ ] **Step 4: Golden gate — prove byte-identical**

Run the full suite:
Run: `npm test`
Expected: ALL green, and crucially the DPS + healing golden/`.snap` files show **no diff** (`git status` clean for snapshot files). If any golden moved → STOP, a gate leaked; the adjacent-allies fallback must not fire in goldens because no fixture equips the implant. Investigate before continuing.

- [ ] **Step 5: Commit**

```bash
git add <integration file>
git commit -m "test(combat): D-PR11 — Fortifying Shroud positional + enemy-mirror integration"
```

---

### Task 8: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (only if it enumerates modelled implant/combat effects — check first)

- [ ] **Step 1: Add changelog entry**

Add a plain-English `UNRELEASED_CHANGES` line, e.g.: "Combat simulator now models the Fortifying Shroud implant — a chance each turn to grant adjacent allies a Defense Up buff."

- [ ] **Step 2: Docs (conditional)**

If `DocumentationPage.tsx` lists supported implant/gear-set abilities, add Fortifying Shroud. If not, skip.

- [ ] **Step 3: Verify + commit**

Run: `npm run lint && npx tsc --noEmit` → clean.

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR11 — changelog + docs for Fortifying Shroud"
```

---

### Final verification

- [ ] `npm test` → all green, goldens byte-identical (`git status` shows no snapshot diffs).
- [ ] `npm run lint` → 0 warnings.
- [ ] `npx tsc --noEmit` → clean.
- [ ] `npm run audit:skills` → 141 ships / 0 findings.
- [ ] Final holistic review (opus): confirm no third recipient-resolution path bypasses the new branch; confirm the `start-of-turn` intent is actually drained within the same turn (the per-turn drain following `turn-started`); confirm enemy mirror is genuinely zero-prod-change.
- [ ] Open PR stacked on D-PR10 (#138); retarget base to main as the lower stack merges.
