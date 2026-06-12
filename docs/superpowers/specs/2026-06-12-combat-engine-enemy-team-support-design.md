# Combat Engine — Enemy-Team Support (revised Phase 4d)

**Date:** 2026-06-12
**Status:** Approved (brainstorming) — pending spec review + user review
**Branch (planned):** `feat/combat-engine-enemy-team-support` (off post-#101 main)
**Predecessors:** Phase 4a (full enemy actor walk), 4c PR 2 (player ally-buff routing), 4c PR 6 (Chakara `lowest-speed-ally`)
**Coverage doc:** `docs/skill-model-coverage.md` §6 "Enemy-team support (follow-up after 4d)"

---

## 1. Background & motivation

The original Phase 4d was scoped as "targeting/positional (3×4 hex, front/back/skip, AoE) + multi-enemy + death-fallback retargeting + Harvester dormant trigger + dead-recipient filtering." The positional/attack-pattern model requires in-game board data the user has not yet gathered, so the targeting core is **deferred**.

This document re-scopes the near-term increment to **enemy-team support**: the part of the original plan that is genuinely independent of positional/targeting data. It is motivated by a concrete bug the user reproduced (2026-06-12): *"Chakara configured as an enemy attacker in the healing calculator shows no buffs."* Enemy attackers' own reactive abilities (e.g. Chakara's `start-of-round` lowest-speed-ally Attack Up / Defense Up self-buffs) never fire, and there is no way for an enemy supporter to buff the enemy attackers.

### Why these are independent of targeting data

Enemy-team support is enemy-side **buff routing and reactive wiring**, not positioning. Each enemy already walks `runPlayerTurn` (Phase 4a) bound to the heal target as its victim. What is missing is (a) enemy reactive abilities firing, and (b) enemy-side `ally`/`all-allies` buffs routing to the *enemy* team. Neither needs to know board adjacency.

### What stays deferred (and why it's no longer fully blocked)

Deferred to a later **targeting phase**: AoE patterns, front/back/skip, hex-adjacency, death-fallback retargeting, Harvester's dormant `on-ally-destroyed` extra action, and **dead-recipient filtering** (Salvation `all-allies` heal crediting a dead caster in gross `directHeal`).

Tracing confirms dead-recipient filtering is **not reachable today**: in single-target healing mode only the heal target takes damage, so a player caster of an `all-allies` heal never dies. It needs a killable player ally, i.e. the targeting model. Therefore it belongs in the deferred bucket, not this increment.

**v1 targeting is no longer blocked on board data** (user direction, 2026-06-12): once full teams face each other, v1 targeting can be **shared-target, list-order focus-fire** — both teams concentrate on a single target until it dies, then advance to the next ship in add-order. This needs no positional data and re-enables dead-recipient filtering, Harvester, and death-fallback retargeting in that future phase. Only AoE / front-back-skip / hex-adjacency remain blocked on board data.

---

## 2. Goals & non-goals

### Goals

1. Enemy attackers' **own reactive abilities** fire (start-of-round self-buffs, on-X reactions) — fixes the Chakara-as-enemy bug.
2. An enemy **supporter** can cast `ally`/`all-allies` buffs that land on the enemy team and raise the bound attacker's effective stats (→ higher incoming damage to the tank).
3. The enemy section becomes a **real team**: rename "Enemy Attackers" → "Enemy Team", remove the 4-slot cap. Any enemy with a damage ability still hits the tank; an enemy with only support skills buffs the team and deals no damage.

### Non-goals (explicitly out of scope)

- Positional / AoE / front-back-skip / hex targeting (deferred, needs board data).
- Multi-target player side, death-fallback retargeting, Harvester dormant trigger, dead-recipient filtering (deferred to the v1 targeting phase).
- Enemy **healing** of enemy allies. In healing mode enemies never take damage (the tank deals none back), so enemy HP is static — enemy heals stay `healEventOnly` (4c PR 4 behavior). No enemy heal routing.
- Enemy cleanse/purge of enemy debuffs (no enemy-side debuffs exist to cleanse in this mode).
- Changes to DPS mode. This is healing-calculator-only; DPS goldens must remain byte-identical.

---

## 3. Architecture

### 3.1 Chosen approach — parallel enemy-side mirror

Build a **separate enemy-side mirror** of the player machinery rather than generalizing the shared player-side code in-place. The engine is ~2650 lines and fragile; the DPS goldens are sacred (synthetic — any diff is a bug). A parallel mirror keeps the player path untouched → near-zero regression risk, and matches how the walked-team support was originally built.

Where the routing logic is identical, factor it into a small `side`-parameterized helper (recipient resolution) so the mirror is not blind copy-paste. Registration sites and listener registration stay separate per side.

**Rejected alternative — unified side-aware machinery:** generalize `runtimes`, `reactivePerOwner`, recipient routing, and `lowestSpeedAllyIds` to be side-aware via `sideOf(id)`. Cleaner long-term but touches the most fragile shared paths with a large blast radius; deferred until the structural-debt refactor.

### 3.2 The gaps (verified against current code)

| Gap | Today | Needed |
|-----|-------|--------|
| **A — recipient routing** | `registerActorAbilityStatuses` for enemies (`engine.ts:369`) routes `ally`/`all-allies` to `playerIds` — an enemy buff would land on the *player* team | An `enemyIds` order; enemy cast & reactive `ally`/`all-allies` buffs route there |
| **B — reactive listeners** | `reactivePerOwner` (`engine.ts:1522`) is `'attacker'` + walked team only; `runtimes` map (`engine.ts:1556`) is player-only; `executeIntent` (`triggers.ts:727`) throws on a non-player owner | Enemy runtimes in a reactive-capable map; a second `registerReactiveListeners` scoped to enemy ids; an enemy `IntentExecContext` |
| **C — per-enemy buff stores + re-derivation** | Enemies already run `runPlayerTurn`, which folds `timedAbilityStatuses('self', id)` at each enemy's turn (`playerTurn.ts:1013`) | Mostly *free* once routing (A) lands; aura / `all-allies` buffs need per-recipient registration onto enemy ids |
| **D — supporter UI** | `EnemyAttackersPanel` caps at `MAX_ENEMY_ATTACKERS` (4); labelled "Attackers"; all cards are attackers | Rename → "Enemy Team"; remove cap; supporters reuse the same card (a card with a damage ability hits the tank, one without only buffs) |
| **E — `isLowestSpeedAllyFor` per-side** | Computed from `allPlayerActors` (`engine.ts:1221`); returns `false` for enemy ids | Per-side minimum speed; a lone enemy island resolves `true` on its own side |
| **F — `grantAllyCharges` enemy-side (optional)** | `undefined` for the enemy walk (`engine.ts:2627`) | An enemy-scoped charge-grant delegate, only if a supporter must accelerate an attacker's charged skill |

### 3.3 Component decomposition

- **`enemyIds` order** (`engine.ts`, near the existing `playerIds = [focusActorId, ...teamActorIds]`): the enemy-side recipient order = enemy attacker ids in add-order. The single dummy-wall `enemy.id` is *not* a team member (it is the heal target's victim-side stand-in); enemy *attackers* are the team.
- **Side-parameterized recipient helper:** extract the `self` / `ally`+`all-allies` / damaged-ally resolution (currently inline at `engine.ts:141` and `triggers.ts:794`) into a helper taking the side's recipient id list. Player path passes `playerIds`; enemy path passes `enemyIds`.
- **Enemy reactive registration:** an `enemyReactivePerOwner` array (each enemy attacker id + its `reactiveAbilities`, already partitioned in `buildEnemyPlayerActorRuntime`) and a second `registerReactiveListeners` call. Listener owner-side scoping must ensure enemy listeners only fire on enemy-side events and route to enemy recipients.
- **Enemy `IntentExecContext`:** its own `runtimes` (enemy runtimes), `playerIds` → `enemyIds` for recipient routing, an enemy `isLowestSpeedAllyFor`, and (Gap F, optional) an enemy `grantAllyCharges`.
- **Enemy stat re-derivation:** none new — `runPlayerTurn`'s existing self-buff fold (`playerTurn.ts:1013`) picks up enemy-side buffs landed on the enemy id at that enemy's turn.
- **UI:** `EnemyAttackersPanel` → "Enemy Team" label, cap removed; no new field types (skill parsing already drives support buffs). `EnemyAttackerConfig` shape unchanged.

### 3.4 Data flow

1. Adapter builds `enemies: EnemyAttackerInput[]` (unchanged shape; now unbounded count).
2. Engine builds `enemyPlayerRuntimes` and an `enemyIds` add-order list.
3. Enemy cast buff/debuff abilities register with `enemyIds` as the ally-routing source (Gap A).
4. Enemy reactive abilities register as listeners under an enemy-scoped context (Gap B).
5. Each round, per enemy turn: reactive triggers (e.g. `start-of-round`) fire → buffs land on enemy recipient ids → the enemy's `runPlayerTurn` folds same-side self-buffs into its attack/crit/etc. before resolving its hit on the tank (Gap C). `isLowestSpeedAllyFor` resolves per enemy side (Gap E).
6. Incoming damage to the tank reflects buffed enemy stats. Enemy buff names continue to surface in the existing `buildEnemyRoundEffects` display.

### 3.5 Error handling & edge cases

- **`executeIntent` owner miss:** enemy intents must resolve from enemy runtimes; the existing player-side throw stays as a guard. The two contexts must not be able to cross-resolve an owner (player intent must never find an enemy runtime and vice-versa).
- **Manual flat card (no `shipSkills`):** keeps synthesizing a basic attack (`engine.ts:343`); carries no support skills → unaffected.
- **Pure supporter (ship-backed, no damage ability):** `runPlayerTurn` resolves `damage = 0`; the enemy takes its turn, applies buffs, deals no damage. Confirm the walk tolerates a zero-damage enemy turn without emitting a spurious `attacked` event.
- **Dead heal target:** existing cadence-only guard (`engine.ts:2545`) is unchanged; enemy reactive self-buffs should still advance/fire per existing cadence semantics (buffs with no live victim are inert but cadence advances).
- **`isLowestSpeedAllyFor` for a lone enemy:** must return `true` (slowest on its own one-ship side), fixing the PR6 companion latent bug.

---

## 4. PR slicing

Matches the 4c PR1–6 rhythm; each PR ships green with goldens protected.

- **PR 1 — enemy reactive self-buffs (the Chakara-as-enemy fix).** Gaps B + E (self-scope). Enemy runtimes in a reactive-capable map + enemy `IntentExecContext` + per-side `isLowestSpeedAllyFor`. Enemy attackers' *own* reactive abilities fire (start-of-round self-buffs and on-X self-reactions). No cross-enemy routing yet. Foundation for PR 2.
- **PR 2 — cross-enemy buff routing + UI.** Gaps A + C + D. `enemyIds` order; side-parameterized recipient helper; route enemy `ally`/`all-allies` cast & reactive buffs to the enemy team; per-recipient aura/all-allies registration; rename "Enemy Attackers" → "Enemy Team"; remove the 4-slot cap.
- **PR 3 — `grantAllyCharges` enemy-side (only if needed).** Gap F. A supporter accelerating an attacker's charged skill. Ship only if a corpus ship requires it; otherwise drop.

---

## 5. Testing strategy

- **DPS goldens (`healingGoldenParity.test.ts` and DPS goldens):** must stay **byte-identical**. This is healing-mode enemy-side behavior; no synthetic golden carries an enemy supporter or an enemy reactive self-buff. Confirm byte-identical; never `vitest -u`. Hand-write new locking scenarios for the new behavior (per the project convention — new appended scenarios only).
- **PR 1 tests:** an enemy attacker with a `start-of-round` self-buff (Chakara-shaped) applies it each round and its damage to the tank rises accordingly; `isLowestSpeedAllyFor` returns `true` for a lone enemy; a generic enemy on-cast self-buff still fires (regression).
- **PR 2 tests:** an enemy supporter's `all-allies` Attack Up raises a *second* enemy attacker's damage to the tank; routing lands on enemy ids, never on player ids (assert player team stats unchanged); a pure-supporter card (no damage ability) deals zero damage but buffs; cap removal allows >4 enemies.
- **`audit:skills`:** 0 findings / 141 ships after `buildShipAbilities` wiring (mirror the 4c PR pattern).
- **Lint + tsc:** clean (`npm run lint` max-warnings 0).

---

## 6. Workflow notes

- `gh auth switch --hostname github.com --user TheSusort` before every PR/merge/API op.
- `docs/` is gitignored → `git add -f` for spec/plan/coverage; pre-commit hook runs the full vitest suite (`--no-verify` for docs-only commits).
- One evolving `UNRELEASED_CHANGES` changelog entry for all combat work — fold, don't duplicate.
- Dev server on :3000; hold pushes during UI iteration.
- After merge, update `docs/skill-model-coverage.md` §6 (close the enemy-team-support item incrementally) and the combat-engine current-state memory.

---

## 7. Open questions / future work

- **v1 targeting phase (next, now unblocked):** shared-target list-order focus-fire; re-enables dead-recipient filtering, Harvester dormant trigger, death-fallback retargeting.
- **Board-data-dependent targeting:** AoE, front/back/skip, hex-adjacency — still blocked on the user's board data.
- **Gap F necessity:** confirm during PR 1/2 whether any corpus enemy supporter grants charges to an attacker; if none, drop PR 3.
