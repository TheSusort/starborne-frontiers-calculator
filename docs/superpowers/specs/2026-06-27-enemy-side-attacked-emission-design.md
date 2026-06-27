# Enemy-side `attacked` emission — design

**Date:** 2026-06-27
**Epic:** combat-realism (extends sub-project G — reactive counterattacks)
**Status:** design, pending spec review
**Prereqs shipped:** sub-project G PR1+PR2 (player-side counterattacks, #163/#164); team-agnostic reactive routing (`registerReactiveListeners` per-side `isOpposing`, `grantExtraAction` over combined `allActorsById`, locked by `enemyReactiveRouting.test.ts`); the `attacked` event with `didCrit`/`damage`/`isPrimaryTarget`/`shieldWasHit`; the positional two-team battle sim (`simulateBattle` → `runCombat`, positional player→enemy apply via `drivePositionalApply`).

## Goal

Make **enemy ships react when they are directly hit by the player**, mirroring how player ships already react to enemy hits. Today the combat sim emits the `attacked` event in exactly **one** direction — enemy→player (`engine.ts:5093–5108`, the enemy-turn body). When the **player attacks an enemy**, damage is applied but **no `attacked` event is emitted**, so every enemy `on-attacked` / `on-ally-attacked` reactive is silently inert.

This sub-project adds the symmetric **player→enemy** emit. Because routing and every reactive executor are already team-agnostic, that single emit lights up **all** enemy `on-attacked` reactives at once — the three counterattackers (Stalwart / Nyxen / Centurion) **and** the broader family (Second Wind, Tenacity, Reactive Ward, Smokescreen, Firewall, Lockdown, Last Stand, …). The headline user-facing win is **enemy-side counterattacks**, delivered as part of making enemy teams react realistically to being hit.

## Scope decision (user-ratified)

**Broad, not counter-only.** The emit is a shared signal; it cannot selectively wake only counters without a bespoke divergence from the symmetric player-side path. We embrace the full behavior: enemy teams now react to being hit, exactly as player teams do.

**Symmetric — and this PR makes the `shieldWasHit` signal symmetric too.** The two directions must behave the same way. The existing enemy→player emit is **focus-victim-only, per-hit**; the new player→enemy emit matches that exactly, and per-covered-victim (splash) emission stays deferred on **both** sides.

**Pre-existing asymmetry this PR closes (user-ratified):** today `shieldWasHit` on the enemy→player emit is computed **only on the non-positional path** (`engine.ts:4989` binds `{shieldBefore,hpDamage,barriered}`; the positional enemy-attack branch leaves them `0` → `shieldWasHit` always `false`, per the comment at `engine.ts:5089-5090`). Because the two-team sim runs enemy attacks **positionally**, **player-side Nyxen's shield-hit counter is effectively inert in the positioned sim today.** The new player→enemy emit computes `shieldWasHit` from the positional per-victim outcome, so enemy Nyxen would work — creating a real asymmetry. To avoid that, this PR **also populates `shieldWasHit` on the enemy→player positional path** (from its existing per-victim `onVictimResolved` capture), so **both** Nyxens work in the positioned sim. This stays byte-identical (no golden fixture equips Nyxen).

## Where this lives: the positional two-team sim

Critical context discovered during design (corrects an earlier assumption of a generic "player-turn branch"):

- `simulateBattle` (`src/utils/calculators/battleSimulator.ts:594`) → `runCombat` (`engine.ts:1160`) builds the enemy team as **real `CombatActor`s** (`engine.ts:1737` `enemyAttackerActors`), each with its own `currentHp`/`shieldPool`/`position`, included in `allActorsById` and **registered as a reactive owner** via `registerReactiveListeners({ perOwner: enemyReactivePerOwner, … })` (`engine.ts:2196`).
- `simulateBattle` threads `position` + `target` + `pattern` for every actor (`battleSimulator.ts:652-654/689-691/739-741`), so the per-turn **positional** branch fires (`engine.ts:4386-4390`) whenever a ship has parseable targeting. **The two-team sim runs player→enemy attacks through the positional path by default.**
- The positional player→enemy apply is `drivePositionalApply(…)` → `applyToVictim = applyOutgoingToEnemy` (`engine.ts:3536` binding, `~3215` impl, wrapping `applyVictimDamage`). It mutates each real enemy victim's HP/shield/Barrier and surfaces a per-victim `{ shieldBefore, hpDamage, barriered }` outcome through the existing `onVictimResolved(victim, dmg, outcome, didCrit)` callback (`positionalApply.ts:187-189`, outcome shape `positionalApply.ts:30-34`).
- The focus attacker calls `drivePositionalApply` at `engine.ts:~4395`; the walked-team attacker at `engine.ts:~4552`. **Both** already pass an `onVictimResolved` (today only for per-victim leech).

**Out-of-scope paths (correct, not a gap):** the **non-positional/legacy** path folds player damage into a scalar accumulator applied to a single **indestructible synthetic `enemy` sink** (`engine.ts:1268`, `5241-5242`) with no per-victim shield outcome, and the **DPS/single-enemy page** always uses that sink. The synthetic sink is **not** a real reactive owner, so emitting there would be meaningless. Enemy-side counters are therefore a **positioned-two-team-sim feature** — which is exactly where they matter.

## Locked rules (user-ratified)

1. **Symmetric, focus-victim-only, per-hit emit.** Emit `attacked` for the **origin/focus** enemy victim of the attack, one event per hit (driven by the attacker's `hitCrits`), exactly as the enemy→player emit does. Covered/splash victims do not emit (deferred both sides).
2. **Positional two-team sim only.** The emit fires on the positional player→enemy apply path. The legacy-accumulator and DPS paths do not emit (synthetic sink, not a reactive owner) — documented, expected.
3. **Direct weapon hits only.** DoT ticks, bomb detonations, and accumulator damage never emit `attacked` — preserved.
4. **No new reactive logic.** Only the emit is added; routing/executors are already team-agnostic. No listener/executor/helper changes.
5. **No ping-pong, both directions.** Counters/reflect apply via the no-event `applyVictimDamage` path (`isCounter`/`isReflected` cause; `applyVictimDamage` emits only `hp-changed`/`cheat-death-activated`, never `attacked`). So an enemy counter hitting a player can't re-trigger the player's counters, and vice-versa. Recursion bounded at depth 1, symmetric.
6. **Once-per-attack guard unchanged.** Keyed `${ownerId}:${ability.id}`, combat-scoped, cleared at each actor turn-start. Owner-keyed ⇒ isolates enemy owners. Focus-victim-only ⇒ no `${ownerId}` switch.
7. **Not byte-identical — deliberate two-team behavior change.** Goldens whose **enemy** team contains an `on-attacked` ship (and that run positionally) will move. Moves are **audited for directional sanity**, never `vitest -u`'d blindly.

## Architecture (Approach B — shared `emitAttacked` helper, symmetric both directions)

### Step 1 — Extract `emitAttacked(...)` (byte-identical refactor)

Pull the per-hit emit logic out of the enemy-turn branch (`engine.ts:5085-5108`: `hitOutcomes = enemyHitCrits.length ? enemyHitCrits : [enemyTurnDidCrit]`, looped into `bus.emit({ type: 'attacked', … })`) into one helper:

```
emitAttacked({ bus, round, targetId, attackerId, hitOutcomes, isPrimaryTarget, shieldWasHit, damage })
```

It emits one `attacked` per entry in `hitOutcomes` (with `didCrit` set per entry; `damage`/`isPrimaryTarget`/`shieldWasHit` folded in conditionally exactly as today). Call it from the (unchanged) enemy-turn branch. **Zero golden movement** — verified by the full suite before any new emit is wired.

### Step 2 — Wire the player→enemy emit (the behavior change)

At the two positional player-attack sites (`engine.ts:~4395` focus, `~4552` team):
- In the existing `onVictimResolved(victim, dmg, outcome, didCrit)` callback, **capture the focus victim's outcome.** `onVictimResolved` does **not** expose the victim's role, so the focus victim is identified by `victim.id === tgt.id`, where `tgt` is the pre-resolved focus target from `selectTurnTarget(actor)` (`engine.ts:~4323` focus / `~4507` team). Covered victims are ignored for emission (symmetric focus-only). **Multi-hit semantics:** `drivePositionalApply` re-anchors per hit (`positionalApply.ts:158-168`), so if the focus victim dies on hit 1 it captures nothing for later hits — i.e. **first-hit-focus** semantics, which matches the enemy side's single-`tgt` behavior (`engine.ts:5099`). Capture `shieldWasHit`/`damage` from the focus victim's hit; if it was never the live victim (already dead / fully evaded), emit nothing.
- **After `drivePositionalApply` returns**, call `emitAttacked(...)` with:
  - `targetId` = the focus enemy victim's id (a real enemy `CombatActor`, registered in `enemyReactivePerOwner` → the event is heard);
  - `attackerId` = the acting player actor;
  - `hitOutcomes` from the player turn's `hitCrits` (`turn.hitCrits` / `teamTurn.hitCrits`, same empty → `[roundCrit]` fallback as the enemy side);
  - `isPrimaryTarget: true`;
  - `shieldWasHit` from the captured outcome — **identical formula** to the player-victim side: `!outcome.barriered && outcome.shieldBefore > 0 && outcome.hpDamage < damage`;
  - `damage` = the per-attack aggregate dealt to the focus enemy victim.

If no enemy victim was hit (no damage ability / fully evaded / target already dead), emit nothing (mirror the enemy side's `damage > 0`/empty-`hitCrits` handling).

### Step 3 — Make the enemy→player positional `shieldWasHit` real (close the asymmetry)

Today the enemy→player emit reads `shieldWasHit` from `{shieldBefore,hpDamage,barriered}` bound only on the **non-positional** branch (`engine.ts:4989`); the **positional** enemy-attack branch (which the two-team sim actually uses) leaves them `0`, so player Nyxen never counters there. The positional enemy branch already has the per-victim outcome in hand — its `onVictimResolved` runs `procTakenLeechesPerVictim(victim, dmg, outcome)` (`engine.ts:~4985`). Capture the **focus player victim's** outcome there (same `victim.id === tgt.id` rule as Step 2) and feed `shieldWasHit` into the enemy→player `emitAttacked(...)` call — instead of the current non-positional-only computation. The non-positional branch keeps its existing aggregate `{shieldBefore,hpDamage,barriered}` computation as the fallback. Net effect: **both directions compute `shieldWasHit` from the focus victim's per-hit outcome on the positional path** (same formula, now a symmetric source), and player Nyxen works in the positioned sim. Byte-identical (no fixture equips Nyxen).

### Why it works without routing changes

`registerReactiveListeners` is invoked for both sides; executors/helpers are team-agnostic (locked by `enemyReactiveRouting.test.ts`). An enemy `on-attacked` reactive uses the **same tested code path** as its player-side counterpart — it was only missing the event. The counter-back direction already works: `applyCounterAttack` picks `sink = attacker.side === 'player' ? playerSink : enemySink` (`engine.ts:~3294`), so an enemy counter damages the **player** attacker via `playerSink` — already surfaced on player HP curves (no new surfacing).

## New signals

**None.** The `attacked` event already carries `didCrit`, `damage`, `isPrimaryTarget`, and `shieldWasHit` (G PR1/PR2). This sub-project only *produces* the event in the second direction.

## Out of scope (YAGNI / deferred)

- **Per-covered-victim (splash) emission** — deferred on **both** sides (preserves symmetry). When it lands, the once-per-attack guard switches to `${ownerId}` (the in-code comment from G PR2 in `buildShipAbilities.ts`).
- **Non-positional / DPS-page emit** — the synthetic indestructible `enemy` sink is not a real reactive owner; emitting there is meaningless and omitted.
- **New reactive logic / fixing half-wired enemy reactives.** Only the emit is added. If the audit reveals an enemy reactive behaving oddly, it's a **follow-up**, not fixed here — unless it crashes on the enemy path.
- **DoT/bomb/detonation-triggered reactions** — `attacked` stays direct-weapon-hit-only.

## Testing & golden strategy

- **Commit 1 (refactor) is byte-identical.** Extracting `emitAttacked` and calling it from the unchanged enemy-turn branch must move **zero** goldens — full suite green is the gate.
- **Commit 2 (new emit) is NOT byte-identical** — a deliberate two-team change. Every moved golden is **audited** for directional sanity (enemy HP higher where Second Wind / Reactive Ward fire; the player attacker dented or killed where an enemy counter fires; enemy buffs/charge where the relevant reactive applies). **Never `vitest -u` blindly.** The plan enumerates up front which fixtures have enemy-side `on-attacked` ships that run positionally, so the moved set is known before running.
- **Harness (important):** enemy-side reactions must be tested with the **positional two-team harness** (`twoTeamBattle.test.ts` / `positionalDamage.integration.test.ts` style — player fires positionally at a real enemy actor with a `position` + `target` + `pattern` + a damage skill), **not** G's existing `counterAttack.integration.test.ts` `counterBase` healing harness (that drives the enemy→player direction only and routes the player's own counter directly into `enemySink` without an `attacked` emit).
- **New tests — mirror the counters + one representative reactive (user-ratified):**
  - Enemy **Stalwart** counters the player attacker when hit as its primary target.
  - Enemy **Nyxen** counters only when the player hit reduced its shield (give the enemy Nyxen a live shield); not when fully penetrated / no shield. (Feasible — `shieldWasHit` is computed per-victim on the positional path.)
  - **Player Nyxen** (the Step 3 fix): in the positional two-team sim, a player Nyxen with a live shield counters a **positional** enemy attacker when its shield is hit — proving the enemy→player positional `shieldWasHit` now fires (this is the direction that was inert before).
  - Enemy **Centurion** retaliates when itself or an adjacent **enemy** ally is directly damaged (positional adjacency), once per attack.
  - One representative non-counter case: an enemy **Second Wind** repairs itself when it takes a critical hit — proving the general enemy `on-attacked` path is live.
  - All assert the cross-team direction: a **player** positional attack drives the enemy reactive, and an enemy counter's damage lands on the **player** attacker.
- **Everything else** relies on the shared, already-tested team-agnostic executors (player-side coverage + `enemyReactiveRouting.test.ts`) plus the golden audit — no per-reactive mirror test.
- **Gates:** `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills` (141/0) all clean; full suite green with the moved goldens explicitly audited.

## PR shape

**Single PR, two commits** — the new-emit half is inherently all-or-nothing (the emit can't be staged per-reactive):
1. **Byte-identical foundation:** extract `emitAttacked` helper + call from the enemy-turn branch, AND switch the enemy→player `shieldWasHit` to the positional per-victim capture (Step 3). Both byte-identical (no Nyxen fixture) — full suite green is the gate.
2. **Behavior change:** wire the player→enemy positional emit + enemy-side mirror tests (+ the player-Nyxen positional test) + audited goldens + changelog + docs.

## Open items for the plan phase

- **Confirm `emitAttacked` placement** for the team-walk site (`engine.ts:~4552`): each walked-team actor runs one `drivePositionalApply` per its own turn with its own `selectTurnTarget` → one emit per turn, focus-only; the plan confirms no wrapping loop causes a double-emit.
- **Confirm the player turn's `hitCrits`** is the right per-hit list (empty → `[roundCrit]` fallback) at both sites (`turn.hitCrits` `engine.ts:4397`, `teamTurn.hitCrits` `engine.ts:4554`; `runPlayerTurn` returns it, `playerTurn.ts:2071`).
- **`emitAttacked` signature** — pass a precomputed `shieldWasHit: boolean` (both directions now compute it from their captured focus-victim outcome on the positional path; the enemy side keeps its non-positional aggregate as the fallback), keeping the helper direction-agnostic.
- **Enumerate the golden churn:** list fixtures whose enemy team contains an `on-attacked` ship AND runs positionally, and which enemy reactives newly fire, so the audited moved set is known up front.
- **Verify no enemy-path crash** for any reactive firing for the first time (extra-action, cleanse, buff-protection grants) — routing is resolved, but the audit should confirm no enemy reactive assumes player-only context.

(Resolved during design: `onVictimResolved` does NOT expose role → focus victim matched by `victim.id === tgt.id` with first-hit-focus semantics — see Architecture Steps 2–3.)
