# Positional Per-Victim Stored-Damage Resolution — Completion — Design

**Date:** 2026-06-27
**Status:** Approved (design); spec under review
**Epic:** Combat realism — positional battle sim. Direct follow-up to the positional
per-victim **detonation** spec (`2026-06-27-positional-per-victim-detonation-design.md`,
PR1 #168 / PR2 #169 / PR3 #170).

## Problem

The detonation epic (PR1–PR3) made **skill-triggered** detonation land per-victim at the focus
attacker site (PR1, player→enemy), the timed-burst enemy site (PR2, per positioned enemy), and
the enemy-attacker skill site (PR3, enemy→player). Three stored/continuous-damage gaps remain —
the siblings PR3 explicitly flagged as deferred. Mapped against the four turn-branch sites:

| Mechanic | focus attacker | walked-team | focus-dummy / anchor | enemy-attacker |
|---|---|---|---|---|
| Skill detonation | ✓ PR1 | **✗ — Feature A** | n/a (legacy) | ✓ PR3 |
| Timed bombs / accumulators | **✗ — Feature B** | **✗ — Feature B** | ✓ legacy | ✓ PR2 |
| DoT ticks (`tickDoTs`) | **✗ — Feature C** | **✗ — Feature C** | ✓ anchor only | partial (heal-target only) |

1. **Walked-team skill detonation (A).** The walked-team branch (`engine.ts:4618`) drives the
   per-victim firing hit (`drivePositionalApply`) but has **no** per-victim detonation loop. The
   positional-hint gate (`engine.ts:3667`) excludes walked-team players, so they stay on the
   legacy `detonate()` → `creditDamage(actor.id,'detonation', teamTurn.detonationDamage)` aggregate
   path (`engine.ts:4761`) against the **anchor**. A positioned ally's stored bombs/DoTs detonate
   against the wrong target and can't kill positioned footprint victims. This is the deferred
   "4th loop" — and PR3 deferred the shared-helper extraction "to when the 4th site lands."

2. **Positioned-player timed bursts (B).** PR2 lifted timed `processBombs`/`processAccumulators`
   to each **positioned enemy** (`engine.ts:4886`). The symmetric player case — a positioned
   player carrying **enemy-seeded** timed bombs/accumulators bursting them on its own turn via
   `playerSink` — was never added. The player attacker + walked-team branches never burst their
   own timed containers.

3. **DoT ticks (C).** `tickDoTs` runs only on the anchor enemy (`engine.ts:4807`) and the
   heal-target (`engine.ts:4264`). DoT/bomb **application** lands on the parsed primary target
   `tgt` (a real positioned victim's own containers, via `runPlayerTurn`), so positioned victims
   **do** accumulate their own DoT containers — but:
   - A positioned **enemy** that received player DoTs never ticks them (the anchor focus-dummy is
     the empty `legacyVictim` in positional; the enemy-attacker branch has no `tickDoTs`).
   - A **non-heal-target** positioned player that received enemy DoTs never ticks them (the
     enemy footprint targets `allPlayerActors`, not just the heal target).
   DoT ticks were explicitly carved out of PR1–PR3 — this is a genuinely new per-victim mechanic,
   and it hits the same `cumulativeDamage` / line-5326 crux seam detonation did.

## Goal

Complete per-victim resolution of **all** stored/continuous damage across **all four** turn-branch
sites, both directions — each footprint victim resolves its own stored containers against its own
`currentHp` via `applyVictimDamage`, so detonation/bursts/ticks can kill positioned victims and
fire per-victim death/reactives — honoring the engine team-symmetry rule (a ship behaves
identically on either side).

## Locked decisions (inherited from the parent epic + ratified 2026-06-27)

- **Approach A** — route each victim's payout through the existing per-victim sink
  `applyVictimDamage` (HP/shield/Barrier/Cheat-Death/death/per-victim reactives +
  `roundPerTargetDamage` come free). Not re-litigated.
- **No role-scale** — origin and covered footprint victims detonate/burst/tick the **full** stored
  stacks. Bombs/DoTs are not affinity/AoE-role-scaled; only direct hits are.
- **Both directions, symmetric** — player→enemy AND enemy→player, per
  team-symmetry.
- **Per-type apply flags** — bomb = full shield drain, **no penetration** (`bombPortion=full`,
  `shieldPenetrationPct:0`); inferno/corrosion = **bypass** shield (`byDirectDamage:false`),
  detonating-attacker scalars, corrosion `baseHp = min(victimHp, 500_000)`; accumulator =
  bomb-style full-drain.
- **Golden discipline** — hand-validate **every** positional delta; **never** `vitest -u`; run the
  **whole** `npm test` suite for the audit (fixtures live outside `src/utils/combat` too); each PR
  byte-identical for non-positional goldens.

This spec covers three stacked PRs (A→B→C), each stacked on PR3's branch
(`feat/combat-positional-detonation-pr3-enemy`, #170).

---

## PR-A — Walked-team skill detonation + shared-helper extraction

**Decision:** refactor-first, then add the walked-team site.

### Commit 1 — byte-identical refactor

The per-victim skill-detonation loop currently exists as two near-identical copies — the focus
block (`engine.ts:4494-4547`) and the PR3 enemy block — differing only by the sink
(`enemySink`/`playerSink`) and recipe source. Extract into one helper:

```
applyPerVictimDetonation({ recipe, victims, sink, actorId, bus, round, tb,
                           perActorDetonation, roundPerTargetDamage })
```

The body is the existing loop verbatim: skip victims dead to the firing hit (`currentHp <= 0`);
`detonateContainers` against each victim's own containers + `tb.victimMaxHpFor(victim)`; apply
bomb (`byDirectDamage:true, bombPortion:result.bomb, shieldPenetrationPct:0`) and
inferno+corrosion (`byDirectDamage:false`) via `applyVictimDamage(_, victim, sink, …)`; emit
per-victim `bomb-detonated` / `dot-detonated`; record `roundPerTargetDamage[victim.id]` and
`perActorDetonation[actorId]`. The focus and PR3 enemy blocks call it. **Zero golden movement.**

### Commit 2 — walked-team site (new behavior)

- **Widen the positional-hint gate** (`engine.ts:3667`) from
  `(a.id === focusActorId || a.side === 'enemy')` to also include positioned walked-team players,
  so a walked-team ally's `runPlayerTurn` returns `positional:true` (skips `detonate()`, returns
  the recipe, `detonationDamage=0`). Verify (as PR3 did) that `positional:true` *only* swaps
  `detonate()` for the recipe build.
- In the walked-team branch (`engine.ts:4618`), collect `detonationTargets` in the existing
  `drivePositionalApply` `onVictimResolved` hook (mirror the focus site), then call
  `applyPerVictimDetonation` with the walked-team `actor` as `actorId`, `enemySink`, and
  `teamTurn.positionalDetonation` as the recipe.
- **Suppress the aggregate detonation credit** at `engine.ts:4761` for the positional case — move
  `creditDamage(actor.id,'detonation', teamTurn.detonationDamage)` into the existing
  `if (!teamPositional)` block, exactly as the focus site moved it into `if (!positional)`.
  Non-positional keeps the legacy `detonate()` credit → byte-identical.

After PR-A, skill detonation is per-victim at all four sites.

### Tests
`perVictimWalkedTeamDetonation.integration.test.ts` (mirror `perVictimEnemyDetonation`): seed
bombs/inferno/corrosion on covered + origin footprint victims of a **walked-team ally**'s cast;
assert each detonates full against its own HP; covered victim killed → death + bomb-splash chain;
credit per applier; per-victim events; non-positional regression pin (positional surfaces
`detonationDamage` aggregate as before for legacy path). Refactor commit guarded by the full
existing detonation suite staying byte-identical.

---

## PR-B — Positioned-player timed bursts

The byte-for-byte mirror of PR2 (`engine.ts:4886-4978`) on the **player** side: a positioned
player carrying **enemy-seeded** `pendingBombs`/`pendingAccumulators` bursts them on its own turn
via `playerSink`.

### Sites & placement
Player attacker branch (`engine.ts:4331+`) and walked-team branch (`engine.ts:4631+`), at the
**start** of the turn body (right after `firstActivatorId ??=`), **inside** the `!isTurnBlocked`
stasis gate — same placement PR2 used for the enemy.

- **Gate:** `(actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0) &&
  isPositional(actor.position, enemyAttackerActors)`. Strict no-op (byte-identical) for every
  existing fixture — none seed player-actor timed containers.
- **Route:** `applyVictimDamage(dmg, actor, playerSink, …)` + `roundPerTargetDamage[actor.id]` +
  `perActorDetonation[sourceId]` (applier-keyed, matching PR2). **Never**
  `creditDamage(…,'detonation')` (that feeds `cumulativeDamage` → the focus-dummy HP overwrite →
  double-hit).
- **Flags:** bomb = full-drain/no-pen; accumulator = bomb-style full-drain.
- **Dead-after-burst guard:** keys on `actor.destroyedRound !== undefined` (the PR2 lesson —
  *not* `currentHp > 0`, since bare actors carry `currentHp 0`), with the `healTarget` carve-out
  mirroring the top-of-turn guard. For the **focus attacker**, a lethal self-burst must still
  `pushSynthesizedFocusSkipTurn()` so the round assembles; walked-team needs no focus synthesis.

### Open sub-decision (ratified) — accumulator gather input
PR2's enemy accumulator gathers `allPlayersDirect` (round-global player-direct sum). The clean
symmetric counterpart for a player-carried accumulator would be an all-enemies-direct sum, which
the engine doesn't expose as a tidy value, and **no fixture/known ability applies accumulators to
players**. Decision: spec the **bomb** path concretely; reuse the same `allPlayersDirect`
expression for the player-side accumulator with an inline `// symmetric input TBD — inert, no
fixture` note, keeping B a true structural mirror of PR2 without inventing an enemy-direct sum
nothing exercises.

### Tests
`perVictimPlayerTimedDetonation.integration.test.ts` (mirror `perVictimTimedDetonation`): seed
timed bombs on a positioned player (focus + walked-team); assert they burst against its own HP on
its own turn via `playerSink`; lethal burst → death/splash; non-positional regression pin;
`isPositional`-gate negative pin (proven non-vacuous by flipping the gate).

---

## PR-C — Per-victim DoT ticks (both sides)

DoTs tick at the afflicted ship's turn-start. PR-C makes every positioned victim tick its own
containers at its own turn-start. **Highest-risk PR** (touches the heavily-golden heal-target path
+ the cumulativeDamage seam) — `Task 0` resolves the seam before any apply lands.

### Canonical per-victim turn-start order
`tickDoTs → processBombs → processAccumulators` (matching the focus-dummy at
`engine.ts:4807→4827→4848`). So the DoT tick runs **before** PR-B's player timed block and before
PR2's enemy timed block.

### Task 0 (blocking) — the cumulativeDamage seam
The focus-dummy `tickDoTs` (`engine.ts:4807`) credits `creditDamage(sourceId, dotType, dmg)`, and
that channel feeds `cumulativeDamage` → the line-5326/5432 HP overwrite. Per-victim must **stop
feeding** that for positioned victims (else double-drain) — the exact detonation seam. Task 0
verifies precisely which channels feed 5326, and confirms the display story (the DPS DoT
breakdown — `dot-inferno`/`dot-corrosion` totals — must still reflect per-victim ticks for the
focus actor without feeding HP twice), mirroring how detonation split display (`perActorDetonation`
+ `roundPerTargetDamage`) from HP (`applyVictimDamage`) with the aggregate credit suppressed.

### C.1 — player→enemy (positioned enemies)
Add `tickDoTs` at the enemy-attacker turn-start (`engine.ts:4880+`), ahead of the PR2 timed block,
on `actor`'s own `corrosionEntries`/`infernoEntries`:
- HP via `applyVictimDamage(dmg, actor, enemySink, { byDirectDamage:false })` (DoTs bypass shield);
  per-applier ctx via `lastTurnCtxByActor`; corrosion `baseHp = recipientMaxHp(actor.id)`.
- Display via `roundPerTargetDamage[actor.id]` + a per-victim DoT display path (the channel handling
  Task 0 confirms); **no** `creditDamage` feed into `cumulativeDamage`.
- Per-victim `dot-ticked` events (own `targetId`/payout); `expireStacks` inside `tickDoTs` ages
  that victim's entries on its own turn.
- Gate: positioned enemy with non-empty DoT containers → strict no-op otherwise.

### C.2 — enemy→player (unify the heal-target path)
**Decision:** unify. Replace the heal-target special case (`engine.ts:4248-4312`) with **one**
per-victim DoT-tick path that runs for every positioned player at its turn-start (attacker +
walked-team prologues):
- Routes via `playerSink`/`applyIncomingToTarget` (`byDirectDamage:false`); per-applier ctx;
  corrosion `baseHp = recipientMaxHp(victim.id)`; per-victim Vortex Veil `incomingDotReductionPct`
  (the existing heal-target query, now keyed per victim).
- **Heal-target preserved as a branch of the unified path:** `tankDotSnapshot` (display),
  `tankDotDamage` → incoming healing accounting, and the post-tick dead-target re-skip
  (`handleDeadTargetSkip`) all still fire when the victim *is* the heal target. Non-heal-target
  positioned players get the tick (new behavior) with damage to their own HP only.
- **Double-tick guard is structural:** a single path keyed per turning actor ticks each victim
  exactly once.

### Out of scope (carried forward)
Per-victim **new** DoT/bomb application stays primary-target (`tgt`) only — application is a
separate concern; per-victim ticking is meaningful regardless (containers accumulate on the
primary target across rounds/attackers).

### Tests
`perVictimDotTick.integration.test.ts`: (C.1) seed inferno+corrosion on a non-focus positioned
enemy → ticks against its own HP at its own turn (corrosion uses its own HP); lethal tick → death.
(C.2) seed enemy DoTs on a non-heal-target positioned player → ticks at its turn; heal-target
still ticks once with healing-accounting/snapshot/dead-skip intact (the unification regression).
Plus the **E5-symmetry pin**: the same DoT carrier ticks identical per-victim integers/events as
player vs enemy. Non-positional + DPS-mode regression pins (focus-dummy/heal-target paths
byte-identical where positional doesn't apply).

---

## Risks & sequencing

- **PR-A** is lowest risk (refactor is provably inert; the new site mirrors PR3).
- **PR-B** is low risk (strict no-op gate; mirror of PR2).
- **PR-C** is highest risk: Task 0 (the cumulativeDamage seam) is blocking, and the heal-target
  unification touches the most-golden path. Land it last.
- Stack: A on #170, B on A, C on B — continuing the established stack. If the upstream stack
  (#165–#170) is slow to merge, the new PRs can rebase forward as each upstream lands.

## Key file references
- `src/utils/combat/engine.ts:3667` — positional-hint gate (PR-A widens it for walked-team).
- `src/utils/combat/engine.ts:4494-4547` — focus per-victim detonation loop (PR-A extracts it).
- `src/utils/combat/engine.ts:4618-4796` — walked-team branch (PR-A new site; PR-B player timed;
  PR-C player DoT tick).
- `src/utils/combat/engine.ts:4761` — walked-team aggregate detonation credit (PR-A suppresses).
- `src/utils/combat/engine.ts:4331+` — focus attacker branch (PR-B player timed; PR-C player DoT).
- `src/utils/combat/engine.ts:4248-4312` — heal-target DoT-tick prologue (PR-C unifies it).
- `src/utils/combat/engine.ts:4807-4853` — focus-dummy `tickDoTs`/`processBombs`/
  `processAccumulators` (PR-C order reference; the cumulativeDamage-feed crux).
- `src/utils/combat/engine.ts:4880-4978` — PR2 per-positioned-enemy timed burst (PR-B mirror;
  PR-C.1 ticks before it).
- `src/utils/combat/engine.ts:5326/5432` — `cumulativeDamage` → `enemy.currentHp` overwrite (the
  PR-C Task 0 seam).
- `src/utils/combat/__tests__/perVictimLeech.test.ts`,
  `perVictimEnemyDetonation.integration.test.ts`,
  `perVictimTimedDetonation.integration.test.ts` — test-harness templates.
