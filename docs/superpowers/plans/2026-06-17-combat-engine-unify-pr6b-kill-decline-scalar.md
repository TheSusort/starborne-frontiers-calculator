# Combat Engine bySide Unification — PR6b: Kill the `enemyHpDecline` Scalar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sourcing the per-turn enemy-HP-decline gate-read from the running scalar `cumulativeDamage + cumulativeTeamDamage`. Collapse `declineFor` to one side-agnostic `max(0, victimMaxHpFor(tgt) − tgt.currentHp)`, then remove the `enemyHpDecline` parameter from `runPlayerTurn` and derive it internally from the `enemy` (tgt) actor's live `currentHp`.

**Architecture:** Full collapse, verify empirically (parent spec §4.1 fork, user-ratified 2026-06-17). Three player-side cases under the unified formula: enemy side is already exactly this; the player dummy-sink path is byte-identical by the post-round-sync proof; the player real-positional-target path (team-vs-team only, round 2+) changes from a forced-100% enemyHpPct to the real target's actual currentHp-based HP% — a latent improvement, unexercised in pure DPS. The empirical gate (zero `.snap` movement) decides: green ⇒ ship the full collapse; any movement ⇒ that IS the real-target divergence, fall back to preserving the player-side `selectedReal ? 0` guard and defer the refinement to PR7.

**Tech Stack:** TypeScript, Vitest (goldens), ESLint (`--max-warnings 0`), `audit:skills`.

**Golden expectation:** **BYTE-IDENTICAL.** Zero `.snap` movement. A golden diff is the audited risk surfacing — see Task 3's fallback, NEVER `vitest -u`.

**Baseline (PR6a tip `52121e6d` / code tip `3e7eefac`):** full suite green (record exact count in Task 1), dps/healing goldens byte-identical, `tsc`/`lint`/`audit:skills` 0/141 clean.

---

## Context the implementer needs

**Why this is byte-identical (the proof, recapped from the spec amendment).** The ONLY consumer of `enemyHpDecline` inside `runPlayerTurn` is one line (playerTurn.ts:720):

```ts
const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
```

It floors at 0. Three cases:

- **Enemy side** — already `declineFor: (tgt) => Math.max(0, recipientMaxHp(tgt.id) − tgt.currentHp)` (engine.ts:2481), and `victimMaxHpFor(tgt) = recipientMaxHp(tgt.id)` (engine.ts:2476). The unified formula is character-identical. No change.
- **Player dummy sink** (`selectedReal=false`, `tgt = enemy` dummy) — the post-round sink update sets `enemy.currentHp = Math.max(0, enemyHp − (cumulativeDamage + cumulativeTeamDamage))` (engine.ts:3771-3772). So `max(0, enemyHp − enemy.currentHp) = min(enemyHp, cumulative)`; the `cumulative > enemyHp` case floors `enemyHpPct` to the same 0% the raw scalar produced. Byte-identical. **The sink update at 3771-3772 STAYS** — it legitimately derives `currentHp`; it is not a gate read.
- **Player real positional target** (`selectedReal=true`, `tgt = real enemy actor`; only when `enemyAttackerActors` is non-empty, i.e. team-vs-team) — old code FORCES `enemyHpDecline = 0`. But `applyOutgoingToEnemy → applyVictimDamage` decrements `victim.currentHp` (engine.ts:2243), so from round 2 the unified formula is non-zero. This is the divergence the empirical gate detects. In pure DPS mode `enemyAttackerActors` is empty → `selectedReal` is always false → this case never fires.

**What survives.** `cumulativeDamage` / `cumulativeTeamDamage` are NOT deleted — they still feed the row/summary total (engine.ts:3826, 3938) and the post-round sink update (3771-3772). Only their use as a *decline gate-read source* dies.

**Sites touched:**
- `src/utils/combat/playerTurn.ts` — `PlayerTurnArgs.enemyHpDecline` field (~216), its destructure (~656), the one consumer (~720).
- `src/utils/combat/engine.ts` — `TurnBindings.declineFor` (interface ~2452 + player binding ~2464 + enemy binding ~2481), `buildTurnArgs` `enemyHpDecline` field (~2543) and its `selectedReal` param (~2525), `selectTurnTarget` `selectedReal` return (~2500/2516), the three call sites (~3025/3143/3384), and the dead-focus synth (~2601).
- 7 unit-test files that pass `enemyHpDecline: 0` directly to `runPlayerTurn`: `targetIdRouting`, `perHitCrit`, `selfHpGate`, `enemyBuffSelfDebuffGate` (FIRST fixture only — the `GRANT_BASE` engine-input is unrelated), `enemyActions` (×2), `positionalScalars`.

> **Line numbers are a 2026-06-17 snapshot.** Re-locate by symbol name; each step shifts offsets.

**`selectedReal` has exactly ONE consumer** — `declineFor` (verified: engine.ts greps show `selectedReal` only at the TurnBindings interface/binding, `selectTurnTarget` return, `buildTurnArgs` param, and the 3 call-site destructures). Once `declineFor` stops using it, it is fully removable.

**Test-fixture precondition (verified 2026-06-17).** `createActor` seeds `currentHp = stats.hp`. All 7 direct callers build their `enemy` fixture at full HP with `enemyHp` arg == `enemy.stats.hp` (e.g. targetIdRouting: both `10_000_000`). So the derived `max(0, enemyHp − enemy.currentHp) = 0`, matching the dropped `enemyHpDecline: 0`. **Each fixture MUST be re-confirmed full-HP in Task 4 before dropping its line** — a fixture with `currentHp < enemyHp` would change the derived value and is a real (not byte-identical) diff to handle explicitly.

**Commands:**
- Full suite: `npm test`
- Snapshot-movement check: `git diff --stat -- '*.snap'` (MUST be empty after every behavioral step)
- Targeted (faster inner loop): `npx vitest run src/utils/combat/__tests__/<file>`
- Gates: `npm run lint` · `npx tsc --noEmit` · `npm run audit:skills` (expect 0/141)

**Workflow:** Work on the main checkout, branch `feat/combat-sim-phase5-pr2`. `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. Pipe `git push … | cat`. Merge decision (local squash vs GitHub PR) is the USER's — this plan stops at ready-for-review.

---

## Task 1: Verify baseline + capture the byte-identity reference

**Files:** none (verification only).

- [ ] **Step 1: Confirm clean baseline**

Run: `git status` (clean), `git log --oneline -1` (expect `52121e6d` docs amendment or current tip).

- [ ] **Step 2: Run the full suite + gates to record the green baseline**

Run: `npm test` → record the exact passing count.
Run: `npm run lint` → 0 warnings. `npx tsc --noEmit` → clean. `npm run audit:skills` → 0 findings / 141 ships.

- [ ] **Step 3: Capture the three decline reference values**

Read engine.ts and confirm the current decline values verbatim into a scratch note (the byte-identity reference):
- player binding (~2464): `declineFor: (_tgt, selectedReal) => selectedReal ? 0 : cumulativeDamage + cumulativeTeamDamage`
- enemy binding (~2481): `declineFor: (tgt) => Math.max(0, recipientMaxHp(tgt.id) - tgt.currentHp)`
- dead-focus synth (~2601): `const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;`

No commit (verification task).

---

## Task 2: Flip the player decline source scalar → currentHp (keep the `selectedReal` guard) + dead-focus synth

**Files:** Modify `src/utils/combat/engine.ts`.

**What:** Kill the scalar *read* while keeping the `selectedReal ? 0` guard. This isolates the byte-identical dummy-sink rewrite (this task) from the empirical-risk guard removal (Task 3), so a `.snap` move bisects cleanly to the right cause. Byte-identical by the dummy-sink proof.

- [ ] **Step 1: Rewrite the player binding's `declineFor`**

In `playerTurnBindings` (~2464), change:

```ts
            declineFor: (_tgt, selectedReal) =>
                selectedReal ? 0 : cumulativeDamage + cumulativeTeamDamage,
```

to:

```ts
            // PR6b: scalar decline read killed — the dummy sink's currentHp already tracks
            // cumulativeDamage+cumulativeTeamDamage (post-round sink update, ~3771). The
            // selectedReal guard stays until Task 3 confirms the real-target collapse empirically.
            declineFor: (tgt, selectedReal) =>
                selectedReal ? 0 : Math.max(0, tgt.stats.hp - tgt.currentHp),
```

> When `selectedReal` is false the player `tgt` is the dummy `enemy`; `tgt.stats.hp === enemyHp` and `tgt.currentHp` is the sink-synced value → identical. (This mirrors `victimMaxHpFor: (tgt) => tgt.stats.hp` for the player binding.)

- [ ] **Step 2: Rewrite the dead-focus synth decline**

At the dead-focus synth (~2601), change:

```ts
                const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
```

to:

```ts
                // PR6b: read the dummy sink's live currentHp instead of the scalar (identical
                // value — the sink update at ~3771 keeps enemy.currentHp == enemyHp - cumulative).
                const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
```

> Here `enemy` is the round-loop dummy and `enemyHp` its max — both in scope at this site. Same dummy-sink proof.

- [ ] **Step 3: Suite + snapshot + gates**

Run: `npm test` → green, count unchanged. `git diff --stat -- '*.snap'` → **EMPTY**. `npx tsc --noEmit` → clean. `npm run lint` → 0.

> If `.snap` moves HERE, the dummy-sink equivalence is violated (unexpected) — bisect, do NOT proceed.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6b Task 2 — player decline reads dummy currentHp, not the scalar (guard kept)"
```

---

## Task 3: Drop the `selectedReal` guard — unify `declineFor`; remove `selectedReal` threading (EMPIRICAL GATE)

**Files:** Modify `src/utils/combat/engine.ts`.

**What:** Remove the player-side `selectedReal ? 0` guard so `declineFor` is one side-agnostic `(tgt) => max(0, victimMaxHpFor(tgt) − tgt.currentHp)`. This is the step that *may* change the player real-positional-target path. Then drop `selectedReal` everywhere (its only consumer is gone). **This task carries the audited risk — Step 4 is the empirical gate with a fallback.**

- [ ] **Step 1: Collapse the player binding's `declineFor` to use `victimMaxHpFor`**

In `playerTurnBindings`, change the Task-2 form to drop the guard and the now-unused `selectedReal`:

```ts
            declineFor: (tgt) => Math.max(0, tgt.stats.hp - tgt.currentHp),
```

> This is now identical in shape to the enemy binding (`Math.max(0, recipientMaxHp(tgt.id) - tgt.currentHp)`), differing only by the max-HP source — exactly the unification goal. Note in the commit body that the two bindings DELIBERATELY keep different max-HP sources (`tgt.stats.hp` for the player dummy vs `recipientMaxHp(tgt.id)` for the enemy's real player victim) — this mirrors the existing `victimMaxHpFor` split, it is NOT an oversight, and full convergence of that source is out of scope.

- [ ] **Step 2: Drop `selectedReal` from the `TurnBindings` interface + `buildTurnArgs`**

- `TurnBindings.declineFor` (~2452): `declineFor: (tgt: CombatActor, selectedReal: boolean) => number;` → `declineFor: (tgt: CombatActor) => number;`
- enemy binding `declineFor: (tgt) => …` is already arity-1 — leave it (update its protective comment to note PR6b unified both sides).
- `buildTurnArgs` (~2525): change the signature `(a: CombatActor, tgt: CombatActor, selectedReal: boolean)` → `(a: CombatActor, tgt: CombatActor)`, and the field (~2543) `enemyHpDecline: tb.declineFor(tgt, selectedReal),` → `enemyHpDecline: tb.declineFor(tgt),`.

- [ ] **Step 3: Drop `selectedReal` from `selectTurnTarget` and the three call sites**

- `selectTurnTarget` (~2500): change the return type to `{ tgt: CombatActor }` and the return (~2516) to `return { tgt: selected ?? tb.legacyVictim };` (drop `selectedReal: selected != null`).

  > Re-confirm `selected` is not read anywhere else in the function. If a later phase needs the "was a real target selected?" flag, it can re-derive `tgt !== tb.legacyVictim` — but nothing needs it now.

- The three call sites — change each pair:
  - focus (~3025): `const { tgt, selectedReal } = selectTurnTarget(actor);` → `const { tgt } = selectTurnTarget(actor);`; (~3026) `runPlayerTurn(buildTurnArgs(actor, tgt, selectedReal))` → `runPlayerTurn(buildTurnArgs(actor, tgt))`.
  - team (~3143/3144): same.
  - enemy (~3384/3416): same (the `enemyTurn` call stays inside the `else` of the `targetDead` guard).

- [ ] **Step 4: EMPIRICAL GATE — full suite + snapshot + gates**

Run: `npm test` → green, count unchanged. `git diff --stat -- '*.snap'` → **EMPTY**. `npx tsc --noEmit` → clean. `npm run lint` → 0 (fix any unused-var/unused-import from dropped `selectedReal`).

> **If everything is green:** the full collapse is byte-identical in practice — the real-target path is now correctly currentHp-driven (latent, unexercised). Proceed to Task 4.
>
> **If `.snap` moves OR a non-snap test fails on enemyHpPct/HP%-gated behavior:** that IS the player real-positional-target divergence (a `selectedReal=true`, round-2+ case is exercised). Do **NOT** `vitest -u`. **Fallback (option B, per spec amendment):**
> 1. `git checkout -- src/utils/combat/engine.ts` to revert THIS task's changes back to the Task-2 commit state (guard preserved, scalar read already killed).
> 2. Treat Task 2's commit as the terminal PR6b state: scalar-as-decline-source is dead, the `selectedReal ? 0` guard stays, the `enemyHpDecline` param stays (runPlayerTurn cannot know `selectedReal`), and **Task 4 is SKIPPED**.
> 3. Skip to Task 5's characterization-test + sweep, adjusting it to assert the option-B state (param retained), and record in the PR body that the real-target HP% refinement is deferred to PR7.
> Surface this outcome to the user before continuing — it changes the PR's shape.

- [ ] **Step 5: Commit (only if Step 4 was green)**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): PR6b Task 3 — unify declineFor to currentHp, drop selectedReal threading"
```

---

## Task 4: Remove `enemyHpDecline` from `PlayerTurnArgs`; derive it inside `runPlayerTurn`; delete `declineFor`

**Files:** Modify `src/utils/combat/playerTurn.ts`, `src/utils/combat/engine.ts`, and 7 test files.

**What:** The interface change. `runPlayerTurn` already receives `enemy` (the tgt actor) and `enemyHp` (its max) — derive the decline internally and drop the parameter. Then delete the now-dead `declineFor` binding + `buildTurnArgs` field, and update every direct test caller.

- [ ] **Step 1: Derive `enemyHpDecline` inside `runPlayerTurn`; remove the param**

In `playerTurn.ts`:
- Remove the `enemyHpDecline,` line from the args destructure (~656).
- Remove the `enemyHpDecline: number;` field + its doc comment from `PlayerTurnArgs` (~213-216).
- At the consumer (~718-720), add the derivation immediately before `enemyHpPct`:

```ts
    // Enemy HP% entering this round, derived from the struck victim's live HP decline (PR6b:
    // the engine no longer passes a precomputed scalar — `enemy` is the tgt actor, `enemyHp`
    // its max, so decline = how much HP the victim has lost). For the DPS dummy sink this equals
    // the old cumulativeDamage+cumulativeTeamDamage (the sink's currentHp tracks it post-round);
    // for a real positional victim it now reflects that victim's actual HP.
    // LOAD-BEARING TIMING: in DPS the dummy's currentHp updates POST-round (engine.ts ~3772),
    // not per-hit, so this derived value equals the entering-round scalar the old param carried.
    const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
    const enemyHpPct = enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
```

> `enemy` and `enemyHp` are both already destructured from `args` (~645/652) and available here. No other consumer of `enemyHpDecline` exists in playerTurn.ts (verified).

- [ ] **Step 2: Delete `declineFor` from `TurnBindings` + both bindings + `buildTurnArgs`**

In `engine.ts`:
- Remove `declineFor: (tgt: CombatActor) => number;` from the `TurnBindings` interface (~2452).
- Remove the `declineFor` property from `playerTurnBindings` and `enemyTurnBindings` (and the enemy binding's now-obsolete protective comment).
- Remove the `enemyHpDecline: tb.declineFor(tgt),` line from `buildTurnArgs` (~2543).
- Update the `TurnBindings` header comment (~2445-2446) to state PR6b is done: decline is now derived inside `runPlayerTurn` from the victim's currentHp; the credit/intake & emit tails remain per-kind (→ PR7).

- [ ] **Step 3: Update the 7 direct test callers**

For each file, **first confirm the `enemy` fixture is full-HP** (`enemy.stats.hp === enemyHp` arg, and no explicit lower `currentHp`), then delete its `enemyHpDecline: 0,` line:
- `src/utils/combat/__tests__/targetIdRouting.test.ts` (~147)
- `src/utils/combat/__tests__/perHitCrit.test.ts` (~341)
- `src/utils/combat/__tests__/selfHpGate.test.ts` (~127)
- `src/utils/combat/__tests__/enemyBuffSelfDebuffGate.test.ts` (~124 — the `makeArgs` fixture ONLY; the `GRANT_BASE` `CombatEngineInput` does not pass `enemyHpDecline` and is untouched)
- `src/utils/combat/__tests__/enemyActions.test.ts` (~361 and ~587)
- `src/utils/combat/__tests__/positionalScalars.test.ts` (~127)

> If any fixture is NOT full-HP, do not blindly delete: the derived decline becomes non-zero and the test's expectation may legitimately change. Stop and evaluate that one case explicitly (it would be a real behavior assertion, not a byte-identity drop).

- [ ] **Step 4: Full suite + snapshot + all gates**

Run: `npm test` → green, count unchanged. `git diff --stat -- '*.snap'` → **EMPTY**. `npx tsc --noEmit` → clean (the param removal must leave no dangling references). `npm run lint` → 0. `npm run audit:skills` → 0/141.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts src/utils/combat/__tests__/targetIdRouting.test.ts src/utils/combat/__tests__/perHitCrit.test.ts src/utils/combat/__tests__/selfHpGate.test.ts src/utils/combat/__tests__/enemyBuffSelfDebuffGate.test.ts src/utils/combat/__tests__/enemyActions.test.ts src/utils/combat/__tests__/positionalScalars.test.ts
git commit -m "refactor(combat): PR6b Task 4 — remove enemyHpDecline param, derive from victim currentHp"
```

---

## Task 5: Characterization test for the derived decline + final sweep

**Files:** Modify `src/utils/combat/__tests__/turnArgsUnification.test.ts` (the PR6a characterization test) or add a focused test beside it.

**What:** The goldens are the primary lock. Add ONE non-vacuous unit test that pins the interface change: `runPlayerTurn` derives `enemyHpPct` from the victim's `currentHp` (no `enemyHpDecline` param). Assert a damaged victim yields `enemyHpPct < 100`, and a full-HP victim yields `100` — proving the derivation is live and direction-correct (per the project's vacuous-isolation-test lesson, assert both a non-100 AND the 100 baseline so the test can actually fail).

- [ ] **Step 1: Write the test**

Build a minimal `runPlayerTurn` arg object (reuse the `makeArgs`/`createActor` pattern from `targetIdRouting.test.ts`) with NO `enemyHpDecline` field. Pick an EVEN `enemyHp` base (reuse `10_000_000`) so the half-HP case is exact-integer-safe (avoid float-equality surprises). Two cases on the same `enemyHp`:
- victim at full HP (`currentHp === enemyHp`) → assert the focus turn's `enemyHpPct === 100`.
- victim damaged (`currentHp = enemyHp / 2`, i.e. `5_000_000`) → assert `enemyHpPct === 50` (derived, not passed).

> If the existing `turnArgsUnification.test.ts` already covers the per-side bindings, append a `describe('PR6b — decline derived from victim currentHp')` block rather than a new file. Keep fixtures full-HP elsewhere so unrelated assertions stay byte-identical.

- [ ] **Step 2: Run the new test**

Run: `npx vitest run src/utils/combat/__tests__/turnArgsUnification.test.ts` → PASS.

- [ ] **Step 3: Full suite + all gates + snapshot**

Run: `npm test` → green (baseline + new test). `git diff --stat -- '*.snap'` → **EMPTY**. `npx tsc --noEmit` clean. `npm run lint` → 0. `npm run audit:skills` → 0/141.

- [ ] **Step 4: Changelog (skip — internal refactor)**

No user-visible change → no `UNRELEASED_CHANGES` entry (per CLAUDE.md: skip refactors). Confirm and move on.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/turnArgsUnification.test.ts
git commit -m "test(combat): PR6b — characterization for victim-currentHp-derived enemyHpPct"
```

---

## Done criteria

- `enemyHpDecline` is gone from `PlayerTurnArgs`; `runPlayerTurn` derives it from `enemy.currentHp` / `enemyHp`.
- `TurnBindings.declineFor` and the `selectedReal` threading (`selectTurnTarget` return, `buildTurnArgs` param, 3 call sites) are deleted.
- The scalar `cumulativeDamage` / `cumulativeTeamDamage` survive ONLY for the row/summary total and the post-round sink update (3771-3772) — not as a decline gate-read.
- Full suite green, **zero `.snap` movement**, `tsc`/`lint`/`audit:skills` 0/141 clean.
- Final holistic review (subagent-driven workflow) before handing to the user for the merge decision.
- *(Fallback path, only if Task 3 Step 4 surfaced the real-target divergence:* PR6b ships at the Task-2 state — scalar read killed, guard + param retained — and the real-target HP% refinement is deferred to PR7; PR body documents this.)*

## Risks & gotchas

- **The empirical gate is Task 3 Step 4.** Everything through Task 2 is byte-identical by the dummy-sink proof. Task 3 is the only step that can legitimately move a golden (the real-target path). Treat a Task-3 golden move as the documented fork outcome, not a leak to suppress — follow the fallback.
- **Never `vitest -u`.** A `.snap` move in Task 2, Task 4, or Task 5 is a genuine leak (those steps are byte-identical by construction) — bisect and fix the seam.
- **Test fixtures must be full-HP** before dropping `enemyHpDecline: 0` (Task 4 Step 3). A damaged fixture changes the derived value — a real diff, evaluate individually.
- **`enemyBuffSelfDebuffGate` has two fixtures** — only the direct-`runPlayerTurn` `makeArgs` one passes `enemyHpDecline`; the `GRANT_BASE` engine input does not. Do not touch `GRANT_BASE`.
- **Unused-symbol cleanup** after dropping `selectedReal` and the param — `--max-warnings 0` rejects leftovers (dangling destructures, unused locals/imports). `tsc` catches a missed param-removal reference.
- **Spec cross-ref:** parent §4.1 PR6b + the 2026-06-17 fork amendment. The dummy-sink proof and the real-target divergence are documented there; the credit/intake & emit tails remain → PR7.
