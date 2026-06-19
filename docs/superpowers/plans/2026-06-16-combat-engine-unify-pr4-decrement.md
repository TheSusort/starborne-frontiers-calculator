# Combat Engine bySide Unification — PR4: Unify Decrement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four-branch owner-Post-Turn decrement at `engine.ts` ~3680–3726 into one side-agnostic decrement that every actor runs, and close the audited Provoke gap (an enemy attacker never decrements debuffs a player landed on it).

**Architecture:** Today the Post-Turn decrement is a 4-way `if/else` keyed on `actor.kind`/identity: the DPS dummy decrements only the sentinel debuff store, the heal target decrements both its self store and its own debuff store, and every other actor decrements only its self store. The two `statusEngine` primitives are misnamed — `decrementPlayer(id)` decrements the **self-buff store** (`selfMaps[id]`) and `decrementEnemy(id)` decrements the **debuffs-landed-on store** (`enemyMaps[id]`); neither is player/enemy-specific. The unified rule: **every actor, on its Post Turn, decrements its own self store AND its own debuff store.** The dummy keeps the `'__enemy__'` sentinel key for its debuff store (the dummy/real duality is killed later in PR5); every real actor keys its debuff store by `actor.id`. Adding the debuff-store decrement to the enemy-attacker branch is the gap fix; it is a no-op for DPS/healing goldens (those stores are empty there) and only changes team-vs-team debuff lifecycle (audited).

**Tech Stack:** TypeScript, Vitest. Engine: `src/utils/combat/engine.ts`, `statusEngine.ts`. Goldens: `healingGoldenParity.test.ts` (healing) + the DPS golden parity suite.

**Spec:** `docs/superpowers/specs/2026-06-16-combat-engine-bySide-unification-design.md` (§3 item 5, §4 PR4 row, §7 PR4 risk). Campaign memory: `project-combat-engine-byside-unification`.

**Golden expectation (re-derived from spec §4 PR4 row + §5):** DPS + healing goldens **BYTE-IDENTICAL**. The only behavioral change — the enemy attacker now decrementing debuffs landed on it — is team-vs-team only and exercised by a NEW test, never by any golden fixture. A golden move = a refactor leak → fix the seam, never `vitest -u`.

---

## Background: characterization of the current 4 branches

Read `engine.ts` 3676–3726 and `statusEngine.ts` 803–834 before starting. Current behavior:

| Branch | Guard | Calls | Net stores touched |
|--------|-------|-------|--------------------|
| 1 — DPS dummy | `kind==='enemy' && id===enemy.id` | `decrementEnemy()` (sentinel `'__enemy__'`) | debuff store only |
| 2 — enemy attacker | `kind==='enemy'` (else) | `decrementPlayer(id)` | self store only — **debuff store on it NEVER decremented = the gap** |
| 3 — attacker / team | else | `decrementPlayer(id)` | self store only |
| 4 — heal-target sub-branch | inside else, `id===healTarget.id` | also `decrementEnemy(id)` | + its debuff store |

Key facts (verified in code; the byte-identical-relevant ones are re-confirmed by Task 1's locking tests, not assumed):
- The dummy enemy's `actor.id` is `'enemy'` but its debuffs live under `DEFAULT_ENEMY_TARGET = '__enemy__'` (the application path uses the sentinel; the dummy has no `shipSkills`, so `selfMaps['enemy']` is empty — never self-buffs).
- In DPS/single-target-healing mode, the only populated debuff store is the heal target's (`enemyMaps[healTarget.id]`) plus the dummy's sentinel store; `enemyMaps['attacker']` and `enemyMaps[teamId]` are empty (with no positions, enemies fall back to the heal target only).
- Emission order in the unified block must stay **self store first, debuff store second** (matches branch 4's current order) so `buff-expired` event ordering is byte-identical.

**Gap reachability (verified — drives the Task 2 test design):** the player-side firing sites (focus `engine.ts:2880`, team `engine.ts:3048`) do **NOT** thread `targetId` to `runPlayerTurn`, so a *player*→*enemy* debuff always lands in the sentinel store — meaning the **player→enemy-attacker** variant of the gap (`enemyMaps[enemyAttacker.id]`) has **no populating path today** and is fixed-but-latent (a future per-victim-accounting PR that threads player→enemy `targetId` lights it up). The **enemy** firing site (`engine.ts:3386`) DOES thread `targetId: tgt.id` where `tgt = selectedPlayer ?? healTarget`. So in **positional mode an enemy can land a finite timed debuff on a NON-heal-target player team actor**, populating `enemyMaps[teamActor.id]` — and branch 3 (`attacker`/`team`, the `else` that is not the heal-target sub-branch) **never decrements that store**. That is the SAME unification gap (an actor failing to decrement debuffs landed on it) on a **reachable** team-vs-team path, and is what Task 2 exercises. The unified block fixes both variants with one line (`decrementEnemy(actor.id)` for every non-dummy actor); the reachable team-actor sibling is the non-vacuous proof, the latent enemy-attacker variant is documented.

## File Structure

- **Modify:** `src/utils/combat/engine.ts` ~3676–3726 — replace the 4-branch `if/else` with one uniform block (Task 3).
- **Modify:** `src/utils/combat/statusEngine.ts` ~801–834 — JSDoc-only clarification that these are self-store / debuff-store accessors, not player/enemy-side (Task 3). No rename, no signature change (renaming touches ~13 call sites = churn orthogonal to this PR; out of scope).
- **Create:** `src/utils/combat/__tests__/decrementUnification.test.ts` — characterization locks (Task 1) + the gap-fix team-vs-team test (Task 2). Co-located with the other engine tests.

---

### Task 1: Lock the current per-branch decrement routing (characterization, all GREEN now)

These tests assert the existing routing + the two no-op invariants the unification relies on. They must pass against current `main`-tip code AND remain green after Task 3. This is the safety net the spec §7 risk note demands ("characterize before touching, lock with tests").

**Files:**
- Create: `src/utils/combat/__tests__/decrementUnification.test.ts`

- [ ] **Step 1: Write the characterization tests**

Use the engine `runCombat` entry (mirror the fixture style in `twoTeamBattle.test.ts` / `targetIdRouting.test.ts`). Capture `buff-expired` events via the result/event surface those tests use. Cover:

1. **DPS dummy debuff expiry** — a player active ability inflicts a finite-duration enemy debuff (e.g. `Def Down`, 1 turn) in DPS mode (no `targetId` → sentinel store). Assert the debuff's `buff-expired` fires on the dummy enemy's Post Turn, attributed to the dummy actor id, in the expected round.
2. **Dummy self store is empty (invariant)** — in the same DPS run, assert NO `buff-expired` event is ever attributed to the dummy via a self-buff (the dummy never self-buffs; `selfMaps['enemy']` empty). This is the invariant that makes adding `decrementPlayer('enemy')` in Task 3 a no-op.
3. **Heal-target self + debuff expiry** — in single-target healing mode, a self-buff on the heal target AND an enemy debuff landed on it both expire on the heal target's Post Turn, self store first.
4. **Team / focus debuff store empty in golden mode (invariant)** — in single-target healing mode **with no positions** (the golden shape), assert no `buff-expired` is attributed to the focus attacker or a non-heal-target team actor via the debuff store (only the heal target is debuffed). This makes adding `decrementEnemy(actor.id)` to those actors in Task 3 a no-op for the goldens. (In positional mode that store CAN be populated — that's exactly Task 2's reachable case, not a golden case.)

Prefer asserting observable `buff-expired` events over reaching into `statusEngine` internals; if an invariant (2/4) can only be observed via the absence of an event, assert the absence explicitly and comment why.

- [ ] **Step 2: Run — expect all PASS on current code**

Run: `npm test -- src/utils/combat/__tests__/decrementUnification.test.ts`
Expected: PASS (these lock current behavior).

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/decrementUnification.test.ts
git commit -m "test(combat): characterize 4-branch Post-Turn decrement routing (PR4 lock)"
```

---

### Task 2: Failing test for the decrement gap fix (RED)

Exercise the **reachable** variant of the gap: in positional mode, an enemy attacker lands a **finite-duration** timed debuff on a **non-heal-target player team actor**, populating `enemyMaps[teamActor.id]` (the enemy firing site threads `targetId: tgt.id` where `tgt = selectedPlayer ?? healTarget` — see "Gap reachability" above). On current code branch 3 (`attacker`/`team`) never calls `decrementEnemy(teamActor.id)`, so that debuff persists forever; after Task 3 it expires on the team actor's own Post Turn. (This is the same unification property the spec frames as the "enemy-attacker" gap; the player→enemy-attacker variant has no populating path today and is fixed-but-latent by the identical code — assert/document it, don't try to e2e it.)

**Files:**
- Modify: `src/utils/combat/__tests__/decrementUnification.test.ts`

- [ ] **Step 1: Write the failing gap-fix test**

Mirror the positional team-vs-team setup from `twoTeamBattle.test.ts` / `enemyReactiveRouting.test.ts` (board positions passed; `healTargetId` set so the engine doesn't throw):
- Player team = the heal target PLUS at least one other positioned team actor (the **non-heal-target** victim). Both walk their turns.
- An enemy attacker positioned so its positional target resolves to the non-heal-target team actor (`selectedPlayer` = that actor), with an ability that inflicts a **finite** timed enemy debuff (e.g. `Def Down`, duration 2). The enemy applies it via its `runPlayerTurn` walk → lands in `enemyMaps[teamActor.id]` (the `targetId: tgt.id` path; `targetIdRouting.test.ts` documents this keying).
- **The victim must SURVIVE its debuff duration** — give it high HP / low enemy attack (unlike `enemyReactiveRouting.test.ts`'s 1-HP one-shot victim). A dead actor takes no Post Turns, so the debuff would never get the chance to decrement and the test would be vacuously RED for the wrong reason.
- Assert: the debuff's `buff-expired` fires on the **non-heal-target team actor's** Post Turn after its duration (gap closed). Make the assertion **non-vacuous** — first confirm the debuff was actually applied to that team actor's store and present for at least one round (e.g. via a `debuff-applied`/snapshot observation on that id), so the test can't pass by the debuff never landing or landing in the sentinel. (Vacuous-isolation-test trap, spec §5 — #103/#114.)

If wiring an enemy *ability* that inflicts a finite debuff onto the positioned victim proves fiddly, the equivalent reachable setup is any enemy timed-debuff fixture from `enemyBuffSelfDebuffGate.test.ts` (which lands a `Provoke`/debuff on its target) reduced to a finite duration and aimed (via positions) at the non-heal-target actor — the keying is identical.

- [ ] **Step 2: Run — expect FAIL on current code**

Run: `npm test -- src/utils/combat/__tests__/decrementUnification.test.ts -t "<gap test name>"`
Expected: FAIL — the debuff persists past its duration (no `buff-expired` on the team actor), proving the gap. If it unexpectedly PASSES, the debuff isn't reaching `enemyMaps[teamActor.id]` (landing in the sentinel because positions/targetId didn't route, or the victim resolved to the heal target whose branch-4 already decrements) — fix the fixture before proceeding; a passing test here would be vacuous. Confirm the victim is genuinely a non-heal-target actor.

- [ ] **Step 3: Commit (RED test, marked)**

```bash
git add src/utils/combat/__tests__/decrementUnification.test.ts
git commit -m "test(combat): failing repro for enemy-attacker debuff-decrement gap (PR4)"
```

---

### Task 3: Unify the decrement (GREEN)

Replace the 4-branch block with one uniform decrement and close the gap.

**Files:**
- Modify: `src/utils/combat/engine.ts` ~3676–3726
- Modify: `src/utils/combat/statusEngine.ts` ~801–834 (JSDoc only)

- [ ] **Step 1: Rewrite the Post-Turn decrement block**

Replace the entire `if (actor.kind === 'enemy' && actor.id === enemy.id) { … } else if … else { … }` block (3680–3726) with:

```ts
// Post Turn (combat-system.md section 4): the status CARRIER decrements ALL its
// timed statuses by one turn — both its self-buff store and the debuff store of
// effects landed ON it. (Side-agnostic: PR4 unification of the former 4-branch
// player/enemy/heal-target split.) Empty stores are a safe no-op.
//
// The DPS dummy's debuffs live under the sentinel key, not its actor id — the
// dummy/real-actor duality is removed in PR5; until then every real actor keys
// its debuff store by actor.id and the dummy keeps the sentinel.
const isDummyEnemy = actor.kind === 'enemy' && actor.id === enemy.id;
for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
}
const debuffResult = isDummyEnemy
    ? statusEngine.decrementEnemy() // sentinel '__enemy__' store
    : statusEngine.decrementEnemy(actor.id); // debuffs landed on this actor — closes the
// decrement gap: every non-dummy actor now decrements its own debuff store. Reachable today
// for a non-heal-target team actor an enemy debuffs in positional mode (Task 2 test); the
// player→enemy-attacker variant is fixed by this same line but stays latent (no firing site
// threads a player→enemy targetId yet — a future per-victim-accounting PR lights it up).
for (const buffName of debuffResult.expired) {
    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
}
```

This preserves emission order (self store first, debuff store second — matching the old heal-target branch). For the dummy it adds `decrementPlayer('enemy')` (no-op, Task 1 invariant 2). For attacker/focus + non-heal-target team it adds `decrementEnemy(actor.id)` (no-op in the no-positions golden runs, Task 1 invariant 4; the behavioral change is the reachable positional team-vs-team case). The old heal-target sub-branch is now just the general case (it already did both).

Also delete the now-obsolete `POSITIONAL-PROVOKE DEFERRAL` comment block (3692–3702) — the deferral it describes is resolved by this unification; replace with the concise note above.

- [ ] **Step 2: JSDoc-clarify the two primitives in statusEngine.ts**

Update the doc comments on `decrementPlayer` (~801) and `decrementEnemy` (~818) to state they are the **self-buff store** and **debuffs-landed-on store** accessors respectively (side-agnostic; the `Player`/`Enemy` names are legacy). Do NOT rename — signatures and call sites unchanged.

- [ ] **Step 3: Run the gap-fix + characterization tests**

Run: `npm test -- src/utils/combat/__tests__/decrementUnification.test.ts`
Expected: PASS (gap-fix now green; all Task 1 locks still green).

- [ ] **Step 4: Run the goldens — expect BYTE-IDENTICAL**

Run: `npm test -- healingGoldenParity` and the DPS golden parity suite (`npm test -- golden` or the project's golden command).
Expected: PASS, ZERO `.snap` / golden movement. Verify no golden file appears in `git status`. If a golden moved, the seam leaked — STOP, do not `vitest -u`; diagnose which actor's new decrement call is non-empty in a golden run.

- [ ] **Step 5: Full suite + gates**

Run: `npm test` then `npm run lint` then `npx tsc --noEmit` then `npm run audit:skills` (expect 0/141).
Expected: all green, lint 0 warnings, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/statusEngine.ts
git commit -m "refactor(combat): unify owner Post-Turn decrement; close enemy-attacker debuff-decrement gap (PR4)"
```

---

### Task 4: Changelog + verification sweep

- [ ] **Step 1: No changelog entry needed** — this is an internal refactor + a team-vs-team-only lifecycle fix with no user-visible DPS/healing change. Confirm and skip (per `changelog.ts` guidance: skip minor refactors). If the simulator surfaces enemy-attacker debuff durations, add a one-line `fix:` note to `UNRELEASED_CHANGES`.

- [ ] **Step 2: Final diff audit**

Run: `git diff feat/combat-sim-phase5-pr2...HEAD --stat`
Confirm only the three files (engine.ts, statusEngine.ts, decrementUnification.test.ts) changed; no golden snapshot files.

- [ ] **Step 3: Hand off for holistic review** (subagent-driven flow: final holistic review before PR, per campaign workflow).

---

## Notes for the executor

- **Branch:** `feat/combat-engine-unify-pr4-decrement` (already created off the `feat/combat-sim-phase5-pr2` tip = PR3 merged). Stacks on the chain; retarget base→main when the chain merges.
- **Workflow:** `gh auth switch --hostname github.com --user TheSusort` before PR ops. docs gitignored → `git add -f`, `--no-verify` for docs-only commits. `git push … | cat` (progress output crashes the Bash wrapper). User merges PRs ("merge when green").
- **Do NOT** rename `decrementPlayer`/`decrementEnemy` — out of scope (churn). **Do NOT** wire `indestructible` death-path skip (PR5). **Do NOT** convert any heal-target-only accumulator (PR5). This PR is the decrement collapse only.
- **The load-bearing invariant:** DPS + healing goldens byte-identical. Every accepted diff explained in the PR body.
