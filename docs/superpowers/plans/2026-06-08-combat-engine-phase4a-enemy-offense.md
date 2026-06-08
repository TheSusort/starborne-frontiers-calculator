# Combat Engine Phase 4a — Enemy as a Full Offensive Actor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the healing-mode enemy a full combat actor that walks its entire parsed kit (damage + debuffs + DoTs + self-buffs) against a single fixed target on the shared `runPlayerTurn` pipeline, unlocking real `selfHpPct`, the `on-attacked` trigger, and the 24 `enemy-buff`/`self-debuff` conditions.

**Architecture:** The enemy graduates from the damage-only `runEnemyAttackerTurn` to `runPlayerTurn` with the **tank passed as the `enemy` target arg** (the pipeline is already target-parameterized). The statusEngine's single enemy-debuff store generalizes to **per-target** stores (the singular enemy keyed by `enemy.id` stays byte-identical); the enemy's self-buffs use the existing **per-owner** buff store keyed by its id. Three condition-context fields (`selfHpPct`, `enemyBuffNames`, `selfDebuffNames`) go live. A new additive `attacked` event makes `on-attacked` a live trigger. Affinity (ii) is resolved in `healingEngineAdapter.ts` via `computeAffinityModifiers`. DPS stays byte-identical (no `healTargetId`, no enemy attackers, singular target-wall enemy untouched).

**Tech Stack:** TypeScript, Vitest (golden parity suites are the referee), React + TailwindCSS for the Healing Calculator UI.

**Spec:** `docs/superpowers/specs/2026-06-08-combat-engine-phase4a-enemy-offense-design.md`

---

## Conventions for every task

- **TDD:** write the failing test first, run it red, implement minimally, run it green, commit.
- **Goldens are sacred.** Run `npm test -- dpsGoldenParity healingGoldenParity` after structural tasks. The **22 DPS goldens must stay byte-identical** every task. Healing goldens stay byte-identical until Task 11 deliberately adds scenarios. **Never `vitest -u`** — to regenerate a specific golden, delete its snapshot block and re-run that file once.
- **Determinism:** every actor/stream gets its own `makeRateGate()`. Listeners are pure (enqueue only); the engine/executor is the sole mutator.
- **Commits:** stage explicit per-file paths (`git add <path>` — never `git add -A`; a separate agent may share the tree). Pre-commit runs the full suite (~2 min) + ESLint zero-warnings. No `--no-verify` for code commits (docs-only commits may skip).
- **Branch:** `feat/combat-engine-phase4a-enemy-offense` (already created; spec committed).
- Reference @superpowers:test-driven-development and @superpowers:verification-before-completion.
- **Test-file locations (important — the per-task `Test:` paths are indicative, not literal):** there is **no** `src/utils/combat/__tests__/engine.test.ts` or `playerTurn.test.ts`. Engine/turn behaviour is split across files like `engine.events.test.ts`, `teamWalk.test.ts`, `healing.test.ts`, `leech.test.ts` under `src/utils/combat/__tests__/`. The **golden parity suites live under `src/utils/calculators/__tests__/`** (`dpsGoldenParity.test.ts`, `healingGoldenParity.test.ts`). For each task, `grep -rln "<relevant symbol>" src/utils/combat/__tests__ src/utils/calculators/__tests__` to find the right existing file, or create a focused new one — do not assume the literal path in the task.

## File structure (what changes, and why)

- `src/utils/combat/statusEngine.ts` — generalize the enemy-debuff side to **per-target** stores keyed by target id; expose a target-scoped debuff snapshot + decrement. (Task 1)
- `src/utils/abilities/roundContext.ts` — `buildRoundContext` accepts `selfHpPct`, `enemyBuffNames`, `selfDebuffNames` (default to today's values). (Task 2)
- `src/utils/combat/triggers.ts` — `buildActorConditionContext` threads the three new fields + the payload-inclusion path for the opposing side's buffs and the owner's debuffs (names only). (Task 2, Task 7)
- `src/utils/combat/events.ts` — additive `attacked` event. (Task 4)
- `src/types/abilities.ts` — add `on-attacked` to `LIVE_TRIGGERS`. (Task 4)
- `src/utils/combat/playerTurn.ts` — accept the acting actor's own `selfHpPct`; route it into the actor's condition contexts. (Task 3)
- `src/utils/combat/engine.ts` — build the enemy a `PlayerActorRuntime`; dispatch enemy turns through `runPlayerTurn` bound to the heal target; drain damage into the target (reuse existing shield-first intake + `damage-taken` procs); emit `attacked`; decrement the enemy's own statuses; retire the `runEnemyAttackerTurn` branch. (Tasks 5, 6, 8)
- `src/utils/combat/enemyTurn.ts` — **deleted** once Task 6 lands.
- `src/utils/calculators/healingEngineAdapter.ts` — `EnemyAttackerInput` gains `affinity`; resolve the enemy matchup via `computeAffinityModifiers`; build the enemy with full (not damage-only) `shipSkills`. (Task 9)
- `src/utils/calculators/dpsSimulator.ts` — `deriveTeamEngineActors` reused for the enemy runtime bundle (no signature change expected). (Task 9)
- `src/components/.../EnemyAttackersPanel.tsx` + healing round-overview component — affinity `Select`; enemy-effects round overview. (Task 10)
- Golden suites + new scenarios. (Task 11)
- `docs/skill-model-coverage.md`, `src/constants/changelog.ts`, handoff, memory. (Task 12)

---

## Task 1: Per-target debuff stores in statusEngine

**Goal:** the enemy-debuff side becomes keyed by the **target actor id**. The singular enemy (`enemy.id`) path is byte-identical; a second target id (the tank) gets an isolated debuff store.

**Files:**
- Modify: `src/utils/combat/statusEngine.ts`
- Test: `src/utils/combat/__tests__/statusEngine.test.ts` (or the existing statusEngine test file — match the repo's location)

**Background (from the map):** today the enemy-debuff side is single: `accumEnemyMap`, `auraEnemy`, the timed-enemy maps, `decrementEnemy()`, and `snapshot().activeEnemyDebuffs`. Application enters via `applyTimedAbilityStatus(r, status, ownerId)` and `activeAbilityStatuses('enemy', ctx, ownerId)` where `ownerId` is the **applier**. We add a **target id** dimension so a debuff sits on the actor it targets.

- [ ] **Step 1: Write failing tests** for a target-keyed debuff API. Two cases:
  - debuffs applied with `targetId = enemy.id` reproduce the current `decrementEnemy()` / `activeEnemyDebuffs` behaviour exactly (apply a timed enemy debuff, snapshot, decrement, assert identical to the pre-existing single-store test);
  - debuffs applied with `targetId = 'tank'` are **isolated** — they appear only in the `'tank'` target snapshot, not in the `enemy.id` snapshot, and decrement independently.
- [ ] **Step 2: Run red.** `npm test -- statusEngine` → FAIL (target-keyed API absent).
- [ ] **Step 3: Implement.** Convert the enemy-side maps to `Map<targetId, …>` (mirror the existing per-owner `Map<ownerId, …>` pattern used for `accumSelfMaps`/`persistentSelfMaps`). Add a `defaultEnemyTargetId` (the singular `enemy.id`) so existing call sites that don't pass a target id resolve to it → byte-identical. Add target-scoped variants of `decrementEnemy`/snapshot-enemy/`activeAbilityStatuses('enemy', …)` taking an optional `targetId`. Keep the public signatures backward-compatible (optional param, default = singular enemy).
- [ ] **Step 4: Run green.** `npm test -- statusEngine` → PASS.
- [ ] **Step 5: Guard the goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → byte-identical.
- [ ] **Step 6: Commit.** `git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts && git commit -m "feat(combat): per-target debuff stores in statusEngine (enemy.id path byte-identical)"`

---

## Task 2: Condition-context fields — `selfHpPct`, `enemyBuffNames`, `selfDebuffNames` (plumbing only)

**Goal:** `buildRoundContext` and `buildActorConditionContext` accept the three fields; defaults reproduce today's behaviour. (Population from real state is Tasks 3 & 7.)

**Files:**
- Modify: `src/utils/abilities/roundContext.ts:13-44`
- Modify: `src/utils/combat/triggers.ts:313-347` (`buildActorConditionContext`)
- Test: `src/utils/abilities/__tests__/roundContext.test.ts`

- [ ] **Step 1: Write failing test.** `buildRoundContext({... , selfHpPct: 40, enemyBuffNames: ['Attack Up III'], selfDebuffNames: ['Defense Down II']})` returns a context with those exact values; omitting them yields `selfHpPct: 100`, `enemyBuffNames: []`, `selfDebuffNames: []` (today's defaults).
- [ ] **Step 2: Run red.** `npm test -- roundContext` → FAIL.
- [ ] **Step 3: Implement.** Add the three optional inputs to `buildRoundContext`'s param object; default `selfHpPct ?? 100`, `enemyBuffNames ?? []`, `selfDebuffNames ?? []`. Thread the same three optional inputs through `buildActorConditionContext`'s `shared` param (default-passthrough).
- [ ] **Step 4: Run green.** `npm test -- roundContext` → PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → byte-identical (defaults unchanged).
- [ ] **Step 6: Commit.** `git add src/utils/abilities/roundContext.ts src/utils/combat/triggers.ts src/utils/abilities/__tests__/roundContext.test.ts && git commit -m "feat(combat): condition-context accepts selfHpPct/enemyBuffNames/selfDebuffNames (defaults unchanged)"`

---

## Task 3: Live `selfHpPct` for the acting actor in `runPlayerTurn`

**Goal:** an acting actor's own gates read its live HP% (`currentHp / maxHp × 100`), so a bombarded tank's below-40% / HP<50 gates activate. Untargeted actors and the DPS attacker stay 100 (their HP never declines).

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (the three `buildRoundContext` call sites at `:793, :908, :981, :1051` — pass `selfHpPct`)
- Modify: `src/utils/combat/engine.ts` (compute and pass the acting actor's `selfHpPct` into `runPlayerTurn` args)
- Test: `src/utils/combat/__tests__/playerTurn.test.ts` (or engine-level test)

- [ ] **Step 1: Write failing test.** An actor with a self-HP-threshold-gated ability (`hpSubject: 'self'`, below 40%) whose `currentHp/maxHp` is 30% **fires** the gated ability; at 100% it does not. Use a hand-built `ab()` fixture + a `PlayerActorRuntime` whose `actor.currentHp` is set below threshold.
- [ ] **Step 2: Run red.** FAIL (selfHpPct fixed 100 → gate never fires).
- [ ] **Step 3: Implement.** Add `selfHpPct: number` to `PlayerTurnArgs`. Pass it into every `buildRoundContext` call in `runPlayerTurn`. In `engine.ts`, compute it for each acting actor as `100 × max(0, currentHp) / maxHp` (maxHp from `baseHpFor(actor.id)` / `actor.stats.hp`); for the DPS attacker and untargeted actors `currentHp === maxHp` → 100 → byte-identical. Default the arg to 100 to keep non-passing call sites safe.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → byte-identical (no actor takes self-damage in existing fixtures, so all stay at 100%).
- [ ] **Step 6: Commit.** `git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts src/utils/combat/__tests__/playerTurn.test.ts && git commit -m "feat(combat): live selfHpPct for acting actors (HP-threshold gates activate)"`

---

## Task 4: `attacked` event + `on-attacked` live trigger

**Goal:** add an additive `attacked` event and make `on-attacked` a live trigger so abilities already annotated `on-attacked` fire via the existing reactive machinery. (Specific enemy-action reactions / generic damage triggers are 4c.)

**Files:**
- Modify: `src/utils/combat/events.ts` (event union + emit type)
- Modify: `src/types/abilities.ts:55-65` (`LIVE_TRIGGERS`)
- Modify: `src/utils/combat/triggers.ts` (register a pure `on-attacked` listener keyed to the target)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

- [ ] **Step 1: Write failing test.** Emitting `{ type: 'attacked', targetId: 't', attackerId: 'e', round: 1 }` causes a target actor with an `on-attacked` reactive ability to enqueue exactly one intent; an actor without the trigger enqueues none. Listener is pure (no state mutation before drain).
- [ ] **Step 2: Run red.** FAIL (`attacked` not in the union; `on-attacked` not live).
- [ ] **Step 3: Implement.**
  - `events.ts`: add `| { type: 'attacked'; targetId: string; attackerId: string; round: number; didCrit?: boolean }` (`didCrit` present-only-when-true).
  - `abilities.ts`: add `'on-attacked'` to `LIVE_TRIGGERS` (this also makes `partitionReactiveAbilities` route `on-attacked` abilities to the reactive list — verify the partition test still passes). **Also update the stale doc comment at `abilities.ts:48-49`** that still lists `on-attacked` among the annotation-only triggers.
  - `triggers.ts`: add a `case 'on-attacked':` to the `registerReactiveListeners` switch (`~:151`), scoped to fire on the **target** (`e.targetId === ownerId`), enqueuing intents for that owner's `on-attacked` reactive abilities (mirror the existing `on-crit`/`on-bomb-detonated` listener shape; **enqueue-only / pure**).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Byte-identical (no `attacked` event is emitted yet — Task 8 wires the emission).
- [ ] **Step 6: Commit.** `git add src/utils/combat/events.ts src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts && git commit -m "feat(combat): attacked event + on-attacked live trigger (pure listener)"`

---

## Task 5: Build the enemy a `PlayerActorRuntime` (setup, no dispatch change yet)

**Goal:** in healing mode, construct a full `PlayerActorRuntime` for each enemy attacker (partitioned abilities, per-stream gates, status owner-id, affinity fields) **alongside** the existing `EnemyAttackerRuntime`, without yet changing dispatch. This isolates the setup change from the behavioural switch.

**Files:**
- Modify: `src/utils/combat/engine.ts:826-908` (enemy attacker setup block)
- Test: `src/utils/combat/__tests__/engine.test.ts`

- [ ] **Step 1: Write failing test.** A helper (e.g. `buildEnemyActorRuntime(input)`) returns a `PlayerActorRuntime` with: `castSkills`/`reactiveAbilities` from `partitionReactiveAbilities(shipSkills)`; its own gate instances; `focus: false`; affinity fields from the input; `actor.side/kind === 'enemy'`. Assert the partition and that gates are distinct instances.
- [ ] **Step 2: Run red.** FAIL (helper absent).
- [ ] **Step 3: Implement.** Add the builder. Reuse the walked-team runtime construction (`engine.ts:681-756`) as the template — the enemy is "a team actor on the enemy side." Give the enemy a real defence/hp (its own stats, no longer forced to 0) so it can be a target later, but this task does not route damage to it. Keep the old `EnemyAttackerRuntime` build in place for now (dispatch still uses it).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Byte-identical (nothing dispatched through the new runtime yet).
- [ ] **Step 6: Commit.** `git add src/utils/combat/engine.ts src/utils/combat/__tests__/engine.test.ts && git commit -m "feat(combat): build enemy PlayerActorRuntime (setup only, dispatch unchanged)"`

---

## Task 6: Thread an explicit target key through `runPlayerTurn`'s enemy-side status application

**Goal (PREREQUISITE for Task 6b — do this first):** `runPlayerTurn` applies/reads enemy-side debuff/aura/accum statuses via `applyTimedAbilityStatus(r, status, actor.id)`, `timedAbilityStatuses('enemy', actor.id)`, and `activeAbilityStatuses('enemy', …, actor.id)` (`playerTurn.ts:~815, ~866-867, ~930`), where the owner arg is the **applier** and the underlying enemy maps are singular. For an enemy actor's debuffs to land on the **tank's** per-target key (Task 1), the **target id** must flow into those calls. Add it to `PlayerTurnArgs` and route it, defaulting to `enemy.id` so the player→enemy path is byte-identical.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (add `targetId` to `PlayerTurnArgs`; thread it into the enemy-side `applyTimedAbilityStatus` / `timedAbilityStatuses('enemy', …)` / `activeAbilityStatuses('enemy', …)` calls and the per-target debuff snapshot/decrement read — replacing the applier-id owner arg on the **enemy side only**; DoTs/bombs already route by the passed container arrays, leave them)
- Modify: `src/utils/combat/engine.ts` (pass `targetId: enemy.id` at the existing attacker + team `runPlayerTurn` call sites — `:~1355-1419`, `:~1420-1475`)
- Test: the appropriate existing engine test file (e.g. `teamWalk.test.ts`/`healing.test.ts` — `grep -rln "runCombat" src/utils/combat/__tests__` to pick) or a new focused file

- [ ] **Step 1: Write failing test.** With `targetId` defaulting to `enemy.id`, two player actors applying enemy debuffs both land them under `enemy.id` (current behaviour). Then a debuff applied with `targetId: 'tank'` lands under the `'tank'` per-target key and is absent from the `enemy.id` snapshot. (This is the playerTurn-level counterpart to Task 1's statusEngine test.)
- [ ] **Step 2: Run red.** FAIL (`targetId` not on `PlayerTurnArgs`; enemy-side calls ignore it).
- [ ] **Step 3: Implement.** Add `targetId: string` to `PlayerTurnArgs` (default `enemy.id` if you prefer an optional+`?? enemy.id` to minimise call-site churn). Route it as the **target** key into every enemy-side status call. Player call sites pass `enemy.id` → byte-identical.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → byte-identical.
- [ ] **Step 6: Commit.** `git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts <test file> && git commit -m "feat(combat): thread targetId through runPlayerTurn enemy-side status application (enemy.id default byte-identical)"`

---

## Task 6b: Dispatch enemy turns through `runPlayerTurn` bound to the heal target; retire `runEnemyAttackerTurn`

**Goal:** the enemy branch calls `runPlayerTurn` with the **heal target passed as the `enemy` target arg** and `targetId: healTarget.id` (from Task 6). Damage drains into the target via the existing shield-first intake + `damage-taken` procs. Self-buffs land in the enemy's own owner store; debuffs/DoTs land on the target. Delete `enemyTurn.ts` and its test.

**Files:**
- Modify: `src/utils/combat/engine.ts:1594-1670` (enemy branch) + post-turn decrement `:1685-1696` + the `enemyTurn` import at `:10`
- Delete: `src/utils/combat/enemyTurn.ts`
- Delete/migrate: `src/utils/combat/__tests__/enemyTurn.test.ts` (fold its damage-formula coverage into the damage-parity test below, then `git rm` it)
- Test: the appropriate existing engine test file (pick via `grep -rln "enemyAttackers" src/utils/combat/__tests__`)

- [ ] **Step 1: Write failing tests.**
  - **Damage parity:** a damage-only, neutral-affinity, no-buff enemy attacker deals the **same per-round damage** through `runPlayerTurn` as it did through `runEnemyAttackerTurn` (capture the old number first from an existing healing fixture/snapshot, then assert equality). This is the byte-identical gate.
  - **New behaviour:** an enemy whose kit applies a debuff to the target → that debuff appears in the target's per-target debuff store; an enemy that grants itself a self-buff → it appears in `snapshot(enemyId).activeSelfBuffs` (via the ability-status path).
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.**
  - In the enemy branch, build per-turn `runPlayerTurn` args binding target = `healTarget`: `enemy: healTarget`, `targetId: healTarget.id`, `enemyDefense` from `lastTurnCtxByActor.get(healTarget.id)?.effectiveDefence ?? baseDefenceFor(...)`, `enemyHp`/`enemyHpDecline` = target pool/decline, the **target's** DoT/bomb/accumulator containers, `enemyType` = target class (or undefined), the enemy's own runtime (Task 5), and the enemy's own `selfHpPct` (Task 3).
  - Route `runPlayerTurn`'s returned damage into the **existing** shield-first drain + `ship-destroyed` + `damage-taken` proc code already in this branch (only the damage *source* changes). Credit as incoming damage to the tank, **not** player rows.
  - Post-turn: the enemy attacker now decrements its **own** statuses (`decrementPlayer(enemyAttacker.id)` for self-buffs) + the per-target debuff store for the target. The singular `enemy.id` path keeps `decrementEnemy()`.
  - Delete `enemyTurn.ts`, its test, and the import.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → DPS byte-identical; **healing byte-identical** (existing fixtures are damage-only, neutral affinity). If a healing golden diverges, STOP: trace whether it's a genuine formula difference (document as a hand-verified KNOWN-DIFF with arithmetic) or a bug (fix it). Never regenerate blindly.
- [ ] **Step 6: Commit.** `git add src/utils/combat/engine.ts <test file> && git rm src/utils/combat/enemyTurn.ts src/utils/combat/__tests__/enemyTurn.test.ts && git commit -m "feat(combat): enemy walks runPlayerTurn vs the heal target; retire runEnemyAttackerTurn"`

---

## Task 7: Populate `enemyBuffNames` (enemy self-buffs) + `selfDebuffNames` (target debuffs) into player condition contexts

**Goal:** player actors' gates now see the enemy's self-buffs (the 24 `enemy-buff` conditions) and the tank sees its own enemy-applied debuffs (`self-debuff` conditions), respecting the payload-exclusion rule (names only, never re-fold effects).

**Files:**
- Modify: `src/utils/combat/triggers.ts:313-347` (`buildActorConditionContext`) + the player-turn caster-ctx resolver and `buildDrainContext` call sites
- Modify: `src/utils/combat/playerTurn.ts` (the `buildRoundContext` calls that gate player abilities)
- Test: `src/utils/combat/__tests__/triggers.test.ts`, `playerTurn.test.ts`

**Background:** the enemy's self-buffs and the tank's debuffs are ability-sourced → payload-carrying → excluded from `snapshot()` (the `!s.payload` guards at `statusEngine.ts:593,601,617` and the timed-map guards at `:642,654`). Use the existing inclusion pattern (`includeAbilitySelfNames` → `timedAbilityStatuses('self', ownerId)` at `triggers.ts:330-336`) extended to: the **opposing side's** buffs (for `enemyBuffNames`) and the **owner's** debuffs (for `selfDebuffNames`).

- [ ] **Step 1: Write failing tests.**
  - A player ability gated on `enemy-buff` (e.g. "if the enemy has a buff") fires when the enemy actor holds an ability-sourced self-buff, and does not when it holds none.
  - A tank ability gated on `self-debuff` fires when the tank carries an enemy-applied debuff.
  - **No double-fold:** the enemy's self-buff effect is folded exactly once (assert the enemy's effective attack isn't doubled).
- [ ] **Step 2: Run red.** FAIL (`enemyBuffNames`/`selfDebuffNames` still `[]`).
- [ ] **Step 3: Implement.** In `buildActorConditionContext`, source `enemyBuffNames` from the opposing side's buff snapshot + ability-status names (timed + aura/accum), and `selfDebuffNames` from the owner's per-target debuff store names + its ability-status debuff names. Add the inclusion only for the names; do not touch effect folding. Thread the opposing-side owner id (for a player actor, the enemy id; in single-target this is the configured enemy attacker / singular enemy).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Byte-identical (no existing fixture has an enemy self-buff or a tank debuff).
- [ ] **Step 6: Commit.** `git add src/utils/combat/triggers.ts src/utils/combat/playerTurn.ts src/utils/combat/__tests__/triggers.test.ts && git commit -m "feat(combat): enemy-buff + self-debuff conditions read live status (names only, no double-fold)"`

---

## Task 8: Emit the `attacked` event from the enemy intake

**Goal:** wire the Task-4 event so `on-attacked` actually fires in a real run.

**Files:**
- Modify: `src/utils/combat/engine.ts` (enemy branch intake, after the per-attack drain)
- Test: `src/utils/combat/__tests__/engine.test.ts`

- [ ] **Step 1: Write failing test.** An enemy attack on a tank that has an `on-attacked` reactive ability causes that ability to fire once that turn (e.g. a self-buff appears / a counter-debuff lands). `didCrit` set when the attack critted.
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.** Emit `{ type: 'attacked', targetId: healTarget.id, attackerId: actor.id, round: r, didCrit? }` at the existing per-attack seam (the same place the `damage-taken` procs run). The Task-4 listener enqueues; the existing drain point (`drainIntents()` at `engine.ts:1677`) executes the follow-up.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Byte-identical (no existing fixture has an `on-attacked` ability on the heal target).
- [ ] **Step 6: Commit.** `git add src/utils/combat/engine.ts src/utils/combat/__tests__/engine.test.ts && git commit -m "feat(combat): emit attacked event from enemy intake (on-attacked fires live)"`

---

## Task 9: Affinity (ii) + full-kit enemy in the healing adapter

**Goal:** enemy attackers attack with their affinity matchup vs the target; the adapter builds them with their full kit (not damage-only).

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:22-29` (`EnemyAttackerInput` gains `affinity?: AffinityName` — enemy attackers carry **no affinity fields today**, so this is net-new; the existing `:166-168` neutral block is the *focus healer's* affinity, not the attackers' — don't conflate), `:146` (`deriveTeamEngineActors`)
- Test: `src/utils/calculators/__tests__/healingEngineAdapter.test.ts`

- [ ] **Step 1: Write failing test.** An enemy attacker with `affinity` at advantage vs the target deals `+25%` damage vs neutral; the four affinity fields on the built enemy runtime come from `computeAffinityModifiers(enemyAffinity, targetAffinity)`. (Mind the matchup direction — verify against `computeAffinityModifiers`'s `(attacker, enemy)` argument order in `affinityUtils.ts:23-31`; the enemy is the attacker here.)
- [ ] **Step 2: Run red.** FAIL (neutral hardcoded).
- [ ] **Step 3: Implement.** Add `affinity` to `EnemyAttackerInput`. Resolve `computeAffinityModifiers(enemy.affinity, targetAffinity)` and pass the four fields into the enemy runtime instead of the hardcoded zeros. Build the enemy with full `shipSkills` (drop any damage-only filtering for enemy attackers). Pass `targetAffinity` through from the heal-target ship.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- healingGoldenParity` — existing fixtures supply **no `affinity`** → `computeAffinityModifiers(undefined, …)` returns neutral → byte-identical. Confirm. DPS untouched.
- [ ] **Step 6: Commit.** `git add src/utils/calculators/healingEngineAdapter.ts src/utils/calculators/__tests__/healingEngineAdapter.test.ts && git commit -m "feat(healing): enemy attacks use affinity matchup + full kit (neutral default unchanged)"`

---

## Task 10: Healing Calculator UI — affinity selector + enemy-effects round overview

**Goal:** users set each enemy attacker's affinity; the round overview shows the enemy's self-buffs and the debuffs/DoTs it applied to the target.

**Files:**
- Modify: `EnemyAttackersPanel` (locate via `grep -rn "EnemyAttackersPanel" src/`)
- Modify/Create: the healing round-overview component (reuse the DPS/healing per-round status display primitives)
- Test: component tests next to the components

- [ ] **Step 1: Write failing test.** `EnemyAttackersPanel` renders an affinity `Select` (use the existing `Select` / affinity selector primitive — `grep` for how the attacker/team cards render affinity) and calls the change handler with the chosen affinity. The round overview renders the enemy's active self-buffs + the target's debuffs/DoTs for a round given fixture round data.
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.** Add the affinity `Select` to each enemy attacker config (wire to the new `affinity` input). Extend the round overview to surface enemy self-buffs + target debuffs/DoTs from the per-round data. **Use existing `src/components/ui/` primitives only** (`Select`, `card` class, status/badge components) — no raw HTML form controls.
- [ ] **Step 4: Run green + lint.** `npm test -- EnemyAttackers` and `npm run lint`.
- [ ] **Step 5: Commit.** `git add <component paths + tests> && git commit -m "feat(healing): enemy attacker affinity selector + enemy-effects round overview"`

---

## Task 11: New golden scenarios for the new behaviour

**Goal:** lock the genuinely new behaviour with hand-built, hand-verified golden scenarios.

**Files:**
- Modify: `src/utils/calculators/__tests__/healingGoldenParity.test.ts` (the golden suites live under `calculators/__tests__/`, NOT `combat/__tests__/`)
- Test: the scenarios themselves

- [ ] **Step 1: Add scenarios** (hand-built `ab()` fixtures, NOT `buildShipAbilities`): (a) enemy applies a debuff + DoT to the tank + grants itself a self-buff; (b) affinity-advantage enemy damage; (c) `selfHpPct` gate activation — a below-40%-gated heal target dropping under threshold mid-fight; (d) an `enemy-buff` condition on a player firing off the enemy's self-buff; (e) `on-attacked` firing on the tank.
- [ ] **Step 2: Hand-derive** the expected numbers for each (document the arithmetic in a comment, as the existing healing goldens do). Run once to generate the snapshot, then **manually verify** each number against the hand-derivation before committing.
- [ ] **Step 3: Run green.** `npm test -- healingGoldenParity`.
- [ ] **Step 4: Commit.** `git add src/utils/calculators/__tests__/healingGoldenParity.test.ts src/utils/calculators/__tests__/__snapshots__/* && git commit -m "test(combat): golden scenarios for enemy full-kit, affinity, selfHpPct, on-attacked"`

---

## Task 12: Docs, changelog, coverage, handoff, memory

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 + §6 — mark 4a shipped; `on-attacked` live; single-target model; per-target keying; affinity symmetry; `attacked` event shape)
- Modify: `src/constants/changelog.ts` (fold into the **evolving** DPS/healing `UNRELEASED_CHANGES` entry — do not append many new array elements)
- Modify: `src/pages/DocumentationPage.tsx` if the Healing Calculator's in-app docs describe enemy attackers
- Create: `docs/superpowers/handoffs/2026-06-08-phase4b-handoff.md` (or update the Phase-4 handoff to mark 4a done, 4b next)
- Update memory `project-combat-engine-roadmap.md` after merge

- [ ] **Step 1:** Update the coverage doc §5/§6 per the spec's "Coverage-doc updates" section.
- [ ] **Step 2:** Add the user-facing changelog line(s) to the evolving combat-engine entry.
- [ ] **Step 3:** Update in-app docs if enemy-attacker behaviour is described there.
- [ ] **Step 4:** Commit docs (`git add -f` for `docs/` paths): `git commit -m "docs: Phase 4a coverage/changelog/handoff updates"`.

---

## Final verification (before PR)

- [ ] `npm test` — full suite green (~1530+ tests).
- [ ] `npm test -- dpsGoldenParity` — **22 DPS goldens byte-identical** (the referee).
- [ ] `npm run lint` — zero warnings.
- [ ] **Live-verify on the fleet** (dev server on **port 3000**; pages with 200+ ships exceed snapshot token limits → use `evaluate_script`, not full a11y snapshots): configure an enemy attacker that applies a debuff, pick a below-40%-gated heal target, confirm (a) the gate switches on as HP drops, (b) the tank accrues the enemy's debuff, (c) the round overview shows the enemy's self-buffs + the tank's debuffs, (d) affinity advantage raises enemy damage.
- [ ] Whole-branch review (@superpowers:requesting-code-review): empirically re-verify the load-bearing claims (damage parity through the unify, goldens byte-identical, no double-fold) — don't trust task reports.
- [ ] @superpowers:finishing-a-development-branch → PR. Run `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op. Babysit CodeRabbit to merge (merge commit; the npm-audit check can flake on the supabase postinstall — `gh run rerun <id> --failed`).
