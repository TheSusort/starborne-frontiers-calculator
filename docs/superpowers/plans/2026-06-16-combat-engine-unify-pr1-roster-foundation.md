# Combat Engine bySide Unification — PR1: Roster Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the canonical unified-roster seam (`allActors`) and the inert `indestructible` actor flag that the rest of the bySide unification campaign leans on — with zero behavior change.

**Architecture:** The `side` field, `currentHp`, `destroyedRound`, and `recordDestroyed` already exist on `CombatActor`. This PR adds one inert flag (`indestructible`, read by nobody until PR5 — documented seam plumbing exactly like the existing inert `position` / `affinity` / `ignoresForcedTargeting` interface fields, `state.ts:116-124`) and names the single canonical roster `allActors`, then routes the one de-facto roster (`roundActors`) through it. The DPS dummy enemy is flagged `indestructible`. The companion accessors `allActorsById` and `actorsBySide` are deliberately NOT introduced here — they have no consumer until PR2 (`grantExtraAction` from a combined map) and PR3 (side-parameterized helpers), so they land there alongside their first reader. Introducing them now would be unread local `const`s that fail lint at `--max-warnings 0`; YAGNI says defer.

**Tech Stack:** TypeScript, Vitest. Engine internals in `src/utils/combat/engine.ts`; actor model in `src/utils/combat/state.ts`.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` (PR1 row of §4).

**Safety gate:** BYTE-IDENTICAL. The 23 DPS + healing goldens must not move. Any golden diff = a leak (roster membership/order drifted) → fix the seam, never `vitest -u`. This is the trivially-byte-identical foundation PR.

**Branch:** `feat/combat-engine-unify-pr1` off the current `feat/combat-sim-phase5-pr2` tip (work in the main checkout; do not create a fresh worktree — esbuild crash).

---

## File structure

- **Modify** `src/utils/combat/state.ts` — add `indestructible?: boolean` to the `CombatActor` interface and thread it through `createActor`.
- **Modify** `src/utils/combat/engine.ts` — flag the dummy `enemy` indestructible; add `allActors` after the enemy-attacker actors are built; route `roundActors` through `allActors`.
- **Modify** `src/utils/combat/__tests__/state.test.ts` — lock `createActor`'s `indestructible` passthrough (the only externally observable surface in this PR).

No new files. No production caller change. No changelog entry (internal refactor, not user-facing — per CLAUDE.md changelog rule).

---

## Task 1: Add the `indestructible` flag to the actor model

**Files:**
- Modify: `src/utils/combat/state.ts` (interface `CombatActor` ~95-125; `createActor` ~127-155)
- Test: `src/utils/combat/__tests__/state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `state.test.ts` (place beside the other `createActor` tests):

```typescript
describe('createActor indestructible flag', () => {
    const baseStats = {
        attack: 0, crit: 0, critDamage: 0, defensePenetration: 0,
        defence: 0, hp: 100, speed: 50,
    };

    it('defaults indestructible to undefined when not provided', () => {
        const a = createActor({ id: 'x', side: 'player', kind: 'attacker', stats: baseStats });
        expect(a.indestructible).toBeUndefined();
    });

    it('passes indestructible through when provided', () => {
        const a = createActor({
            id: 'dummy', side: 'enemy', kind: 'enemy', stats: baseStats, indestructible: true,
        });
        expect(a.indestructible).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/state.test.ts -t indestructible`
Expected: FAIL — `indestructible` is not assignable in the `createActor` partial type (tsc/compile error or `undefined`/missing at runtime).

- [ ] **Step 3: Add the field to the interface and `createActor`**

In `state.ts`, add to the `CombatActor` interface (right after `destroyedRound?` ~line 115):

```typescript
    /** True for the DPS dummy sink: drains currentHp like any actor but the death /
     *  combat-end path skips it (never recordDestroyed, never ends combat). Inert
     *  plumbing in PR1 — first read by the death path in PR5 (bySide unification). */
    indestructible?: boolean;
```

Add `indestructible?: boolean;` to the `createActor` partial type (alongside `affinity?: AffinityName;`):

```typescript
        affinity?: AffinityName;
        indestructible?: boolean;
```

Add to the returned object in `createActor` (alongside `affinity: partial.affinity,`):

```typescript
        affinity: partial.affinity,
        indestructible: partial.indestructible,
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/state.test.ts -t indestructible`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/state.ts src/utils/combat/__tests__/state.test.ts
git commit -m "feat(combat): add inert indestructible flag to CombatActor (bySide PR1 task 1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Flag the dummy + introduce the unified roster accessors

**Files:**
- Modify: `src/utils/combat/engine.ts` — dummy construction (~1121), `allActors` introduction (after `enemyPlayerRuntimeByActorId`, ~1586), `roundActors` (~2011, inside the round loop)

This task has no isolated unit test (the accessors are `runCombat` locals, not exported). Its correctness proof is the byte-identical golden suite in Task 3: if `roundActors` membership or order changed, turn-order-dependent goldens move. Make the edits, then Task 3 verifies.

- [ ] **Step 1: Flag the dummy enemy indestructible**

In `engine.ts`, the dummy `enemy = createActor({ id: 'enemy', side: 'enemy', kind: 'enemy', ... })` (~1121). Add `indestructible: true` to that call:

```typescript
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        indestructible: true,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: enemySpeed ?? 50,
        },
    });
```

This is the ONLY actor flagged indestructible. The flag is unread in PR1 — no behavior change.

- [ ] **Step 2: Add the canonical `allActors` roster**

Immediately AFTER `enemyPlayerRuntimeByActorId` is defined (~1586, before the `grantEnemyAllyCharges` comment block), add:

```typescript
    // ── Unified roster seam (bySide unification PR1) ───────────────────────────
    // The canonical, side-agnostic actor set, named once. Order MATTERS: it is the
    // turn-order seed consumed by `roundActors` below — [team…, attacker, dummy
    // enemy, enemy attackers…], identical to the array `roundActors` used inline
    // before PR1. The companion accessors allActorsById / actorsBySide arrive in
    // PR2/PR3 with their first consumers (deferred — unread now = YAGNI/lint).
    const allActors: CombatActor[] = [
        ...teamCombatActors,
        attacker,
        enemy,
        ...enemyAttackerActors,
    ];
```

(`CombatActor` is already imported in engine.ts. `allActors` is read by `roundActors` in Step 3, so it is NOT an unused binding — no lint issue.)

- [ ] **Step 3: Route `roundActors` through `allActors`**

Inside the round loop, replace the inline array (~2011):

```typescript
        const roundActors = [...teamCombatActors, attacker, enemy, ...enemyAttackerActors];
```

with:

```typescript
        const roundActors = allActors;
```

Membership and order are identical (Step 2 defined `allActors` with the exact same expression), and the four source arrays are fixed before the round loop — so this is loop-invariant and byte-identical. Leave the surrounding comment about turn-order/dead-actor handling intact.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): name the canonical allActors roster + indestructible dummy (bySide PR1 task 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verify byte-identical + clean

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: ALL green (same count as before PR1 + the 2 new `state.test.ts` cases).

- [ ] **Step 2: Goldens byte-identical — the load-bearing check**

Run: `git status --porcelain '*.snap'` and `git diff --stat`
Expected: NO `.snap` file appears as modified. The only changed files are `state.ts`, `engine.ts`, `state.test.ts`.
If any golden moved: STOP. The roster membership/order leaked — re-check Step 2/3 of Task 2 against the original inline array. NEVER run `vitest -u`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 warnings/errors (max-warnings: 0). `allActors` is read by `roundActors`, so no unused-binding warning is expected.

- [ ] **Step 4: Skill audit (sanity — should be untouched)**

Run: `npm run audit:skills` (or the project's audit script)
Expected: 0 findings / 141 ships (unchanged — no parser/ability change in this PR).

- [ ] **Step 5: Push and open the PR**

```bash
gh auth switch --hostname github.com --user TheSusort
git push --no-verify origin feat/combat-engine-unify-pr1 | cat
gh pr create --base feat/combat-sim-phase5-pr2 \
  --title "feat(combat): bySide unification PR1 — roster foundation" \
  --body "$(cat <<'EOF'
First slice of the team-agnostic bySide engine unification (spec: docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md, §4 PR1).

## What
- Adds inert `indestructible` flag to `CombatActor` (read by nobody until PR5; flags the DPS dummy sink).
- Names the single canonical unified roster `allActors`.
- Routes the existing `roundActors` through `allActors` (byte-identical — same membership and order).

## Safety
- BYTE-IDENTICAL: goldens unchanged (verified `git diff` shows no `.snap` movement).
- `indestructible` is inert plumbing in PR1, like the existing position/affinity "set at construction, not yet consumed" fields; first read by the death path in PR5.
- Companion accessors `allActorsById` / `actorsBySide` are deferred to PR2/PR3 where they get their first consumers (avoids unread `const`s failing `--max-warnings 0`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

NOTE: PR base is the stacked branch `feat/combat-sim-phase5-pr2` (per the spec's "branch off sim-pr2 now" decision). CodeRabbit only auto-reviews base=main PRs — retarget to main and rebase `--onto` once #117 merges. Poll `mergeState=CLEAN`; npm-audit RED is the pre-existing vite advisory (non-blocker).

---

## Definition of done

- [ ] `indestructible?: boolean` on `CombatActor`, threaded through `createActor`, set `true` on the dummy only.
- [ ] `allActors` defined once in `runCombat`; `roundActors = allActors`. (`allActorsById`/`actorsBySide` deferred to PR2/PR3.)
- [ ] `npm test` green; 2 new `state.test.ts` cases pass.
- [ ] Goldens BYTE-IDENTICAL (no `.snap` in the diff).
- [ ] `npm run lint` clean; `npx tsc --noEmit` clean; `audit:skills` 0 findings.
- [ ] PR opened against `feat/combat-sim-phase5-pr2`.
