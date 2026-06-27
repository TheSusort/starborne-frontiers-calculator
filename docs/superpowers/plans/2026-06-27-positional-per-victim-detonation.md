# Positional Per-Victim Detonation Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make skill-triggered and timed bomb/DoT detonation land per footprint victim on the positional path — each victim detonates its own stored containers against its own `currentHp` (so detonation can kill positioned victims and fire per-victim death/reactives) — symmetric across sides.

**Architecture:** Route each victim's detonation payout through the existing per-victim sink `applyVictimDamage` (the same sink the per-victim direct hit and bomb-splash-on-death #161 use). Extract `detonate()`'s per-type payout math into a pure per-victim helper, expose the detonation "recipe" from `runPlayerTurn`, and invoke it per footprint victim at the positional apply site — suppressing the legacy aggregate detonation credit in positional mode. Timed bursts lift the focus-enemy-only gate so each positioned enemy bursts its own containers.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-27-positional-per-victim-detonation-design.md`

**Branch:** stacks on `feat/combat-enemy-cleanse-lift` (confirmed by user 2026-06-27).

---

## Critical conventions (read before any task)

- **Golden discipline (LOAD-BEARING):** NEVER run `vitest -u` to update goldens/snapshots. Hand-validate every positional golden delta. Run the **whole** `npm test` suite for the golden audit — detonation fixtures live outside `src/utils/combat/` too (e.g. `healingGoldenParity`). A non-positional fixture moving = a bug, not a refresh.
- **Byte-identical guard:** No existing production caller threads `position + target + pattern`, so the positional branch is inert for all current goldens. Every PR here must keep non-positional fixtures byte-identical.
- **`gh auth switch --user TheSusort`** before any `gh pr` operation.
- **Worktree setup** (if used): copy main repo's `.env` + `docs/*.csv`, symlink `node_modules` (else `.tsx` collection + `audit:skills`/bio tests fail).
- **Commit message footer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Team symmetry ([[feedback_engine_team_symmetry]]):** a ship behaves identically on either side. PR3 makes this explicit; PR1/PR2 must not bake in a player-centric assumption that PR3 would have to unwind.

---

## Scope across PRs (stacked)

| PR | Scope |
|----|-------|
| **PR1** | Player→enemy **skill-triggered** detonation per-victim. Includes the Task-0 spike + the line-5326 seam resolution. |
| **PR2** | **Timed** bombs + accumulators per positioned enemy (lift the `actor.id === enemy.id` gate). |
| **PR3** | **Enemy→player** symmetric (same helper via `playerSink`). |

This plan details **PR1** in full. PR2/PR3 are outlined at the end — their concrete tasks are written **after PR1 lands**, because the per-victim helper shape and the 5326 resolution from PR1 Task 0 are their inputs.

---

## PR1 — Player→enemy skill-triggered detonation per-victim

### Task 0: Wiring spike (BLOCKING — resolve before writing implementation code)

**Goal:** Resolve four genuinely-open wiring questions the spec flagged. Output a short "Decisions" subsection appended to THIS plan file, then proceed. No production code in this task except a throwaway spike test if needed (deleted before Task 1).

**Files:**
- Read: `src/utils/combat/playerTurn.ts:526-591` (`detonate`), `:1500` (call site), `:2081-2093` (`positionalScalars`)
- Read: `src/utils/combat/engine.ts:4387-4474` (positional gate + credit suppression), `:5289-5326` (focus detonation row + 5326 reconciliation), `:2717-2739` (`applyVictimDamage` opts), `:2956-2989` (bomb-splash precedent)
- Read: `docs/ship-skills.csv` + `src/utils/skillTextParser.ts` / `detonationsFromSkill` (does detonate co-occur with a damage ability?)
- Modify: this plan (append "## PR1 Task 0 — Decisions")

- [ ] **Step 1: Resolve detonate-only positional entry.** `positionalScalars` is set ONLY when `hasDamageAbility` (`playerTurn.ts:2081`); the engine's `positional` gate requires `turn.positionalScalars != null` (`engine.ts:4391`). Determine via `docs/ship-skills.csv` + `detonationsFromSkill` whether any real ship has a **detonate-only** skill (detonate with no damage ability). Decision: (a) if detonate always co-occurs with damage → positional gate is sufficient as-is; (b) if detonate-only skills exist → the positional branch entry must ALSO trigger when a detonation recipe is present (widen the gate to `turn.positionalScalars != null || turn.positionalDetonation != null`). Record which. **NOTE for Task 3:** the engine's `positional` local at `:4387` currently ANDs in `positionalScalars != null`; the `args.positional` HINT passed into `runPlayerTurn` (Task 2) is computed independently of `positionalScalars`, so a detonate-only skill CAN get `args.positional: true` (recipe present) while the line-4387 `positional` is false. If detonate-only skills exist, Task 3 must gate the per-victim detonation block on the WIDENED condition, not the unchanged `:4387` local. Record the exact gate expression Task 3 should use.

- [ ] **Step 2: Resolve anchor double-consume.** `detonate()` runs inside `runPlayerTurn` and CONSUMES the anchor's containers (`.length = 0`) + emits `bomb-detonated` + returns the aggregate number. The anchor IS a footprint victim, so per-victim re-detonation would find empty containers. Decision: `runPlayerTurn` must NOT consume/credit/emit detonation in positional mode. Mechanism: pass a `positional` hint into `runPlayerTurn` (the engine knows `isPositional(actor.position, enemyAttackerActors) && target != null && pattern != null` BEFORE the call — only the `hasDamageAbility` sub-condition is post-hoc, and that does not affect whether to SKIP anchor consumption). When the hint is set, `runPlayerTurn` skips the `detonate()` call entirely and instead returns a `positionalDetonation` recipe `{ dets, effectiveAttack, dotMult, affinityMult, detonationMult }` (the inputs `detonate()` would have used, MINUS the per-victim containers/HP which the engine supplies per victim). Confirm this hint is safe (no other in-`runPlayerTurn` consumer depends on detonation having run). Record the exact arg name + recipe shape.

- [ ] **Step 3: Resolve inferno/corrosion shield-bypass flags.** Bomb detonation is precedented: `applyVictimDamage(dmg, victim, sink, { killerId, byDirectDamage: true, bombPortion: dmg, shieldPenetrationPct: 0 })` (full drain, no pen — `engine.ts:2973`). Inferno/corrosion must BYPASS shield (locked H rule). Determine the correct `cause` flags so they skip the shield pool to HP — candidate `{ byDirectDamage: true, shieldPenetrationPct: 100, bombPortion: 0 }` (100% of the direct portion bypasses), vs. whether a dedicated bypass flag is cleaner. Verify against the shield-absorb path (`shieldAbsorb.ts` / the drain inside `applyVictimDamage`). Record the exact flags for each of bomb / inferno / corrosion.

- [ ] **Step 4: Resolve the line-5326 display-vs-HP arithmetic.** Per-victim detonation decrements each victim's `currentHp` via `applyVictimDamage` (it must NOT also feed `cumulativeDamage` → line 5326, else focus enemy is hit twice). But the `detonationDamage` RoundData row (`engine.ts:5386`) + `totalDetonationRaw` summary (`:5309`) must STILL reflect detonation for the focus actor. Determine how `direct` solves the analogous problem (it sources the displayed row from the per-victim path / `roundPerTargetDamage`) and mirror it: decide whether to accumulate per-victim detonation into a per-actor detonation tally for the row, or reuse `focus.detonation` fed from a per-victim credit that does NOT reach `cumulativeDamage`. Record the exact accumulation + which line changes.

- [ ] **Step 5: Append decisions to this plan.** Write "## PR1 Task 0 — Decisions" with the four answers above (entry gate, recipe shape + arg name, per-type cause flags, display accumulation). Subsequent tasks reference these. Commit the plan update:

```bash
git add -f docs/superpowers/plans/2026-06-27-positional-per-victim-detonation.md
git commit -m "docs(combat): PR1 Task 0 wiring decisions for per-victim detonation"
```

---

### Task 1: Pure per-victim detonation helper

**Goal:** Extract `detonate()`'s per-type payout math into a pure, per-victim, testable helper that takes one victim's containers + the attacker recipe and returns the per-type payouts (does NOT apply HP, does NOT mutate the engine — the engine applies + emits). Refactor the existing `detonate()` to call it (byte-identical for non-positional).

**Files:**
- Create: `src/utils/combat/detonation.ts`
- Modify: `src/utils/combat/playerTurn.ts:526-591` (`detonate` delegates to the helper)
- Test: `src/utils/combat/__tests__/detonation.test.ts`

- [ ] **Step 1: Write failing unit tests** for a `detonateContainers(recipe, containers)` helper returning `{ bomb, inferno, corrosion, totalBombStacks }` payouts, consuming (clearing) the containers it detonates. Cover: bomb payout uses per-bomb `affinityMult × (1 + detonationDamageModifier/100)`; inferno uses attacker `effectiveAttack × dotMult × affinityMult × detonationMult`; corrosion uses `min(victimHp, 500_000)` (PER-VICTIM hp passed in); each `det.powerPct/100` factor; empty containers → 0. Mirror the exact arithmetic in `playerTurn.ts:540-588`.

- [ ] **Step 2: Run tests, verify they fail** (helper not defined).
Run: `npx vitest --run src/utils/combat/__tests__/detonation.test.ts`
Expected: FAIL (module/function not found).

- [ ] **Step 3: Implement `detonateContainers`** by lifting the three branches verbatim from `detonate()` (`playerTurn.ts:539-589`), parameterized by `victimHp` (for corrosion `baseHp`) and the recipe scalars. Keep the per-type return separate so the engine can emit `dot-detonated` (inferno+corrosion) vs `bomb-detonated` (bomb) distinctly.

- [ ] **Step 4: Refactor `detonate()` to delegate** to `detonateContainers`, passing `args.enemyHp` as `victimHp`, summing the payouts into the returned number, and emitting `bomb-detonated` as before. Verify byte-identical: the non-positional detonation path must be unchanged.

- [ ] **Step 5: Run helper tests + full suite.**
Run: `npx vitest --run src/utils/combat/__tests__/detonation.test.ts` → PASS
Run: `npm test` → all green, ZERO goldens moved.

- [ ] **Step 6: Commit.**
```bash
git add src/utils/combat/detonation.ts src/utils/combat/__tests__/detonation.test.ts src/utils/combat/playerTurn.ts
git commit -m "refactor(combat): extract pure per-victim detonateContainers helper"
```

---

### Task 2: Expose the detonation recipe + skip anchor consumption in positional mode

**Goal:** Per Task-0 Step 2 decision: add the `positional` hint to `PlayerTurnArgs`; when set, `runPlayerTurn` skips `detonate()` (no consume/credit/emit) and returns `positionalDetonation` recipe on the turn result.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:223-321` (`PlayerTurnArgs` — add hint), `:130-160` (return type — add `positionalDetonation?`), `:1500-1512` (gate the `detonate()` call), `:2095-2113` (return the recipe)
- Test: `src/utils/combat/__tests__/detonation.test.ts` (add `runPlayerTurn`-level cases) or a new positional integration test in Task 3

- [ ] **Step 1: Write failing test** — `runPlayerTurn` with the `positional` hint set + a detonate skill + an anchor carrying bombs returns `positionalDetonation` recipe (dets + scalars) AND leaves the anchor's containers UNCONSUMED (the engine will consume per-victim) AND `detonationDamage === 0` (not aggregate-credited). Without the hint → unchanged (recipe absent, containers consumed, `detonationDamage` populated).

- [ ] **Step 2: Run test, verify fail.**

- [ ] **Step 3: Implement.** Add `positional?: boolean` to `PlayerTurnArgs` (name per Task-0). Gate `playerTurn.ts:1500` `detonate()` on `!args.positional`. When `args.positional`, build `positionalDetonation = { dets: detonationsFromSkill(gatedSkill), effectiveAttack, dotMult, affinityMult, detonationMult }` and add to the return; leave `detonationDamage = 0`. Confirm containers untouched (no `.length = 0`).

- [ ] **Step 4: Run test + full suite.** All green, byte-identical (no caller passes `positional: true` yet).

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/detonation.test.ts
git commit -m "feat(combat): expose positional detonation recipe; skip anchor consume when positional"
```

---

### Task 3: Per-victim detonation at the positional apply site + suppress aggregate credit

**Goal:** Wire the engine: pass `positional: true` into `runPlayerTurn` for the focus turn when positional; after `drivePositionalApply`, iterate footprint victims and detonate each victim's own containers via `detonateContainers` → `applyVictimDamage` (per Task-0 cause flags); emit per-victim events; accumulate display total (Task-0 Step 4); suppress the aggregate detonation credit (`engine.ts:4474` joins the `!positional` block).

**Files:**
- Modify: `src/utils/combat/engine.ts:4336-4343` (pass `positional` into `runPlayerTurn`), `:4392-4474` (per-victim detonation loop + credit suppression), `:5289-5326` (display row sourcing per Task-0 Step 4)
- Test: `src/utils/combat/__tests__/perVictimDetonation.integration.test.ts` (NEW — harness mirrors `perVictimLeech.test.ts`)

- [ ] **Step 1: Write failing integration tests** (harness = `perVictimLeech.test.ts`: positioned actors, seeded containers, crit 0 → exact integers). Seed bombs on BOTH the origin footprint victim AND a covered footprint victim; fire a positional detonate skill. Assert:
  - origin victim's bombs detonate full against ITS hp; covered victim's bombs detonate full against ITS hp (covered no longer ignored);
  - corrosion uses per-victim `min(hp,500k)`;
  - a victim whose detonation exceeds its HP DIES (assert `ship-destroyed` for that victim + bomb-splash-on-death chain → `perActorSplash`). **Test-seeding note:** detonation CONSUMES the victim's bombs before death, so the splash chain needs the dying victim to carry *leftover* bombs the detonate skill did NOT consume (e.g. detonate inferno/corrosion to kill, leaving a bomb stack for the on-death splash), OR kill it via a non-bomb detonation type. Otherwise the consumed bombs won't be present at `recordDestroyed` and no splash fires.
  - `bomb-detonated` / `dot-detonated` emit per victim with that victim's `targetId`;
  - per-victim detonation recorded in `perTargetDamage`;
  - credit attributed to the applier (bombs per-entry `sourceId`, inferno/corrosion → detonating attacker).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**
  - Pass `positional` into `buildTurnArgs`/`runPlayerTurn` for the focus attacker (compute the hint from `isPositional && target != null && pattern != null` — available pre-call).
  - In the `if (positional)` block (after `drivePositionalApply`), if `turn.positionalDetonation` present: for each footprint victim (reuse `footprintVictims(pattern, anchor, opposingRoster)` — NO role-scale), call `detonateContainers(recipe, { victim's containers, victimHp })`, then `applyVictimDamage(payout, victim, enemySink, <Task-0 flags per type>)`, emit `bomb-detonated`/`dot-detonated` per victim, record `roundPerTargetDamage`, and accumulate the focus actor's display detonation tally.
  - Add `creditDamage(actor.id, 'detonation', turn.detonationDamage)` to the `if (!positional)` block (`engine.ts:4469`) — in positional it is 0 anyway, but the explicit move documents intent and guards a future non-zero.
  - Adjust the display row sourcing per Task-0 Step 4 so `detonationDamage`/`totalDetonationRaw` reflect the per-victim total WITHOUT feeding `cumulativeDamage`→5326.

- [ ] **Step 4: Run integration tests + FULL suite.**
Run: `npx vitest --run src/utils/combat/__tests__/perVictimDetonation.integration.test.ts` → PASS
Run: `npm test` → all green. **Hand-audit any moved golden** (expect zero for non-positional). NEVER `vitest -u`.

- [ ] **Step 5: tsc + lint.**
Run: `npx tsc --noEmit && npm run lint` → clean (max-warnings 0).

- [ ] **Step 6: Commit.**
```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/perVictimDetonation.integration.test.ts
git commit -m "feat(combat): per-victim skill-triggered detonation on the positional path"
```

---

### Task 4: Changelog + docs + memory

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if positional detonation is user-surfaced in combat docs)
- Modify: memory `project_positional_per_victim_detonation.md` + `MEMORY.md` (PR1 status)

- [ ] **Step 1: Add a plain-English changelog entry** — positioned battle sim: bomb/DoT detonation now damages each targeted ship individually (can kill covered targets, triggers their death effects).
- [ ] **Step 2: Update DocumentationPage** if combat-sim behavior is documented there; else skip (note skip in commit).
- [ ] **Step 3: Update memory** (PR1 status + any Task-0 decisions worth persisting).
- [ ] **Step 4: Commit + run full suite once more.**
```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): changelog + docs for per-victim skill detonation"
```

---

### Task 5: Requesting code review + open PR1

- [ ] **Step 1:** Use superpowers:requesting-code-review on the PR1 diff.
- [ ] **Step 2:** Address findings (prefer doc-only / targeted fixes; re-run full suite after each).
- [ ] **Step 3:** `gh auth switch --user TheSusort`; open PR1 stacked on `feat/combat-enemy-cleanse-lift`. PR body documents the byte-identical guarantee + the line-5326 resolution.

---

## PR2 — Timed bombs + accumulators per positioned enemy (OUTLINE — detail after PR1)

**Goal:** `processBombs` / `processAccumulators` (`engine.ts:4725` / `:4746`) run today only on the focus enemy's turn (`actor.id === enemy.id` gate, `:4695`). Make each positioned enemy burst its own timed bombs/accumulators against its own HP on its own turn, routing through `applyVictimDamage` (reusing Task-1 `detonateContainers` for bombs / the accumulator burst math) instead of the aggregate `creditDetonation`.

**Key questions for PR2's Task 0:**
- How does the round loop iterate non-focus positioned enemies, and where is their per-turn hook (the `actor.kind === 'enemy'` branches at `:4695` and `:4752`)?
- Do non-focus enemies even carry `pendingBombs`/`pendingAccumulators` today (application is anchor-only — so timed bursts on non-focus enemies only matter once those containers can be populated; confirm via PR1's seeding tests whether this is reachable)?
- Reconcile with the 5326 focus-enemy reconciliation (same seam as PR1).

PR2 is detailed once PR1's `detonateContainers` + apply-site pattern are concrete.

---

## PR3 — Enemy→player symmetric (OUTLINE — detail after PR1)

**Goal:** Enemy detonate skills land per-player. The enemy-dispatch branch (`engine.ts:4752+`) already runs `runPlayerTurn` with the player target bound as `enemy`; the positional enemy→player apply uses `playerSink`/`applyIncomingToTarget`. Wire the same per-victim detonation through `playerSink`, mirroring PR1.

**Key questions for PR3's Task 0:**
- The enemy-dispatch branch's positional apply site (the symmetric analogue of `drivePositionalApply` for enemy→player) and its victim wrapper.
- The E5-symmetry invariant test: a ship with a detonate skill behaves identically detonating player bombs as enemy bombs.

PR3 is detailed once PR1 lands.

---

## Done criteria (PR1)

- [ ] Per-victim skill-triggered detonation lands on each footprint victim's own HP (origin + covered), full (no role-scale).
- [ ] Detonation can kill a positioned victim → death + bomb-splash chain + per-victim reactives fire.
- [ ] `bomb-detonated` / `dot-detonated` emit per victim; `perTargetDamage` reflects detonation; credit per applier.
- [ ] Aggregate detonation credit suppressed in positional (no double-count vs line 5326); display `detonationDamage` row still correct.
- [ ] Non-positional fixtures **byte-identical**; full `npm test` green; tsc + lint clean.
- [ ] Changelog updated; PR1 opened stacked on `feat/combat-enemy-cleanse-lift`.
