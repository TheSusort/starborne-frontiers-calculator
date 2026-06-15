# Provoke Forced-Targeting — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm)
**Phase:** Positional combat follow-up to Phase 3 (forced targeting Taunt/Concentrate-Fire + stealth, PR #109). Its own PR — NOT part of Phase 4.
**Predecessors:** PR #105 targeting data foundation, PR #106 board geometry resolver, PR #108 positional target-selection (phase 2), PR #109 forced targeting + stealth (phase 3).

## 1. Goal

Add the third forced-targeting status — **Provoke** — to the positional engine, plus a uniform **"ignores Taunt/Provoke"** capability that Phase 3 left unmodeled.

- **Provoke** is a debuff on the **acting attacker** that forces it to target *whoever applied it*. This is structurally different from Taunt/Concentrate Fire (which are read off the opposing roster): Provoke is read off the acting actor's **own** debuffs, and the applier's id (`casterId`) is mapped to a living opposing actor.
- **Ignore** is an attacker capability ("This Unit's attack ignores Taunt and Provoke") that suppresses Taunt + Provoke redirection — but **not** Concentrate Fire (no game text mentions ignoring CF; ignore-ships are typically CF appliers themselves).

This is a **capability-only** change: no production caller passes board positions yet (the simulator, Phase 5, is the first), so existing DPS/healing goldens MUST stay **byte-identical** — the load-bearing safety invariant. If a golden moves, a gate leaked: fix the gate, never `vitest -u`.

## 2. Locked rules (from combat-system.md §9, user-ratified)

- **Forced-targeting priority:** `Concentrate Fire → Taunt → Provoke`, evaluated before column/pattern rules and before the stealth filter (forced targeting overrides stealth).
- **Provoke:** "That attacker must target the ship that applied the provoke."
- **Ignore covers Taunt + Provoke only**, never Concentrate Fire (user decision 2026-06-15). CF stays the highest-priority override even for ignore-ships.
- Provoke bypasses stealth, consistent with the other forced-targeting overrides (resolution happens at §9 step 3, before the step-4 stealth filter).

## 3. Verified facts (characterization, 2026-06-15, on `main`)

The critical open question — *is the provoker's identity retrievable at resolution time?* — is **YES**, confirmed end-to-end:

- An ability-sourced Provoke infliction stamps `casterId = applier's ownerId` at registration (`engine.ts:181` — the shared `base` object covers enemy-side timed statuses, not just self-side buffs).
- `applyTimedAbilityStatus` persists it onto the provoked actor's debuff store: `casterId: status.casterId` (`statusEngine.ts:962`), keyed by the provoked target's id.
- The read path surfaces it: `timedAbilityStatuses('enemy', undefined, provokedId)[].casterId` (`statusEngine.ts:1034`); `activeAbilityStatuses` likewise (`:990`/`:1011`).
- Guardian's reactive Provoke counter ("when an ally is critically hit, apply Provoke to that enemy") also carries `casterId: intent.ownerId` (`triggers.ts:830`).
- The existing name-only path (`ownerDebuffNamesFor`, `triggers.ts:662`) **discards** `casterId` → a new casterId-bearing query is required.
- Only **one** Provoke entry exists per target at a time (the family-overwrite rule keys on `'Provoke'`), so there is no multi-applier ambiguity; "last applied wins" falls out of the family rule naturally.
- `'Provoke'` is **not** a persistent-stacking buff, so it takes the normal timed path (no `PERSISTENT_STACKING_BUFFS` early-return at `statusEngine.ts:935`).
- `classifyEnemyEffect` (`skillTextParser.ts:95-98`) defaults unknown status names to `'debuff'`, so "applies Provoke for N turns" already lands enemy-side. (Plan must verify the real corpus parse produces a `casterId`-bearing enemy-side timed Provoke; the synthetic PR5 fixture already proved the engine machinery.)
- The 3 engine resolve sites have `actor.id` and `actor.position` available (`engine.ts:~2442/2555/2794`).

**Corpus (docs/ship-skills.csv):**
- Single-target Provoke appliers: Defiant, Guardian, Kafa, Lionheart, Morao, Orel, Sansi, Suku, Tycho, Warden + Guardian's reactive passive.
- AoE Provoke applier: **Vindicator** ("all enemies adjacent to the target") → multi-target, **deferred to Phase 4**.
- Condition-only readers (already handled by the PR5 gate path, not targeting): Panon, Rikra, Thresh.
- Ignore-ships (all ignore Taunt **and** Provoke, uniformly across active/charged/passive): Akula, Anjian, Huanying, Judge, Meiying, Stalwart, Valkyrie, Vanguard, Yuyan.
- Implant-sourced Provoke appliers exist (`constants/implants.ts`) — **out of engine scope**.

## 4. Architecture

### Key seam decision

`resolvePositionalTarget` stays a **pure** function (no `statusEngine` access — it gets `statusOf` for opposing actors only). The acting actor's two new facts are **pre-resolved by the engine** and passed in a small optional `acting` param.

*Rejected alternative:* querying the status engine inside the resolver. This would drag `statusEngine` into the pure geometry/targeting seam established by Phase 2/3 and break the clean boundary the Phase-5 simulator inherits.

### Components

1. **`provokerOf(statusEngine, actorId): string | undefined` — new read-only helper in `triggers.ts`.**
   Scans the actor's own enemy-side debuff store (`timedAbilityStatuses('enemy', undefined, actorId)` and `activeAbilityStatuses('enemy', …, undefined, actorId)`) for `buffName === 'Provoke'`; returns its `casterId`. Single entry expected (family-overwrite). Returns `undefined` if no Provoke is present or the entry carries no `casterId` (manual/scheduled application without caster identity → Provoke is inert and resolution falls through to normal targeting). Mirrors the read style of `buildForcedTargetingStatus`.

2. **`resolvePositionalTarget` extension (`positionalBinding.ts`).**
   New optional 5th param:
   ```ts
   acting?: { ignoresForcedTargeting?: boolean; provokedBy?: string }
   ```
   Resolution order inside the `statusOf` block:
   - **Concentrate Fire** — always (not ignorable). [unchanged]
   - **Taunt** — skipped when `acting?.ignoresForcedTargeting`. [Phase-3 block, now gated]
   - **Provoke (NEW)** — skipped when `acting?.ignoresForcedTargeting`; else if `acting?.provokedBy` is set AND an opposing living actor has `id === provokedBy`, return that actor (bypasses the stealth filter, like the other overrides). If the provoker is dead/absent, fall through.
   - **Stealth filter → `selectTargets`** — unchanged.

   When `acting` is omitted (and the existing omitted-`statusOf` / ally-side `return null` paths), behaviour is byte-identical to Phase 3.

3. **Ignore-flag plumbing.**
   Parser detects "ignores Taunt and Provoke" on the ship's skill texts (tag-stripped regex — texts contain `<unit-skill>Taunt</unit-skill>`; reuse the parser's existing tag-stripping). Emits a **per-ship boolean** (corpus-justified: every ignore-ship ignores uniformly across active/charged/passive — matches Phase 2's single-target-field grain; per-action is a future extension if a ship ever ignores on only one skill). Threaded like `position`/`target`: `CombatActor.ignoresForcedTargeting` + the actor-input types (`TeamActorEngineInput`, `EnemyActorInput`, inline enemy-attacker input), populated where actor capabilities derive (e.g. `buildShipAbilities` / actor construction).

4. **Engine wiring (3 `runPlayerTurn` resolve sites).**
   At each site compute:
   ```ts
   const acting = {
     ignoresForcedTargeting: actor.ignoresForcedTargeting,
     provokedBy: provokerOf(statusEngine, actor.id),
   };
   ```
   and pass it as the 5th arg to `resolvePositionalTarget`. focus + team resolve over `enemyAttackerActors`; enemy resolves over `allPlayerActors` (side-symmetric — the team-agnostic seam the simulator inherits). The provoker `casterId` always maps into the opposing roster by construction (the provoker is on the opposing side of the provoked attacker).

## 5. Testing

- **Resolver unit tests** (`positionalBinding`, stub `statusOf` + `acting`):
  - Provoked attacker → targets the provoker.
  - Provoker dead / not on board → inert, falls through to normal `selectTargets`.
  - `ignoresForcedTargeting` skips Taunt **and** Provoke, but **not** Concentrate Fire.
  - Priority: CF > Taunt > Provoke > stealth (e.g. both Taunt and Provoke active → Taunt wins; CF + ignore → CF still targets).
  - Provoke bypasses stealth.
- **`provokerOf` unit test:** a real timed Provoke debuff applied via the status engine → `casterId` surfaced; no Provoke → `undefined`; Provoke without `casterId` → `undefined`.
- **Parser test:** ignore detection across all 9 corpus ignore-ships + negative cases (a Provoke applier that does NOT ignore must not be flagged).
- **Integration test (through `runCombat`):** positioned actors, a real ship applies Provoke via its skill; verify the provoked actor's target resolves to the provoker. Exercises the `casterId` path end-to-end (the novel risk). Feasible because tests can pass positions. (Phase 3 lacked an e2e for CF/stealth because no applier existed; Provoke's applier exists, so this e2e is in scope.)
- **Golden parity:** DPS + healing goldens **byte-identical** (no production caller passes positions → the new code is dormant). Confirm byte-identical; hand-write any new locking scenario rather than `-u`.

## 6. Scope boundaries (deferred / out of scope)

- **Vindicator AoE Provoke** ("all enemies adjacent to the target") — multi-target → Phase 4 (multi-target AoE consequences + per-actor-per-side accounting).
- **Implant-sourced Provoke** (`constants/implants.ts`) — not modeled in the combat engine.
- **Ignore-of-Concentrate-Fire** — out by user decision; CF remains the top override even for ignore-ships.
- **Manual/scheduled Provoke without `casterId`** — inert (documented); the simulator's appliers are ability-sourced.
- **Per-action ignore granularity** — per-ship boolean suffices for the current corpus; revisit only if a ship ignores on only one of active/charged.

## 7. Workflow notes

- `docs/` is gitignored → `git add -f` for this spec; docs-only commits use `--no-verify` (pre-commit hook runs the full vitest suite).
- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge/API op.
- Subagent-driven implementation with per-task spec+quality reviews + a final holistic review, per the established combat-engine workflow.
- One evolving `UNRELEASED_CHANGES` changelog entry for combat work — fold, don't append.
