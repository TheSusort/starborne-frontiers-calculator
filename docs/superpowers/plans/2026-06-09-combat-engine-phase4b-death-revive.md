# Combat Engine Phase 4b — Death & Revive Modeling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model death and revive on the shared `runPlayerTurn` pipeline — general all-actor `ship-destroyed` events + three death triggers, Cheat Death (survive at 1 HP, consume, wipe removable statuses), a `cheat-death-activated` follow-on trigger, an explicit removability concept, and a reactive extra-action bridge (Sokol/Liberator/Harvester).

**Architecture:** `ship-destroyed` generalizes from the heal-target-only emission to any actor reaching 0 HP (per-actor `destroyedRound` on `PlayerActorRuntime`). Three triggers (`on-destroyed`, `on-ally-destroyed`, `on-enemy-destroyed`) join `LIVE_TRIGGERS` and register on `ship-destroyed` via the existing `registerReactiveListeners` pattern. Cheat Death is a recognized **named buff** (`CHEAT_DEATH_BUFFS`): the engine intercepts the lethal moment in `applyIncomingToTarget` (and the generalized death path) — survive at 1 HP, consume the buff, clear removable statuses, emit `cheat-death-activated`. Removability is a new StatusEngine flag (`UNREMOVABLE_STATUSES` + permanent/persistent-stack classification) with a `clearRemovable` method. The reactive extra-action bridge adds an `extra-action` executor branch that registers a pending grant with the engine's per-round `processExtraActionGrants` queue. DPS + healing goldens stay byte-identical (the new triggers consume events that had no consumer before).

**Tech Stack:** TypeScript, Vitest (golden parity suites are the referee), React + TailwindCSS (editor trigger-select note only).

**Spec:** `docs/superpowers/specs/2026-06-09-combat-engine-phase4b-death-revive-design.md`

---

## Conventions for every task

- **TDD:** write the failing test first, run it red, implement minimally, run it green, commit.
- **Goldens are sacred.** Run `npm test -- dpsGoldenParity healingGoldenParity` after every behavioural task. The **22 DPS goldens must stay byte-identical** every task; healing goldens stay byte-identical until Task 12 deliberately adds a Cheat-Death scenario. **Never `vitest -u`.** The golden suites are **synthetic** (`ab()` literals, no parser import) and nothing in them subscribes to the new triggers, so NO task should produce a diff — investigate any diff as a regression. The only legitimate snapshot WRITE in this whole plan is Task 12's deliberate NEW healing scenario (a fresh snapshot, not a regeneration of an existing one).
- **Determinism:** listeners are PURE (enqueue only); the engine/executor is the sole mutator. No `Math.random`/`Date.now`. No RegExp lookbehind in `src/` (iOS Safari 15). The engine core NEVER compares the literal `'attacker'` — use the `isEnemySide` predicate / actor ids.
- **Commits:** stage explicit per-file paths (`git add <path>` — never `git add -A`; a sibling agent may share the tree). Pre-commit runs the full suite (~2 min) + ESLint zero-warnings. **No `--no-verify` for code commits** (docs-only commits may skip).
- **Branch:** `feat/combat-engine-phase4b-death-revive` (create at execution start: `git switch -c feat/combat-engine-phase4b-death-revive`). The spec + this plan are already committed to `main`.
- **`gh auth switch --user TheSusort`** before any PR/gh operation. Dev server runs on `:3000`.
- Reference @superpowers:test-driven-development and @superpowers:verification-before-completion.
- **Test-file locations are indicative, not literal.** There is no single `engine.test.ts`. Engine/turn behaviour is split across `src/utils/combat/__tests__/` (`engine.events.test.ts`, `triggers.test.ts`, `statusEngine.test.ts`, `healing.test.ts`, `extraActions.test.ts`, `state.test.ts`, …). Golden parity suites live under `src/utils/calculators/__tests__/` (`dpsGoldenParity.test.ts`, `healingGoldenParity.test.ts`). For each task, `grep -rln "<symbol>" src/utils/combat/__tests__ src/utils/calculators/__tests__` to find the right file, or create a focused new one.

## File structure (what changes, and why)

- `src/types/abilities.ts` — add `on-enemy-destroyed` + `on-cheat-death-activated` to `AbilityTrigger`; add all four death/revive triggers to `LIVE_TRIGGERS` (promote the two existing annotation-only ones). (Task 1)
- `src/utils/combat/events.ts` — generalize `ship-destroyed` doc-contract to all actors; add `cheat-death-activated`. (Task 2)
- `src/utils/combat/cheatDeathBuffs.ts` (**new**) — `CHEAT_DEATH_BUFFS` + `UNREMOVABLE_STATUSES` name-sets. (Task 3)
- `src/utils/combat/statusEngine.ts` — `unremovable` derivation + `clearRemovable(id)` method. (Task 3)
- `src/utils/combat/state.ts` — per-actor `destroyedRound` on `PlayerActorRuntime`. (Task 4)
- `src/utils/combat/engine.ts` — general all-actor `ship-destroyed` emission via a shared helper; Cheat Death intercept in `applyIncomingToTarget` + the general death path; reactive extra-action grant hook. (Tasks 4, 7, 10)
- `src/utils/combat/triggers.ts` — three death-trigger listeners; `on-cheat-death-activated` listener; `extra-action` executor branch + `grantExtraAction` ctx delegate. (Tasks 5, 8, 10)
- `src/utils/skillTextParser.ts` — Cheat Death grant parse; Salvation on-destroyed heal; Yazid activated follow-on; `EXTRA_ACTION_DISQUALIFY_RE` removals + extra-action trigger detection. (Tasks 6, 8, 9, 10)
- `src/utils/abilities/buildShipAbilities.ts` — emit the above with correct triggers. (Tasks 6, 8, 9, 10)
- editor trigger-select note (wherever the Trigger options + live/annotation note live — `grep -rln "LIVE_TRIGGERS\|Trigger" src/components`). (Task 11)
- `docs/skill-model-coverage.md`, `src/constants/changelog.ts`. (Task 11)
- Golden suites + new Cheat-Death healing scenario. (Task 12)

---

## Task 1: Trigger union + `LIVE_TRIGGERS` additions

**Goal:** the type layer recognizes all death/revive triggers as live. No behaviour yet (no listeners registered until Tasks 5/8/10) — but `partitionReactiveAbilities` will now route abilities carrying these triggers into the reactive partition, so this task MUST keep goldens byte-identical (no existing parsed ability carries these triggers yet).

**Files:**
- Modify: `src/types/abilities.ts:31-66`
- Test: `src/utils/combat/__tests__/triggers.test.ts` (or `src/types/__tests__` if one exists)

- [ ] **Step 1: Write failing test.** Assert `LIVE_TRIGGERS.has('on-destroyed')`, `…('on-ally-destroyed')`, `…('on-enemy-destroyed')`, `…('on-cheat-death-activated')` are all `true`, and that `AbilityTrigger` includes `'on-enemy-destroyed'` / `'on-cheat-death-activated'` (type-level: a `const x: AbilityTrigger = 'on-enemy-destroyed'` compiles).
- [ ] **Step 2: Run red.** `npm test -- triggers` → FAIL (`on-enemy-destroyed` not in set).
- [ ] **Step 3: Implement.** Add `'on-enemy-destroyed'` and `'on-cheat-death-activated'` to the `AbilityTrigger` union. Add all four (`on-destroyed`, `on-ally-destroyed`, `on-enemy-destroyed`, `on-cheat-death-activated`) to the `LIVE_TRIGGERS` set. Update the doc comment above `AbilityTrigger`/`LIVE_TRIGGERS` (no longer "on-destroyed/on-ally-destroyed are annotation-only").
- [ ] **Step 4: Run green.** `npm test -- triggers` → PASS.
- [ ] **Step 5: Guard goldens.** `npm test -- dpsGoldenParity healingGoldenParity` → byte-identical (no parsed ability carries the new triggers yet).
- [ ] **Step 6: Commit.** `git add src/types/abilities.ts src/utils/combat/__tests__/triggers.test.ts && git commit -m "feat(combat): promote death/revive triggers to LIVE_TRIGGERS"`

---

## Task 2: Events — generalize `ship-destroyed`, add `cheat-death-activated`

**Goal:** the event contract covers all actors + the new activation event. Additive only.

**Files:**
- Modify: `src/utils/combat/events.ts:122` (`ship-destroyed` doc) + the `CombatEvent` union
- Test: `src/utils/combat/__tests__/events.test.ts`

- [ ] **Step 1: Write failing test.** The event bus carries a `{ type: 'cheat-death-activated', actorId: 'tank', round: 2 }` event to a registered listener; and a `ship-destroyed` event with an arbitrary `actorId` (e.g. a team id) round-trips (documents the generalized contract).
- [ ] **Step 2: Run red.** `npm test -- events` → FAIL (`cheat-death-activated` not in union).
- [ ] **Step 3: Implement.** Add `| { type: 'cheat-death-activated'; actorId: string; round: number }` to `CombatEvent`. Update the `ship-destroyed` doc comment: emitted once per actor when its HP first reaches 0 (was heal-target/enemy-only).
- [ ] **Step 4: Run green.** `npm test -- events` → PASS.
- [ ] **Step 5: Guard goldens.** byte-identical.
- [ ] **Step 6: Commit.** `git add src/utils/combat/events.ts src/utils/combat/__tests__/events.test.ts && git commit -m "feat(combat): add cheat-death-activated event; generalize ship-destroyed contract"`

---

## Task 3: Removability — `UNREMOVABLE_STATUSES`, `CHEAT_DEATH_BUFFS`, `clearRemovable`

**Goal:** a new name-set module + a StatusEngine method that removes all **removable** buffs/debuffs for one id while preserving unremovable ones (permanent/persistent-stack + `UNREMOVABLE_STATUSES`).

**Files:**
- Create: `src/utils/combat/cheatDeathBuffs.ts`
- Modify: `src/utils/combat/statusEngine.ts` (stores around `:401-413`; add `clearRemovable`; extend the `StatusEngine` interface ~`:96-185`)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

**Background:** the StatusEngine keeps per-owner self maps (`selfMaps`, `accumSelfMaps`, `persistentSelfMaps` at `:401-413`) and per-target enemy maps (`enemyMaps`, `accumEnemyMaps`, persistent-enemy). Persistent stacks use `turnsRemaining: 'permanent'`. `PERSISTENT_STACKING_BUFFS` is already imported (`:4`).

- [ ] **Step 1 (module):** Create `cheatDeathBuffs.ts`:
```ts
/** Named buffs that grant a one-shot death-intercept (Cheat Death). Recognized by the
 *  engine's lethal-damage resolver; carried as no-payload buffs in the StatusEngine. */
export const CHEAT_DEATH_BUFFS: ReadonlySet<string> = new Set(['Cheat Death']);

/** Named statuses that survive a cleanse/purge/Cheat-Death wipe. Persistent-stacking
 *  debuffs (Defense Shred/Blast/Overload/Titanite) are unremovable by construction
 *  (handled via the persistent-stack classification); this set names any ADDITIONAL
 *  unremovable effects. Extend from game data as identified. */
export const UNREMOVABLE_STATUSES: ReadonlySet<string> = new Set<string>([]);
```
- [ ] **Step 2: Write failing tests** for `clearRemovable`: (a) a timed self-buff + a timed enemy-debuff applied to id `'tank'` are both gone after `clearRemovable('tank')`; (b) a persistent-stack debuff (e.g. `Defense Shred`) on `'tank'` is PRESERVED; (c) a buff named in `UNREMOVABLE_STATUSES` (temporarily inject one in the test) is preserved; (d) `clearRemovable` on an unknown id is a no-op.
- [ ] **Step 3: Run red.** `npm test -- statusEngine` → FAIL (no `clearRemovable`).
- [ ] **Step 4: Implement.** Add `clearRemovable(id: string): void` to the `StatusEngine` interface + closure. It deletes, for that id, all entries in the timed/recurring self + enemy maps EXCEPT: entries with `turnsRemaining === 'permanent'`, persistent-stack entries, and entries whose `buffName ∈ UNREMOVABLE_STATUSES`. (Helper: `isUnremovable(buffName, turnsRemaining)` reused later by 4e.) Do NOT touch the `'always'`/aura source lists (those re-derive each round from ship data — a wipe of standing applied statuses is the model; auras re-applying next round is acceptable and documented).
- [ ] **Step 5: Run green.** `npm test -- statusEngine` → PASS.
- [ ] **Step 6: Guard goldens.** byte-identical (method is unused until Task 7).
- [ ] **Step 7: Commit.** `git add src/utils/combat/cheatDeathBuffs.ts src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts && git commit -m "feat(combat): removability flag + StatusEngine.clearRemovable + CHEAT_DEATH_BUFFS set"`

---

## Task 4: General all-actor `ship-destroyed` + per-actor `destroyedRound`

**Goal:** any actor reaching 0 HP emits `ship-destroyed` once; `destroyedRound` lives on each runtime. Dead-is-dead (skip turns, no heals) extends to all actors. Today only the heal target + enemy emit.

**Files:**
- Modify: `src/utils/combat/state.ts:81-124` (`PlayerActorRuntime`: add `destroyedRound?: number`)
- Modify: `src/utils/combat/engine.ts` (`applyIncomingToTarget` ~`:1498-1513`; enemy HP path ~`:2342`; team/dead-skip guards ~`:1666`)
- Test: `src/utils/combat/__tests__/engine.events.test.ts` (or `state.test.ts`)

- [ ] **Step 1: Write failing test.** In a healing-mode run where the tank dies, exactly one `ship-destroyed{actorId: tankId}` is emitted and the runtime's `destroyedRound` is set. (Assert the EXISTING behaviour still holds — this is mostly a refactor to a shared helper, so the test guards the generalization rather than driving new behaviour.) Add a second assertion: a synthetic actor seeded to 0 HP via a shared `recordDestroyed(runtime, round)` helper emits exactly once even if called twice.
- [ ] **Step 2: Run red.** FAIL (helper absent / `destroyedRound` not on runtime).
- [ ] **Step 3: Implement.** Add `destroyedRound?: number` to `PlayerActorRuntime`. Extract a `recordDestroyed(runtime, round, bus)` helper that sets `runtime.destroyedRound` (once) and emits `ship-destroyed{actorId: runtime.actor.id, round}`. Route `applyIncomingToTarget`'s first-reach-0 block AND the enemy HP path through it. Keep the healing-mode `healTargetDestroyedRound` reporting reading from the heal target's runtime field. Verify dead-skip guards key on `runtime.destroyedRound`/`currentHp <= 0` per actor, not a single target. **Scope note:** the only actor that actually floors mid-combat in this increment is the heal target — the enemy floors only at post-round assembly (Task 10 Path B) and team allies never take damage until 4d. So keep the generalization minimal (a per-actor field + shared helper); do NOT build speculative multi-actor death-skip paths no test can exercise yet.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** byte-identical (same emissions, same destroyed rounds; helper is a pure refactor).
- [ ] **Step 6: Commit.** `git add src/utils/combat/state.ts src/utils/combat/engine.ts src/utils/combat/__tests__/engine.events.test.ts && git commit -m "feat(combat): general all-actor ship-destroyed via recordDestroyed helper + per-actor destroyedRound"`

---

## Task 5: Death-trigger listeners (`on-destroyed`, `on-ally-destroyed`, `on-enemy-destroyed`)

**Goal:** the three triggers register on `ship-destroyed` following the existing listener pattern (`triggers.ts:159-258`), pure/enqueue-only.

**Files:**
- Modify: `src/utils/combat/triggers.ts:162-255` (`registerReactiveListeners` switch)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

- [ ] **Step 1: Write failing test.** With owner `'A'` registered for each trigger in turn, emitting `ship-destroyed{actorId}` enqueues:
  - `on-destroyed`: exactly one intent when `actorId === 'A'`, none otherwise.
  - `on-ally-destroyed`: one intent when `actorId` is another player id (not `'A'`, not enemy-side per `isEnemySide`), none for `'A'`'s own death or an enemy death.
  - `on-enemy-destroyed`: one intent when `isEnemySide(actorId)`, none for a player death.
- [ ] **Step 2: Run red.** `npm test -- triggers` → FAIL (cases fall through to `default`).
- [ ] **Step 3: Implement.** Add three `case`s, each `bus.on('ship-destroyed', (e) => { … enqueue(intent) })` with the scoping above (mirror `on-crit`/`on-ally-crit`/`on-attacked` exactly — own-id, ally `!== owner && !isEnemySide`, enemy `isEnemySide`). Pure.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** byte-identical (no parsed ability carries these triggers yet — that lands in Tasks 9/10).
- [ ] **Step 6: Commit.** `git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts && git commit -m "feat(combat): live on-destroyed/on-ally-destroyed/on-enemy-destroyed listeners"`

---

## Task 6: Parse Cheat Death grants

**Goal:** "grants Cheat Death [to all allies]" (active), the Hermes conditional, and Yazid/Tycho start-of-combat passive grants parse as no-payload `buff` abilities (`buffName: 'Cheat Death'`).

**Files:**
- Modify: `src/utils/skillTextParser.ts` (buff/skill-grant parse path — `grep -n "grants\|<unit-skill>\|resolveBuffClause" src/utils/skillTextParser.ts`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (buff emission)
- Test: `src/utils/abilities/__tests__/` parser tests (`grep -rln "buildShipAbilities\|skillTextParser" src/utils/abilities/__tests__ src/utils/__tests__`)

**Background:** the `<unit-skill>Cheat Death</unit-skill>` token names a granted skill/buff. Today it is not extracted as an ability. The persistent/until-triggered nature → emit with a non-decrementing duration so it does not self-expire.

- [ ] **Step 1: Write failing tests.** Parsing each text emits a `buff` ability with `buffName: 'Cheat Death'`, empty stat payload, correct target, and a persistent (non-expiring) duration:
  - Hayyan charged: "grants Cheat Death to all allies" → target `all-allies`.
  - Yazid 2nd-passive: "At the start of combat, this Unit gains … Cheat Death" → target `self`.
  - Hermes charged: "If the target has less than 40% HP, it grants Cheat Death" → target self/ally with the existing HP-conditional attached.
- [ ] **Step 2: Run red.** parser test → FAIL.
- [ ] **Step 3: Implement.** Recognize the `Cheat Death` skill-grant in the buff parse path, keyed off `CHEAT_DEATH_BUFFS` (import from `cheatDeathBuffs.ts`). Emit a `buff` ability with no `ParsedBuffEffects` stat payload and a persistent duration. Attach existing conditional/target machinery (start-of-combat passives → assume-active `on-cast`, consistent with current passive handling).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Run `dpsGoldenParity healingGoldenParity`. **Expect byte-identical — investigate ANY diff as a bug.** The golden suites build abilities **synthetically** via `ab({…})` literals and do NOT import the parser / `buildShipAbilities` (verified: 75 `ab(` uses, zero parser imports). So this parser-only change cannot reach any golden. A diff here means something else broke — do NOT regenerate; find the cause.
- [ ] **Step 6: Commit.** `git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <parser test> && git commit -m "feat(combat): parse 'grants Cheat Death' as a no-payload named buff"`

---

## Task 7: Cheat Death intercept in the engine

**Goal:** at the lethal moment, a carrier of a `CHEAT_DEATH_BUFFS` buff survives at 1 HP, consumes the buff, wipes removable statuses, emits `cheat-death-activated`, and does NOT die.

**Files:**
- Modify: `src/utils/combat/engine.ts` (`applyIncomingToTarget` ~`:1498-1513` + the general death path from Task 4)
- Test: `src/utils/combat/__tests__/healing.test.ts` (or a new `cheatDeath.test.ts`)

**Ordering (spec, canonical):** HP would reach 0 → **(1)** carrier has Cheat Death & not spent? → HP = 1, consume buff, `statusEngine.clearRemovable(actorId)`, emit `cheat-death-activated{actorId, round}`, STOP (no `recordDestroyed`). **(2)** else → `recordDestroyed` (Task 4) → `ship-destroyed` → death listeners.

- [ ] **Step 1: Write failing tests** (healing mode, tank carries Cheat Death):
  - A lethal hit leaves the tank at **1 HP** (not destroyed); no `ship-destroyed`, `destroyedRound` unset; a `cheat-death-activated` event fires once.
  - The Cheat Death buff is **consumed**: a SECOND lethal hit destroys the tank normally (`ship-destroyed` + `destroyedRound`).
  - A timed self-buff + a timed enemy DoT on the tank are **gone** after activation (clearRemovable ran); a persistent-stack debuff is preserved.
  - A tank WITHOUT Cheat Death dies normally (regression guard — existing behaviour).
- [ ] **Step 2: Run red.** FAIL (no intercept).
- [ ] **Step 3: Implement.** In `applyIncomingToTarget`, before the `wasAlive && currentHp <= 0` death block: read the target's active buff names via `statusEngine.snapshot(healTarget!.id).activeSelfBuffs` (there is **no** pre-existing local snapshot inside `applyIncomingToTarget` — call the method; confirm the snapshot field name against `statusEngine.ts` `:127-185`) and intersect with `CHEAT_DEATH_BUFFS`. If present → set `currentHp = 1`, remove the Cheat Death buff from the StatusEngine self store (a targeted remove, or rely on `clearRemovable` NOT touching it then remove explicitly — Cheat Death must be consumed regardless of its removable classification), call `clearRemovable(targetId)`, emit `cheat-death-activated`, and `return` the intake result WITHOUT recording destroyed. Apply the same guard in the general death path. Reuse for the enemy path only if an enemy can carry Cheat Death (rare; safe to include via the shared helper).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** byte-identical (no existing fixture grants the tank Cheat Death; DPS enemy never carries it).
- [ ] **Step 6: Commit.** `git add src/utils/combat/engine.ts <test> && git commit -m "feat(combat): Cheat Death intercept — survive at 1 HP, consume, wipe removable statuses"`

---

## Task 8: `cheat-death-activated` follow-ons (Yazid repair + Barrier)

**Goal:** a `on-cheat-death-activated` listener + parser for "once per battle, when Cheat Death activates, repairs X% … and gains Barrier" (Yazid) and Tycho's Barrier. Rides the existing `heal`/`buff` reactive executors; the repair is once-per-combat.

**Files:**
- Modify: `src/utils/combat/triggers.ts` (listener + a once-per-combat guard)
- Modify: `src/utils/skillTextParser.ts` + `buildShipAbilities.ts` (parse the activated clause)
- Test: `src/utils/combat/__tests__/triggers.test.ts` + parser test + `healing.test.ts`

**Drain point (spec):** the follow-ons must drain BEFORE the engine continues resolving the interrupted attack — same drain point the death path uses. Implement the intercept (Task 7) so `cheat-death-activated` is emitted, then the intent drain runs, before the intake returns.

- [ ] **Step 1: Write failing tests.**
  - Parser: Yazid 2nd-passive activated clause → a `heal` ability (self, % Max HP) + a `buff` ability (`buffName: 'Barrier'`, no payload) both on `on-cheat-death-activated`; Tycho → Barrier buff on the same trigger.
  - Listener: a `cheat-death-activated{actorId: 'A'}` enqueues the owner-`'A'` activated abilities once; another owner's activation does not fire `'A'`'s.
  - Once-per-combat: two activations fire the repair only ONCE.
  - Engine: after Task-7 activation, the tank's HP rises by the repair % (above 1 HP) and a `Barrier` buff name is present (effect unmodeled).
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.** Parser: recognize the "when Cheat Death activates" clause → emit `heal` + `buff` abilities with `trigger: 'on-cheat-death-activated'`; carry "once per battle" as an ability flag the executor honours. Listener: `bus.on('cheat-death-activated', (e) => { if (e.actorId === ownerId) enqueue(intent) })`. Once-per-combat: a per-(owner,abilityId) `Set` that is **combat-scoped, NOT round-scoped**. ⚠️ Do not place it like `extraActionFired` (engine.ts:1547), which is declared INSIDE the round loop and resets each round. The combat-lifetime set must be owned by the engine outside the round loop and threaded through `IntentExecContext` (the ctx is rebuilt per drain, so the set must live above it). `heal`/`buff` need no new executor branch.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** byte-identical (DPS mode: heal/buff reactives are inert via the healing-ctx-off guard; Barrier unmodeled).
- [ ] **Step 6: Commit.** `git add src/utils/combat/triggers.ts src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <tests> && git commit -m "feat(combat): cheat-death-activated follow-ons (Yazid repair + Barrier, once-per-combat)"`

---

## Task 9: Salvation `on-destroyed` ally-heal

**Goal:** "When this Unit is destroyed it repairs X% of its max HP to all allies" parses as a `heal` ability (target `all-allies`, basis caster max HP) on `on-destroyed`; rides the existing heal reactive executor.

**Files:**
- Modify: `src/utils/skillTextParser.ts` + `buildShipAbilities.ts` (heal parse path — already supports caster-max-HP basis + all-allies)
- Test: parser test + `src/utils/combat/__tests__/healing.test.ts`

- [ ] **Step 1: Write failing tests.** Parser: Salvation passive "When this Unit is destroyed it repairs 80% of its max HP to all allies" → a `heal` ability, `target: 'all-allies'`, basis caster max HP, `trigger: 'on-destroyed'`. Engine: when a Salvation actor with damaged allies dies (synthetic fixture: seed a teammate below max HP), the `on-destroyed` listener enqueues the heal and allies gain HP that round.
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.** Recognize the "When this Unit is destroyed it repairs … to all allies" clause → emit a `heal` ability with `trigger: 'on-destroyed'`. The Task-5 listener + existing heal executor do the rest. Note in the test that in standard healing mode allies are undamaged → the heal is inert (the synthetic fixture proves the wiring).
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Expect byte-identical — the golden suites are synthetic (`ab()`, no parser import), so this parser-only change cannot reach them. Investigate ANY diff as a bug; do not regenerate.
- [ ] **Step 6: Commit.** `git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <tests> && git commit -m "feat(combat): Salvation on-destroyed ally-heal (rides heal reactive executor)"`

---

## Task 10: Reactive extra-action bridge (Sokol / Liberator / Harvester)

**Goal:** `extra-action` becomes routable from a death listener into the engine's per-round `processExtraActionGrants` queue (once-per-round). Parse Sokol/Liberator/Harvester triggers; Liberator's charge-to-allies rides the existing charge executor.

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` ~`:265-340` add `grantExtraAction` delegate; `executeIntent` ~`:557+` add an `extra-action` branch; `ReactiveAbilityType` ~`:36-54` add `'extra-action'`)
- Modify: `src/utils/combat/engine.ts` (wire `grantExtraAction` to a per-round reactive-grant buffer applied via `processExtraActionGrants` ~`:1549`)
- Modify: `src/utils/skillTextParser.ts:1066-1072` (`EXTRA_ACTION_DISQUALIFY_RE`) + trigger detection
- Modify: `src/utils/abilities/buildShipAbilities.ts:979-997` (extra-action emission: trigger from the parsed clause)
- Test: `src/utils/combat/__tests__/extraActions.test.ts` + parser test

- [ ] **Step 0 (RESOLVE FIRST — timing differs by death path; the recommended model below is verified against the engine).** The two reactive-death paths have **different timing** and need different bridges. Write this analysis as a comment block in `engine.ts` before implementing, and make the tests assert the round in which each effect lands.

  **Path A — during-turn deaths (`on-destroyed` self, `on-ally-destroyed` ally → Harvester).** These fire from `applyIncomingToTarget` / the general death path, which run DURING an actor's turn (enemy attack / DoT tick). They are followed by `drainIntents()` at engine.ts:2220 while the round-local `queue`/`qi` are still live. So an extra-action grant CAN splice into the current round via the existing `processExtraActionGrants(qi, granter, grants)`. Bridge: the engine exposes `ctx.grantExtraAction(granter, abilityId, oncePerRound)` which calls `processExtraActionGrants(currentQi, granter, …)`. ⚠️ `currentQi` must be a **round-scoped mutable cursor** updated at the top of each `for (qi…)` iteration — NOT a lexical closure over the loop binding (`drainIntents` is defined at :1583, above the loop at :1663, and is also called pre-loop at :1661 where `qi` doesn't exist). Define `let currentQi = -1` at round scope; the pre-loop drain never enqueues a death-triggered extra action (no `ship-destroyed` at round start), so a sentinel value there is harmless. (Harvester is dormant in healing mode until 4d — allies don't take damage — but the wiring + a synthetic-fixture test land here.)

  **Path B — post-round enemy death (`on-enemy-destroyed` → Sokol, Liberator).** The enemy is a cumulative-damage wall whose death is reconciled at engine.ts:2329-2345 — AFTER the turn loop closed (2258) and after the round's last `drainIntents()` (2220). There is NO live `queue`/`qi` and no drain at that point (verified). So:
    1. Add a `drainIntents()` call immediately after the enemy `ship-destroyed` emit at :2345 (`drainIntents` is round-scoped — defined :1583 — so it is callable here). This lets `on-enemy-destroyed` **charge** reactives (Liberator's "all allies add 1 charge") apply immediately; the gained charges carry into the next round → correct.
    2. Extra-action grants from `on-enemy-destroyed` have no queue to splice this round. Model them as a **cross-round pending grant**: `grantExtraAction` (path B variant) pushes onto an engine-owned `pendingExtraActions` buffer; at the START of the next round's queue construction, the granter is inserted one extra time into that round's queue (respecting once-per-round). **Document explicitly:** the on-kill extra action lands the round AFTER the kill is registered — a deliberate, faithful-enough model given the enemy's death is computed post-round in this DPS sim. (The enemy dies exactly once, so this fires at most once.)
- [ ] **Step 1: Write failing tests.**
  - Parser: Sokol 3rd-passive "grants one extra end of round action upon a kill, once per round" → `extra-action` ability, `trigger: 'on-enemy-destroyed'`, `oncePerRound: true` (no longer disqualified). Liberator R4 → `on-enemy-destroyed` extra-action + a `charge` ability (all-allies) on `on-enemy-destroyed`. Harvester → `on-ally-destroyed` extra-action.
  - Executor/engine (Path B): in a DPS run where the enemy dies in round R, a Sokol attacker gains one extra action in round **R+1** (cross-round pending grant; assert the landing round explicitly, per Step 0). Liberator: all player actors' charges increase starting the round the enemy dies (charge reactive drains via the post-:2345 `drainIntents`). The enemy dies once → the grant fires at most once.
  - Harvester (Path A): synthetic fixture — a teammate dies DURING an enemy turn → Harvester gains one extra action in the SAME round via the live-queue splice (proves `on-ally-destroyed` wiring; dormant in normal healing mode).
- [ ] **Step 2: Run red.** FAIL.
- [ ] **Step 3: Implement.** Remove `upon a kill`, `when an enemy dies`, `killing an enemy`, `allied unit is destroyed`, `ally is destroyed` from `EXTRA_ACTION_DISQUALIFY_RE` (keep `\bpurg` — Tithonus stays deferred to 4e). Detect the trigger from the clause (`/upon a kill|when an enemy dies|killing an enemy/i` → `on-enemy-destroyed`; `/allied unit is destroyed|ally is destroyed/i` → `on-ally-destroyed`). Emit the `extra-action` ability with that trigger (default stays `on-cast`). Liberator's "all allies add 1 charge" emits a `charge` ability (all-allies) on `on-enemy-destroyed`. Add `'extra-action'` to `ReactiveAbilityType` + the executor branch calling `ctx.grantExtraAction`. Wire the engine buffer + flush per Step 0.
- [ ] **Step 4: Run green.** PASS.
- [ ] **Step 5: Guard goldens.** Run `dpsGoldenParity healingGoldenParity`. **Expect byte-identical — investigate ANY diff as a bug.** The golden suites are synthetic (`ab()` literals, no parser import — verified), so the parser changes here cannot reach them. The engine/executor bridge is purely additive: the new `extra-action` executor branch + `on-enemy-destroyed`/`on-ally-destroyed` listeners fire only on events that no golden fixture's synthetic abilities subscribe to (no `ab()` carries the new triggers). The added post-:2345 `drainIntents()` must be a no-op when no `on-enemy-destroyed` listener is registered — confirm that. If a golden shifts, it is a regression (likely the extra `drainIntents` having a side effect, or a listener mis-scoped) — find the cause; do NOT regenerate. New behaviour is proven by the Task-10 unit tests, not by golden diffs.
- [ ] **Step 6: Commit.** `git add src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <tests> && git commit -m "feat(combat): reactive extra-action bridge — Sokol/Liberator on-kill, Harvester on-ally-destroyed"` (no goldens regenerated — they must be byte-identical).

---

## Task 11: Docs — coverage doc, changelog, editor trigger note

**Goal:** close §6 items 9a/9b; document the dormant Harvester path, unmodeled Barrier, and the removability concept; user-facing changelog; editor trigger-select note.

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 Phase-4a block → add a Phase-4b block; §6 items 9a/9b marked closed; note removability + dormant Harvester + Barrier unmodeled)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES` — healing/combat entry, plain English: "ships with Cheat Death now survive a lethal hit", "on-kill / on-ally-destroyed effects modeled")
- Modify: editor trigger-select note component (the three new triggers appear with a live/annotation note)
- Test: changelog has a build/lint guard; editor note has component tests if present

- [ ] **Step 1: Update `docs/skill-model-coverage.md`** — add the Phase-4b block to §5; mark §6 9a (Sokol) + 9b (Harvester) closed (Tithonus 9c still 4e); document removability + UNREMOVABLE_STATUSES + Barrier-unmodeled.
- [ ] **Step 2: Add the `UNRELEASED_CHANGES` entry** in `changelog.ts`.
- [ ] **Step 3: Update the editor trigger-select** so `on-enemy-destroyed`/`on-cheat-death-activated` (and the promoted on-destroyed/on-ally-destroyed) appear with the correct live note. `grep -rln "LIVE_TRIGGERS\|trigger" src/components` to locate.
- [ ] **Step 4: Lint + full suite.** `npm run lint && npm test` → clean.
- [ ] **Step 5: Commit.** `git add docs/skill-model-coverage.md src/constants/changelog.ts <editor file> && git commit -m "docs(combat): Phase 4b coverage, changelog, editor trigger note"` (use `git add -f` for the gitignored coverage doc).

---

## Task 12: Golden verification + Cheat-Death healing scenario

**Goal:** a deliberate new healing golden proving tank survival via Cheat Death; final whole-suite green.

**Files:**
- Modify: healing golden fixtures/scenarios (`src/utils/calculators/__tests__/healingGoldenParity.test.ts` + its fixtures)
- Test: the golden suite itself

- [ ] **Step 1: Add a healing scenario** where the tank carries Cheat Death and takes otherwise-lethal damage — assert it survives (HP floors at 1 then any repair), records no `destroyedRound`, and the run continues. Generate the golden once (new snapshot, not a regeneration).
- [ ] **Step 2: Run the full suite.** `npm test` → all green; `npm run lint` → zero warnings.
- [ ] **Step 3: Verify the 22 DPS goldens are byte-identical.** They are synthetic (`ab()`, no parser import) and nothing subscribes to the new triggers in those fixtures — there is NO acceptable diff here. Investigate any diff as a regression; do not regenerate a DPS golden.
- [ ] **Step 4: Commit.** `git add <healing fixtures/goldens> && git commit -m "test(combat): Cheat-Death tank-survival healing scenario; final Phase 4b golden verification"`

---

## Done criteria

- [ ] All four death/revive triggers live; the three death listeners + `on-cheat-death-activated` registered and tested.
- [ ] Cheat Death: survive at 1 HP, consume, re-grantable, removable-status wipe (unremovable preserved).
- [ ] Yazid/Tycho follow-ons fire (repair once-per-combat; Barrier name-only).
- [ ] Salvation on-destroyed ally-heal wired (synthetic fixture proves it).
- [ ] Reactive extra-action bridge: Sokol/Liberator closed in DPS mode; Harvester wired-dormant; Liberator charge-to-allies works.
- [ ] 22 DPS goldens byte-identical (no exceptions — synthetic fixtures, nothing subscribes to the new triggers); healing goldens byte-identical + one new Cheat-Death scenario.
- [ ] Coverage doc §6 9a/9b closed; changelog + editor note updated.
- [ ] Full suite green, ESLint zero warnings, no `--no-verify` on code commits.

## Out of scope (deferred — do not build)

- Targeting / multi-enemy / death-fallback re-targeting (4d) — activates the dormant Harvester path.
- Cleanse/purge consumption, control effects, damage-reduction/reflect (4e) — reuse `clearRemovable` + the removability flag.
- Barrier shield simulation, Everliving Regeneration HoT simulation (named buff-grants fire; effects unmodeled).
- Tithonus purge-count extra action (§6 item 9c → 4e).
