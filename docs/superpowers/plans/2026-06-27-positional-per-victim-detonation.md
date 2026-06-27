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

## PR1 Task 0 — Decisions (resolved 2026-06-27 via wiring spike)

**Q1 — Detonate-only positional entry: NOT NEEDED.** No ship has a detonate-only skill. The
only abilities `detonationsFromSkill` returns are `detonate-dot` (parsed solely by
`DETONATE_DOT_RE`, `skillTextParser.ts:1470`), produced by exactly three ships — Crocus,
Demolisher, Incinerator — and all three "deal X% damage AND detonate" in the same skill →
`hasDamageAbility` true → `positionalScalars` always set whenever detonation is present.
Lingshe/Chimei "detonate" text parses as reactive triggers / buffs, never `detonate-dot`.
**→ Task 3 gates the per-victim detonation block on the EXISTING `positional` local
(`engine.ts:4387`); NO gate widening.** (Belt-and-suspenders: also guard on the recipe's
`dets.length > 0` so a non-damage skill that somehow set `positional` is a no-op.)

**Q2 — Per-type `applyVictimDamage` cause flags** (shield math in `shieldAbsorb.ts:12-30`;
`isDot = cause.byDirectDamage === false` at `engine.ts:2885`):
- **Bomb** (full shield drain, no pen): `{ killerId: bomb.sourceId, byDirectDamage: true,
  bombPortion: <bomb payout>, shieldPenetrationPct: 0 }` — `bomb === damage` → `shieldEligible =
  full` regardless of pen. Matches bomb-splash precedent (`engine.ts:2973`).
- **Inferno** (BYPASS shield): `{ byDirectDamage: false }` → `isDot` → `shieldAbsorb` returns
  `{ absorbed: 0, hpDamage: damage }` (`shieldAbsorb.ts:20`). The canonical DoT bypass.
- **Corrosion** (BYPASS shield): `{ byDirectDamage: false }` — same as inferno.
- Rationale: bombs FULL-DRAIN the shield (locked H rule) → must pass through it (byDirectDamage
  true + bombPortion); inferno/corrosion BYPASS (locked H rule) → DoT semantics (byDirectDamage
  false). A victim still dies if a bypass hit zeroes its HP (`recordDestroyed` fires inside
  `applyVictimDamage` regardless of `byDirectDamage`); the `killerId`/`byDirectDamage` fields only
  stamp the (currently unconsumed) ship-destroyed attribution, so omitting them on inferno/
  corrosion is acceptable. Credit/attribution rides Q4's tally + `roundPerTargetDamage`, NOT
  `killerId`.

**Q3 — Skip `detonate()` in positional mode: SAFE.** Add `positional?: boolean` to
`PlayerTurnArgs`. Nothing after `detonate()` (`playerTurn.ts:1500`) reads `detonationDamage`
except the return field (`:2109`); `applyNewDoTs`/`extendDoTs` do not depend on the anchor
containers having been consumed (extendDoTs runs BEFORE detonate; applyNewDoTs only appends).
When `positional` set: skip the `detonate()` call entirely (no consume, no credit, no emit), set
`detonationDamage: 0`, and add a `positionalDetonation` recipe to the return:
`{ dets: detonationsFromSkill(gatedSkill), effectiveAttack, dotMult, affinityMult, detonationMult }`.
The engine computes the hint as `isPositional(actor.position, enemyAttackerActors) && target !=
null && pattern != null` (known pre-call). Since detonation ⟹ damage ability (Q1), the hint and
the engine's full `positional` gate agree for any turn carrying detonation.

**Q4 — Display vs HP, mirror `perActorSplash`.** Positional DIRECT damage shows via
`roundPerTargetDamage` (`engine.ts:3445`, surfaced as `perTargetDamage` at `:5396`), NOT
`cumulativeDamage` (its credit is suppressed at `:4469`), and HP loss happens inside
`applyVictimDamage` (`:2891`). Bomb-splash-on-death already routes detonation-class damage through
`applyVictimDamage` + `roundPerTargetDamage` WITHOUT touching `cumulativeDamage` (`:2973-2986`).
**→ For per-victim detonation:** (1) apply each victim's payout via `applyVictimDamage` (Q2
flags) + record into `roundPerTargetDamage`; (2) accumulate a NEW per-round tally
`perActorDetonation` (mirror `perActorSplash`, declared near `:2617`, assembled into RoundData
near `:5399`) to source the `detonationDamage` display row in positional mode; (3) move the
aggregate `creditDamage(actor.id,'detonation', turn.detonationDamage)` (`:4474`) INTO the
`if (!positional)` block — in positional `turn.detonationDamage` is 0 anyway, but the move
documents intent and prevents feeding `cumulativeDamage`→line-5326. The display row sourcing
(`focus.detonation` at `:5289`→`:5386`) must read the new tally when positional so the row
reflects per-victim totals without the cumulative coupling.

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

## PR2 — Timed bombs + accumulators per positioned enemy (DETAILED 2026-06-27, post-PR1)

**Goal:** Today `processBombs` / `processAccumulators` (`engine.ts:700` / `:727`) run only on the focus dummy enemy's turn (`actor.kind === 'enemy' && actor.id === enemy.id`, `engine.ts:4794`) against the focus dummy's containers (`enemy.pendingBombs` / `enemy.pendingAccumulators`, bound at `:1666-1667`). In positional mode the real enemy victims are the `enemyAttackerActors` (= `playerTurnBindings.opposingRoster`, `engine.ts:3538`) — each is its own turn-taking actor with its own per-actor containers (`state.ts:124-127`, seeded in `createActor`). They take their turns in the enemy-attacker branch (`engine.ts:4851`+), which never processes their own timed containers. So a timed bomb/accumulator stored on a positioned enemy **never bursts**. PR2 makes each positioned enemy burst its OWN timed bombs/accumulators against its OWN HP on its OWN turn, routed through `applyVictimDamage` (the PR1 per-victim sink), suppressing the aggregate `creditDetonation`→`cumulativeDamage` path.

**Direction:** player→enemy still (the bombs were applied BY the player TO the enemies; they burst ON the enemies). PR3 does the enemy→player mirror. Damage lands on the enemy actor via `enemySink` (the same sink PR1 used).

**Scope (locked):** timed `processBombs` + `processAccumulators` per positioned enemy. `tickDoTs` stays OUT (sibling follow-up — shares the focus-only restriction; not detonation). New bomb/DoT *application* stays anchor-only (out of scope per spec §5).

### PR2 Task 0 — Decisions (resolved 2026-06-27 via wiring spike against current source)

**Q1 — Turn-site for positioned enemy timed bursts: the enemy-attacker branch (`engine.ts:4851`, `else if (actor.kind === 'enemy')`).** Positioned enemy victims are `enemyAttackerActors` (they require `healTargetId` → the PR1/PR2 harness sets `healTargetId`; same as `perVictimDetonation.integration.test.ts`). They take turns at `:4851`. The focus dummy (`:4794`, `actor.id === enemy.id`) keeps its EXISTING `tickDoTs`/`processBombs`/`processAccumulators` UNCHANGED — in non-positional it is the sole bomb carrier (byte-identical); in positional its containers are empty (application targets the positioned `tgt`, `engine.ts:3628-3631`) → no-op. **PR2 ADDS a per-actor timed-burst step in the `:4851` branch** (does NOT remove the `:4794` gate). DoTs/bombs tick at the START of the afflicted ship's turn (comment `:4797`) → insert the burst at the START of the enemy-attacker turn handling, BEFORE its action body.

**Q2 — Gate the new per-actor burst on `actor.side === 'enemy'` + positional + own containers non-empty.** Reuse `isPositional(actor.position, allPlayerActors)` (the enemy site's positional sense, already computed as part of `enemyPositional` at `:5011`) OR a lighter own-side positional check — Task 1 spike confirms the minimal sufficient gate. Belt-and-suspenders: only enter when `actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0`, so a non-positional / container-less enemy is a strict no-op (byte-identical guard; no fixture seeds enemy-actor timed containers today).

**Q3 — Per-actor burst routing (reuse `processBombs`/`processAccumulators` with repointed callbacks).** Both helpers already take `creditDetonation`/`emitBombDetonated` callbacks and own the countdown decrement + splice. Call them on `actor.pendingBombs` / `actor.pendingAccumulators` (the acting enemy's own containers), with callbacks that:
- **Bomb** (`processBombs.creditDetonation(sourceId, damage)`): `applyVictimDamage(damage, actor, enemySink, { killerId: sourceId, byDirectDamage: true, bombPortion: damage, shieldPenetrationPct: 0 })` — full shield drain, no pen (same flags as PR1 bomb + bomb-splash precedent `engine.ts:2973`). `emitBombDetonated(actorId, stacks, damage)` → `bus.emit('bomb-detonated', { actorId, round, stacks, damage })` (actorId = applier, unchanged attribution). Record `roundPerTargetDamage[actor.id] += damage`; tally `perActorDetonation[sourceId] += damage` (applier-keyed display, mirrors PR1).
- **Accumulator** (`processAccumulators.creditDetonation(sourceId, damage)`): **DEFAULT decision — treat as a neutral direct detonation hit the shield absorbs normally** (NOT bomb-style full-drain, NOT DoT bypass): `applyVictimDamage(damage, actor, enemySink, { killerId: sourceId, byDirectDamage: true, bombPortion: 0, shieldPenetrationPct: 0 })`. Rationale: an accumulator (Echoing Burst) is neither a bomb (no locked full-drain rule) nor a DoT (no bypass); the least-surprising shield interaction is ordinary absorb-then-HP. **FLAG for spec-reviewer in Task 4** — if the reviewer wants bomb-style full-drain, change `bombPortion: 0` → `bombPortion: damage`. (Production-unreachable today — application is anchor-only — so this only affects newly-seeded tests; byte-identical for all goldens regardless.) `allPlayersDirect` gather input stays the round-global `[...roundDamage.values()].reduce((s,d)=>s+d.direct,0)` (`engine.ts:4841`), computed identically per acting enemy. Accumulator has no `bomb-detonated`/`dot-detonated` event today → keep none (or emit a `dot-detonated` with `targetId: actor.id` ONLY if the reviewer wants surfacing; default: no new event to stay parity-minimal). Tally `perActorDetonation[sourceId] += damage` + `roundPerTargetDamage[actor.id] += damage`.

**Q4 — No line-5326 double-count for positioned enemies.** The `cumulativeDamage`→`engine.ts:5326` reconciliation overwrites the **focus dummy** `enemy.currentHp` only. Positioned enemy actors decrement their own `currentHp` directly inside `applyVictimDamage` (like PR1 detonation + direct). So routing per-actor bursts through `applyVictimDamage` and NOT through `creditDamage(sourceId,'detonation',…)` keeps them off `cumulativeDamage` → no double-hit. The focus dummy's `:4794` path is untouched (its `creditDetonation`→`cumulativeDamage` only fires for the dummy's own containers, empty in positional). **VERIFY in Task 1 spike:** confirm `creditDamage(…, 'detonation', …)` feeds `cumulativeDamage` (PR1 established it does → suppression was required); the new per-actor path must avoid it.

**Q5 — Death from a turn-start burst skips the actor's action.** A timed burst that zeroes the enemy's HP must prevent its action body from running (a dead ship does not act). `applyVictimDamage` fires `recordDestroyed` on lethal. After the burst, re-check `actor.currentHp <= 0` and SKIP the action body (mirror the existing `targetDead`/dead-actor handling). **Task 1 spike confirms** whether the main loop's actor-selection already excludes the now-dead actor or whether an explicit local guard is needed at `:4877`+; record the exact guard. (Splash-on-death from leftover bombs already chains through `applyVictimDamage`/`recordDestroyed`.)

---

## PR2 Task 1 — Spike confirmations (verified 2026-06-27 against live source + throwaway test)

> NOTE on line numbers: PR1 has already merged into this branch, so the live line numbers differ from the pre-PR1 references in the Task-0 decisions above (e.g. the "5326 reconciliation" now lives at `engine.ts:5432`, the focus-dummy timed-burst branch at `:4794`, the enemy-attacker branch at `:4851`). All refs below are LIVE on `feat/combat-positional-detonation-pr2-timed`.

**Fact 1 — `creditDamage(…, 'detonation', …)` feeds `cumulativeDamage` → the focus-enemy HP overwrite. CONFIRMED (Q4 correct).**
The chain is: `creditDamage(sourceId, channel, amount)` (`engine.ts:2640`) does `dmg(sourceId)[channel] += amount` → at end-of-round the focus entry's detonation is read as `focus.detonation` (`:5382` `const focus = dmg(focusActorId)`; `:5389` `detonationDamage = focus.detonation + focusPositionalDetonation`), folded into `totalRoundDamage = focus.direct + focus.corrosion + focus.inferno + focus.detonation` (`:5402`) → `cumulativeDamage += totalRoundDamage` (`:5403`) → `enemyHpDecline = cumulativeDamage + cumulativeTeamDamage` (`:5431`) → **`enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline)`** (`:5432`, the artifact the plan called "line 5326"). Team-actor detonation reaches it too via the `:5421-5423` team loop (`teamRoundDamage += d.detonation`) → `cumulativeTeamDamage` (`:5425`). `totalDetonationRaw += detonationDamage` (`:5415`) is the summary tally.
→ **The new PR2 per-actor path MUST route HP through `applyVictimDamage` and MUST NOT call `creditDamage(actor.id, 'detonation', …)` for the positioned enemy** (that would double-hit: once via `applyVictimDamage`'s own `victim.currentHp` decrement, once via the `cumulativeDamage`→`:5432` overwrite on the focus dummy). Note `cumulativeDamage`/`:5432` overwrites the **focus dummy's** `enemy.currentHp` ONLY — positioned enemy actors carry their own `currentHp`, mutated directly inside `applyVictimDamage` (`:2891`-region). PR1's per-victim skill block already follows exactly this discipline (`:4502`/`:4522` `applyVictimDamage` + `:4538` `perActorDetonation` tally, NO `creditDamage('detonation')`).

**Fact 2 — Insertion point + sinks in scope at the enemy-attacker branch (`engine.ts:4851`). CONFIRMED (Q1 correct).** All required handles are reachable from inside the `else if (actor.kind === 'enemy')` branch:
- `applyVictimDamage` — declared `:2725` (per-round closure inside `runCombat`); in scope.
- `enemySink` — declared `:3213`; in scope. (Player→enemy detonation lands on the enemy victim via `enemySink`, same as PR1.)
- `roundPerTargetDamage` — declared `:2625` (per-round `Map`, fresh each round); in scope.
- `perActorDetonation` — declared engine-scope `:1944`, **rebound fresh every round at `:3693`** (`perActorDetonation = new Map()`), surfaced into RoundData at `:5513-5514`; in scope.
- `bus` — `runCombat` arg; in scope (PR1 emits `bomb-detonated`/`dot-detonated` from this branch region already).
- round number `r` — the per-round loop variable; in scope.
- `processBombs` (`:700`) / `processAccumulators` (`:727`) — module-level fns taking the container + callbacks, owning the countdown-decrement + splice; callable here.
- The acting enemy's OWN containers: `actor.pendingBombs` / `actor.pendingAccumulators` / `actor.corrosionEntries` / `actor.infernoEntries` (per-actor fields, `state.ts:124-127`).
**Exact insertion point:** the enemy-attacker action body is wholly inside `if (!isTurnBlocked(actor.id))` (opens `:4877`). The first statements are `firstActivatorId ??= actor.id` (`:4880`), `runtimeFor` (`:4881`), `selectTurnTarget` (`:4898`), then `runPlayerTurn` (`:4976`). **Insert the per-actor timed burst immediately AFTER `:4880` (`firstActivatorId ??=`) and BEFORE `:4881` (`const enemyRuntime = …`)** — i.e. as the first real work of the turn body.
**Stasis decision:** insert the burst INSIDE the `if (!isTurnBlocked)` gate (so a stasised/disabled positioned enemy does NOT burst its timed containers this turn). RATIONALE/CORRECTION to Q2's "run regardless of stasis": the focus-dummy `:4794` path appears unconditional only because the dummy has NO stasis gate at all (it is a pure sink, never stasised); it is NOT evidence that bursts should bypass stasis. A real positioned enemy CAN be stasised, and the locked combat rule is that a stasised ship's turn is skipped (action + its turn-start DoT/bomb processing) with the duration decremented — `:4870-4876` documents exactly this for the enemy action body. Putting the burst inside the gate keeps the positioned enemy team-symmetric with how the heal-target tank's turn-start `tickDoTs` is itself gated by the tank's own turn proceeding. (If a future spec says timed bombs tick through stasis, that is a separate, cross-cutting change touching DoTs too — out of scope for PR2.) Belt-and-suspenders container-non-empty guard from Q2 still applies (no-op when both containers empty → byte-identical).

**Fact 3 — Dead-after-burst action skip: an EXPLICIT local guard IS REQUIRED. CONFIRMED (Q5 correct; "auto-skip" does NOT cover the mid-turn case).**
The main loop has a top-of-turn dead-actor skip at `:4185` (`if (actor.destroyedRound !== undefined && … && !isDummyEnemy) continue;`), but it runs at the TOP of the iteration — BEFORE `turn-started` is emitted (`:4207`) and BEFORE the `:4877` action body. A turn-START burst fires AFTER `turn-started` and INSIDE the `:4877` body, so `:4185` has already been passed and cannot catch a same-turn death. Between `:4877` and the `runPlayerTurn` call at `:4976` there is **NO** `actor.currentHp <= 0` / `actor.destroyedRound` re-check.
Throwaway-test evidence: a positioned enemy (`enemy-mid`, HP 1000) carrying a 2×1000 bomb killed by the FOCUS attacker's PR1 detonation (focus acts first in turn order) emitted `ship-destroyed` = 1 and `turn-started` = **0** → the `:4185` top-of-turn guard correctly skips an actor that died BEFORE its turn. This proves `:4185` only catches pre-turn deaths; it says nothing about a death caused DURING the actor's own turn body (the PR2 burst case), which `:4185` structurally cannot reach. (The throwaway test was deleted.)
→ **PR2 must add an explicit guard immediately after the burst:** after the `processBombs`/`processAccumulators` calls (inserted after `:4880`), do `if (actor.currentHp <= 0) { /* skip action body */ }` — wrapping the remainder of the `:4877` body (the `runtimeFor`→`runPlayerTurn`→apply sequence). `applyVictimDamage` already calls `recordDestroyed` (stamps `destroyedRound`, `state.ts:207`) on lethal, and bomb-splash-on-death chains inside it, so the only missing piece is preventing the action body from running. Mirror the existing `targetDead` early-handling shape (`:4899`/`:4937`). Note the post-turn decrements/`turn-ended` after the body should STILL run (a dead ship's turn still consumed its slot) — guard ONLY the action-resolution body, not the whole iteration.

**Fact 4 — Accumulator `allPlayersDirect` gather input. CONFIRMED (Q3 consistent).**
`allPlayersDirect = [...roundDamage.values()].reduce((s, d) => s + d.direct, 0)` is computed at `engine.ts:4841` inside the focus-dummy branch. `roundDamage` is a per-round `Map<string, ActorDamage>` (declared `:2620`, reset each round) accumulated by `creditDamage` as turns resolve. Computing this SAME expression per acting positioned enemy yields the round-global direct-damage sum AS OF that enemy's turn position — there is no per-enemy divergence (every enemy reading it at the same turn-order point sees the same value; the value only grows monotonically with turn order, exactly as the focus dummy sees it at the dummy's turn). The focus dummy's own `processAccumulators` (`:4845`, on `enemy.pendingAccumulators` — empty in positional) is untouched by adding a per-actor call on each positioned enemy's OWN `actor.pendingAccumulators`. **No disturbance to the focus dummy's accumulator processing.** (Caveat for Task 2 test design: because `allPlayersDirect` reflects direct credited UP TO that point in the round, a multi-round accumulator's accumulated total depends on turn order — seed accordingly and assert exact integers with crit 0.)

---

### Task 1: Wiring spike (BLOCKING — confirm the four runtime facts, then proceed)

**Goal:** Confirm the Task-0 decisions against a live throwaway test before implementing. No production code (delete any spike test before Task 2).

**Files (read):** `src/utils/combat/engine.ts:4794-4850` (focus burst), `:4851-5160` (enemy-attacker turn), `:5289-5326` (5326 reconciliation), `:3160-3231` (`playerSink`/`enemySink`/`applyVictimDamage`), `:700-741` (`processBombs`/`processAccumulators`).

- [ ] **Step 1: Confirm `creditDamage(…, 'detonation', …)` feeds `cumulativeDamage`** (grep `creditDamage` + the detonation accumulation into `cumulativeDamage`/`totalDetonationRaw`). Confirm the new per-actor path must NOT call it. Record the exact lines.
- [ ] **Step 2: Confirm the enemy-attacker turn START is the right insertion point** and that `enemySink` + `applyVictimDamage` + `roundPerTargetDamage` + `perActorDetonation` are all in scope at `:4851`+. Record the exact insertion line (before `if (!isTurnBlocked(actor.id))` at `:4877`, or just inside it — DoTs tick even for a turn-blocked/stasised ship? Check the `:4794` focus path: it processes regardless of stasis since the dummy has no stasis gate; decide whether positioned-enemy bursts run on a stasised turn — DEFAULT: run at turn-start regardless of stasis, matching the focus dummy's unconditional processing, but record the call's exact placement relative to the `isTurnBlocked` gate).
- [ ] **Step 3: Confirm the dead-after-burst guard** — write a throwaway test seeding a lethal timed bomb on a positioned enemy, burst it, assert the enemy does NOT act afterward (its action body is skipped). Record whether the loop auto-skips or an explicit `actor.currentHp <= 0` local guard is needed.
- [ ] **Step 4: Confirm accumulator `allPlayersDirect`** is computed identically per acting enemy (round-global) and that bursting it per-enemy does not disturb the focus dummy's accumulator processing.
- [ ] **Step 5: Append a short "## PR2 Task 1 — Spike confirmations" block** to this plan, delete the throwaway test, commit the plan update:
```bash
git add -f docs/superpowers/plans/2026-06-27-positional-per-victim-detonation.md
git commit -m "docs(combat): PR2 Task 1 wiring confirmations for timed per-victim detonation"
```

---

### Task 2: Failing integration test — timed bombs/accumulators per positioned enemy

**Goal:** Pin the per-positioned-enemy timed burst. Harness = `perVictimDetonation.integration.test.ts` (positioned `enemyAttackers`, `healTargetId` set, crit 0 → exact integers, `__testTapActors` seeding, multi-round so countdowns reach 0).

**Files:** Create `src/utils/combat/__tests__/perVictimTimedDetonation.integration.test.ts`.

- [ ] **Step 1: Write failing tests.** Seed a TIMED bomb (`countdown: 2`) on a NON-focus positioned enemy (`enemy-mid`) and run `numRounds: 2`. Assert:
  - the bomb bursts against `enemy-mid`'s OWN HP on its OWN turn (countdown reaches 0 round 2): `perTargetDamage['enemy-mid']` includes the burst; `perActorDetonation[applier]` credited; `bomb-detonated` emitted with applier `actorId`;
  - the burst is NOT folded into the focus dummy (`enemy.id`) / not double-counted via 5326;
  - an accumulator seeded on a positioned enemy bursts for `accumulated × pct/100` on expiry, credited to its applier, landing on that enemy's HP (shield-absorb-normal per Q3 default);
  - a lethal timed bomb KILLS the positioned enemy → `ship-destroyed` for it + (with a leftover bomb) bomb-splash chain → `perActorSplash`; the dead enemy does not act afterward;
  - **byte-identical guard:** a non-positional run with a timed bomb on the focus dummy bursts EXACTLY as today (regression pin against the `:4794` path).
- [ ] **Step 2: Run, verify fail** (`npx vitest --run src/utils/combat/__tests__/perVictimTimedDetonation.integration.test.ts`).

---

### Task 3: Implement per-positioned-enemy timed bursts

**Files:** `src/utils/combat/engine.ts` (enemy-attacker branch `:4851`+; add the per-actor timed-burst step + dead-after-burst guard); `src/utils/combat/dpsSimulator.ts` only if a new RoundData field is needed (reuse existing `perActorDetonation`/`perTargetDamage` from PR1 → likely none).

- [ ] **Step 1: Implement** per Task-0 Q1-Q5: at the enemy-attacker turn start, when positional + own timed containers non-empty, call `processBombs`/`processAccumulators` on `actor`'s own containers with callbacks routing each burst through `applyVictimDamage(…, actor, enemySink, <Q3 flags>)` + `roundPerTargetDamage[actor.id]` + `perActorDetonation[sourceId]` + per-victim `bomb-detonated`; guard the action body on `actor.currentHp > 0` after the burst.
- [ ] **Step 2: Run the new integration test → PASS.**
- [ ] **Step 3: Run the FULL suite** (`npm test`). All green. **Hand-audit any moved golden — expect ZERO** for non-positional. NEVER `vitest -u`.
- [ ] **Step 4: tsc + lint** (`npx tsc --noEmit && npm run lint`) → clean (max-warnings 0).
- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/perVictimTimedDetonation.integration.test.ts
git commit -m "feat(combat): per-positioned-enemy timed bomb/accumulator detonation"
```

---

### Task 4: Changelog + docs + memory

**Files:** `src/constants/changelog.ts` (`UNRELEASED_CHANGES`); `src/pages/DocumentationPage.tsx` (only if combat-sim detonation is user-surfaced — else note skip); memory `project_positional_per_victim_detonation.md` + `MEMORY.md` (PR2 status).

- [ ] **Step 1: Changelog** — positioned battle sim: timed bombs and accumulators now burst on each targeted ship individually (against its own HP, can kill it and trigger its death effects), not only on the primary target.
- [ ] **Step 2: Update memory** with PR2 status + the accumulator-shield-flag decision (flag for review outcome).
- [ ] **Step 3: Commit.**
```bash
git add src/constants/changelog.ts
git commit -m "docs(combat): changelog for per-positioned-enemy timed detonation"
```

---

### Task 5: Code review + open PR2

- [ ] **Step 1:** `superpowers:requesting-code-review` on the PR2 diff. Surface the accumulator-shield-flag default explicitly for the reviewer's call (Q3).
- [ ] **Step 2:** Address findings (prefer doc-only / targeted; re-run full suite after each).
- [ ] **Step 3:** `gh auth switch --user TheSusort`; open PR2 stacked on `feat/combat-positional-per-victim-detonation` (PR1 #168). PR body: the byte-identical guarantee + that this lifts the focus-enemy timed-burst restriction (player→enemy; PR3 mirrors enemy→player).

---

## Done criteria (PR2)

- [ ] Each positioned enemy bursts its OWN timed bombs/accumulators against its OWN HP on its OWN turn.
- [ ] A lethal timed burst kills the positioned enemy → death + bomb-splash chain + per-victim reactives; the dead enemy does not act.
- [ ] `bomb-detonated` emits per bursting victim; `perTargetDamage`/`perActorDetonation` reflect it; credit per applier.
- [ ] No double-count against line 5326; focus dummy `:4794` path byte-identical.
- [ ] Non-positional fixtures **byte-identical**; full `npm test` green; tsc + lint clean.
- [ ] Changelog updated; PR2 opened stacked on PR1 (#168).

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
