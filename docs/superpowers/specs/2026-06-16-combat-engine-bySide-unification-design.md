# Combat Engine `bySide` Unification — Design

**Date:** 2026-06-16
**Status:** Approved (design); spec review + user review pending
**Author:** brainstormed with Claude
**Branch base:** stacked off `feat/combat-sim-phase5-pr2` (PR #117), not waiting on its merge

## 1. Problem

`runCombat()` (`src/utils/combat/engine.ts`, ~3,900 lines) is a **dual-path** engine: a
player-centric primary path plus a parallel enemy-side mirror bolted on across Phases 4a–4d.
The two sides are reconciled by ~20 hand-split points — paired helpers, player-centric
predicates, and three near-duplicate `runPlayerTurn` call sites — plus a structural
**dummy-enemy-vs-real-actor duality** (DPS measures damage against an immortal scalar sink;
the simulator walks real mortal actors).

This asymmetry is a recurring **source of bugs**, not just untidiness. The latest confirmed
example (root-caused 2026-06-16, unfixed): an enemy-side ship's opposing/ally reactive triggers
fire against the wrong side because `isEnemySide` and `grantExtraAction` are player-centric — so
a lone enemy Liberator that kills a player ship never gets its `on-enemy-destroyed` extra action.
Every enemy-side opposing/ally reactive (`on-enemy-destroyed`, `on-ally-destroyed`,
`on-ally-attacked`, `on-enemy-repaired/cleansed`) is affected.

**Goal (user-ratified):** the full team-agnostic end-state — one speed-ordered queue, one
`bySide(...)` machinery, the mirror deleted — driven by the asymmetry audit's structural list,
not by which bug bites first. The `/simulator` page (Phase 5) is the live test harness this
unification was always said to need.

This supersedes the earlier "defer unification" stance: the harness now exists, so the campaign
is unblocked.

## 2. User-ratified decisions

| Decision | Choice | Consequence |
|----------|--------|-------------|
| **Scope** | Full `bySide` unification (the architectural end-state), as a multi-PR campaign | Collapse all ~20 reconciliation points; not a one-off bug fix |
| **DPS dummy enemy** | Keep as an **indestructible sink actor** in the unified roster | DPS goldens preservable byte-identical; campaign is a closure-binding + roster-unification refactor, NOT a rewrite |
| **Per-PR safety gate** | **Accept audited churn** (not a hard byte-identical wall) | Byte-identical remains the *expectation*; churn accepted only where behavior legitimately changes, always audited line-by-line, **never** blind `vitest -u` |
| **Base / #117** | **Branch off `feat/combat-sim-phase5-pr2` now** | Don't wait on #117 merge; accept the stacked-PR rebase/retarget friction |
| **PR2 placement** | Reactive-routing fix lands **early** (PR2) | Highest-value bug fix arrives before the deeper accounting work |

## 3. The unifying seam

One idea collapses the reconciliation surface: **every actor carries `side`, and all per-side
behavior is bundled into a `SideContext` produced by `bySide(side)`.** The engine keeps ONE
roster and ONE set of helpers parameterized by side.

- **`side: 'player' | 'enemy'`** (a `teamId`) on every `CombatActor` at construction — attacker,
  team actors, enemy attackers, and the dummy `enemy`.
- **`indestructible: true`** on the dummy only. `applyVictimDamage` drains `currentHp` uniformly
  for all actors; the death / combat-end path skips `indestructible` actors. The sink's
  `currentHp` decline *is* today's cumulative scalar — so DPS HP%-gates read the same modeled
  (possibly-negative) HP they read now (`enemy.currentHp = max(0, enemyHp − enemyHpDecline)`,
  engine.ts ~3773, becomes the live per-actor value).
- **One roster**: `allActors` + `actorsBySide(side)` + `runtimesByActorId`. Today's
  `allPlayerActors` / `enemyAttackerActors` / `runtimesById` / `enemyPlayerRuntimeByActorId`
  become thin derived views or are replaced at call sites.
- **`bySide(side) → SideContext`** bundles what is hand-split today:
  `grantAllyCharges`, `lowestSpeedAllyIds`, `selfHpPct` lookup, `isOpposing` / `isSameSideAlly`,
  the per-actor accounting sink, decrement routing, and the positional apply direction. The three
  `runPlayerTurn` call sites converge on one call taking `bySide(actor.side)`.

The reactive/event layer (`triggers.ts`, `statusEngine.ts`) is already ~95% side-agnostic, so
most of the work is **deleting** the mirror, not building new machinery.

### 3.1 Asymmetry surface being collapsed (audited 2026-06-16, file:line)

> **Line numbers are a 2026-06-16 snapshot** of a ~3,900-line file that shifts as each PR lands.
> Planners for PR3+ must re-locate by **symbol name**, not trust the offset — earlier PRs in the
> campaign move these lines.


1. **Dummy-vs-real duality** — scalar `enemyHpDecline` (engine.ts ~2392) + post-round
   scalar→actor conversion (~3773) vs. real `currentHp`; dummy carries all enemy-side
   DoT/bomb/accumulator containers (~1505–1510, ~2840). → unified `currentHp` + per-actor
   containers (positional path already does this).
2. **Player-centric predicates** — `isEnemySide` (engine.ts ~1820, triggers.ts ~204) +
   `seenEnemyAttackerIds`; `registerReactiveListeners` called twice with the *same*
   player-centric predicate (~1830–1858). → per-call `isOpposing` / `isSameSideAlly`.
3. **Paired helpers** — `grantAllyCharges`/`grantEnemyAllyCharges` (~1487, ~1592);
   `lowestSpeedAllyIds`/`lowestSpeedEnemyIds` (~1475, ~1602); `runtimesById`/
   `enemyPlayerRuntimeByActorId` (~1862, ~1584); `allPlayerActors`/`enemyAttackerActors`/
   `allPlayerActorsById` (~1451, ~1582, ~1531). → single side-parameterized closures.
4. **`grantExtraAction` is player-only** (engine.ts ~2474) — drops an enemy granter even when
   the trigger fired. → resolve granter from the combined actor map.
5. **Decrement** — `decrementPlayer`/`decrementEnemy` 4-branch logic (~3640–3686), incl. the
   audited Provoke gap (enemy-attacker branch never calls `decrementEnemy(actorId)`). → single
   side-aware decrement.
6. **Per-actor accounting** — heal-target-only `roundIncomingDamage`/`roundShieldAbsorbed`/
   `roundBarrierAbsorbed` (~2057–2062) and `healTargetDestroyedRound` (~1678, set only when
   `victim === healTarget`). → per-actor buckets + per-actor `destroyedRound`.
7. **`healTargetId` binding** — required guard, engine throws (~1535–1545); single-tank model.
   → relaxed by per-actor accounting (full multi-target is Phase-5/positional scope, not core).
8. **Three `runPlayerTurn` call sites** — focus (~2800), team (~2970), enemy (~3250) differ in
   roster, `enemyHpDecline` source, `grantAllyCharges`, `selfHpPct`, damage credit (round map vs
   direct `applyIncomingToTarget`), positional apply direction, and UI-effects tracking. → one
   call parameterized by `bySide(actor.side)`.
9. **`// Phase-5` deferrals** — per-victim leech (~3475–3505, gated `!enemyPositional`),
   per-victim incoming attribution (~3522–3527, tank bucket inflated for every AoE victim),
   per-victim defense-debuff / incoming-outgoing modifier sourcing (~2294–2305). → first-class
   per-victim accounting.

## 4. Increment sequence (leaf-first)

Each PR is independently reviewable. The biting bug dies at **PR2**.

| PR | Scope | Golden expectation |
|----|-------|--------------------|
| **1 — Roster + side field** | Add `side` to every actor; single `allActors` / `actorsBySide` / `runtimesByActorId`; add `indestructible` flag to the dummy as **inert plumbing** (declared, not yet read by the death path — that wiring lands in PR5). Pure plumbing. | Byte-identical |
| **2 — Side predicates + FIX enemy reactive routing** | Replace `isEnemySide` with per-call `isOpposing` / `isSameSideAlly`; parameterize `registerReactiveListeners`; fix `grantExtraAction` to resolve the granter from the combined actor map. **Kills the enemy-Liberator extra-action bug + all enemy-side opposing/ally reactions.** | DPS/healing **must stay** byte-identical: PR2 touches behavior-adjacent code but only the player viewpoint is exercised by goldens, so any golden move here is a refactor **leak** (predicate semantics drifted), NOT acceptable churn — fix the seam. Fix verified by NEW team-vs-team tests |
| **3 — Unify side-closures** | Collapse `grantAllyCharges`/`grantEnemyAllyCharges`, `lowestSpeed*`, `selfHpPctFor` into `bySide()`. | Byte-identical |
| **4 — Unify decrement** | One side-aware decrement preserving the 4-branch semantics; closes the audited Provoke enemy-attacker decrement gap. | DPS/healing byte-identical; enemy-team debuff-lifecycle change is team-vs-team (audited) |
| **5 — Per-actor accounting** | Replace heal-target-only accumulators + `enemyHpDecline` scalar with per-actor `currentHp` / buckets + per-actor `destroyedRound`. Sink decline == old scalar. **Wire the `indestructible` skip into the death / combat-end path here** (the flag from PR1 goes live). **The duality dies here.** | **The one churn-risk PR** — audited; sink must reproduce DPS exactly |
| **6 — Collapse the 3 call sites** | One `runPlayerTurn` call parameterized by `bySide(actor.side)`; positional direction / `healEventOnly` / UI-effects folded into `SideContext`. The capstone. | Byte-identical |
| **7 — Phase-5 per-victim accounting** | The `// Phase-5` deferrals: per-victim leech, per-victim incoming attribution, per-victim defense/modifier sourcing. Lights up real AoE accounting in the sim. May itself split. | Additive |

**Rationale:** foundation → predicates → helpers → decrement → accounting → call-site collapse.
The risky behavioral change (per-actor accounting, PR5) lands *after* cheap plumbing has de-risked
the seam; the highest-value bug fix (PR2) lands early. Each PR shrinks the mirror; PR6 deletes the
last of it.

PR1+PR2 are tightly coupled (PR2 needs PR1's `side` field) but kept separate so PR1 is trivially
byte-identical and PR2's behavioral fix is reviewed in isolation. The audit estimated ~10 PRs;
this 7-slice may expand if PR4/PR5/PR7 need sub-splitting during planning. **When a row is
sub-split, each child plan must re-derive its golden expectation from this parent row** so the
byte-identical-vs-audited-churn boundary isn't lost in slicing.

### 4.1 PR6 sub-split & PR6a design (added 2026-06-17; user-ratified)

PR5 (5a–5d) shipped. **PR6 is sub-split into two leaf-first PRs** because row 6 entangles a
large-but-byte-identical refactor with a byte-identical-RISKY behavior-adjacent change:

- **PR6a — Collapse the 3 `runPlayerTurn` call sites.** Byte-identical. `enemyHpDecline` is
  **preserved exactly** behind a per-side `declineFor(tgt, selectedReal)` closure (focus/team:
  `selectedReal ? 0 : cumulativeDamage + cumulativeTeamDamage`; enemy: `max(0, maxHp − currentHp)`).
  The scalar stays alive.
- **PR6b — Kill the `enemyHpDecline` scalar.** Gates read `tgt.currentHp` uniformly;
  `declineFor` collapses to one `max(0, victimMaxHpFor(tgt) − tgt.currentHp)`. Requires a
  `runPlayerTurn` interface change; multi-site; byte-identical-RISKY. (This is the
  "enemyHpDecline → currentHp gate-read unification" the campaign notes flagged — it belongs
  WITH PR6, not a redundant standalone PR5e. The byte-identity rests on: the per-turn scalar
  `cumulativeDamage + cumulativeTeamDamage` equals `enemyHp − enemy.currentHp` at round start,
  because both `cumulativeDamage`/`cumulativeTeamDamage` and the dummy's `currentHp` update
  *post-round* — so reading `currentHp` yields the same value the scalar carried. Each per-turn
  site's timing MUST be audited individually before flipping.)

  **PR6b fork resolved (2026-06-17, user-ratified): full collapse, verify empirically.** The
  audit found the §4.1 byte-identity proof above covers only TWO of the player site's three
  cases. Recap of all three under the unified `max(0, victimMaxHpFor(tgt) − tgt.currentHp)`:
  - *Enemy side* — already `max(0, recipientMaxHp(tgt.id) − tgt.currentHp)`. Identical; no change.
  - *Player dummy sink* (`selectedReal=false`, `tgt=enemy`) — `enemy.currentHp` is set post-round
    to `max(0, enemyHp − cumulative)`, so `max(0, enemyHp − currentHp) = min(enemyHp, cumulative)`;
    the `cumulative > pool` case floors to the same 0% the raw scalar did (the sole consumer,
    `enemyHpPct`, floors at 0). Byte-identical.
  - *Player real positional target* (`selectedReal=true`, team-vs-team only — `enemyAttackerActors`
    non-empty) — old code FORCES `enemyHpDecline = 0` (enemyHpPct always 100%). But
    `applyOutgoingToEnemy → applyVictimDamage` (engine.ts:2243) decrements the real target's
    `currentHp`, so from round 2 the unified formula is NON-zero → enemyHpPct reflects the real
    target's actual HP. This is a latent **improvement**, NOT covered by the proof above, and in
    pure DPS mode it never fires (`enemyAttackerActors` is empty → `selectedReal` always false).

  **Decision:** implement the full collapse literally — remove `enemyHpDecline` from
  `PlayerTurnArgs` (the "interface change") and derive `max(0, enemyHp − enemy.currentHp)` inside
  `runPlayerTurn` from the `enemy` (tgt) actor; drop `declineFor` AND `selectedReal` (its only
  consumer). Then VERIFY EMPIRICALLY: full suite + zero `.snap` movement. Green ⇒ byte-identical in
  practice and the real-target path is now correctly currentHp-driven (latent, currently
  unexercised). Any movement ⇒ that IS the real-target divergence; fall back to preserving the
  player-side `selectedReal ? 0` guard (kills the scalar read but keeps the branch) and defer the
  real-target HP% refinement to PR7 (per-victim accounting), where reading real targets' HP is the
  natural unified behavior. Also: the dead-focus synth row (engine.ts:2601) and 7 unit-test call
  sites that pass `enemyHpDecline: 0` must move with the param removal (test fixtures verified
  full-HP so the derived value stays 0).

Both children re-derive their golden expectation from parent row 6: **byte-identical**.

**PR6a approach (chosen = "fold per-side turn bindings into `SideContext`; one call + explicit
per-kind tails").** Rejected alternatives: (2) merge focus+team only — 3→2, doesn't meet the
"one call" goal nor finish the mirror; (3) full unification incl. tails via per-side
credit/record strategy objects — over-abstracts the bookkeeping tails, obscures byte-identity,
more review burden than 6a warrants.

The three `runPlayerTurn` sites (focus, walked-team, enemy) diverge along the axes below. Each
new `SideContext` field / resolver **reproduces the exact current per-site value** → byte-identical,
no `vitest -u`.

| Binding | Player (focus + team) | Enemy | Lands in |
|---|---|---|---|
| `runtime` | `attackerRuntime` / `teamRuntimeById.get(id)` | `enemyPlayerRuntimeByActorId.get(id)` | `runtimeFor(actor)` resolver |
| opposing roster (selection + apply) | `enemyAttackerActors` | `allPlayerActors` | `SideContext.opposingRoster` |
| legacy fallback victim | `enemy` (dummy sink) | `healTarget!` | `SideContext.legacyVictim` |
| `enemyDefense` | `tgt.stats.defence` | `lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id)` | `SideContext.victimDefenceFor(tgt)` |
| `enemyHp` | `tgt.stats.hp` | `recipientMaxHp(tgt.id)` | `SideContext.victimMaxHpFor(tgt)` |
| `enemyHpDecline` | `selectedReal ? 0 : cumulative…` | `max(0, victimMaxHpFor(tgt) − tgt.currentHp)` | `SideContext.declineFor(tgt, selectedReal)` *(preserved; PR6b kills it)* |
| `enemyType` | `enemyType` | `undefined` | `SideContext.enemyTypeArg` |
| `enemyBuffNames` | `playerEnemyBuffNames()` | `enemyEnemyBuffNames()` | `SideContext.enemyBuffNamesUnion()` |
| `healEventOnly` | absent (falsy) | `true` | `SideContext.healEventOnly` |
| `targetId` | omitted | `tgt.id` | side-conditional in arg-builder |
| `grantAllyCharges` | `bySide('player')` | `bySide('enemy')` | *already in `SideContext`* |
| positional apply direction | `applyOutgoingToEnemy(dmg, victim)` | enemy→player intake wrapper | `SideContext.applyToVictim` |
| `selfHpPct` maxHp denom | `baseHpFor(actor.id)` | `enemyRuntime.hp` | `runtimeFor` — **verify `baseHpFor(id) === runtime.hp`** for player actors; if not equal, keep per-side denom |
| `selfDebuffNames`, `targetHpPct`, `healing`, DoT/bomb/accumulator containers (from `tgt`) | identical | identical | shared / uniform |
| parsed target / pattern | `input.target` / `input.pattern` | `teamTargetById`/`enemyTargetById`, `teamPatternById`/`enemyPatternById` | `parsedTargetFor(actor)` / `parsedPatternFor(actor)` |

**Collapsed flow per acting actor:** (enemy-only) dead-target cadence guard `→` shared
positional selection via `bySide(side).opposingRoster` `→` **one** `runPlayerTurn(buildTurnArgs(
actor, bySide(side)))` `→` shared positional apply via `bySide(side).applyToVictim` `→`
**per-kind tail** + the uniform `lastTurnCtxByActor.set(actor.id, turn.turnCtx)` (all three sites
do this today) + `healTargetBuffs` capture.

**Tails PR6a deliberately keeps explicit, and their unification home** (recorded so the boundary
isn't lost in slicing):

1. **Damage-credit duality** — player `creditDamage(id, channel)` into a damage *row*
   (`focusTurns` / team map) vs enemy `applyIncomingToTarget` *intake* into the tank — and the
   **asymmetric result surface** → **PR7 (Phase-5 per-victim accounting)**. PR7 gives every actor
   both an outgoing row *and* incoming buckets, so "credit" becomes one per-victim apply
   regardless of side. This is the largest remaining tail and is PR7's explicit purpose.
2. **Enemy-only dead-target cadence guard** ("don't attack a corpse; keep banking charges") →
   folds into **PR7's** positional death-fallback retargeting.
3. **Direction-specific event emissions** — player→enemy `ability-performed` vs enemy→player
   `attacked` — are **genuinely directional, NOT mirror duplication**. They stay distinct by
   design (merge only if PR7 makes it free). Do not chase a false symmetry here.

So the remaining-unification chain is **PR6a (collapse the call) → PR6b (kill the decline scalar)
→ PR7 (per-victim accounting unifies credit + result surface + death-fallback)**. After PR7 the
only side-specific code is the directional emissions, by design.

## 5. Safety, testing, workflow

**Per-PR gate.** Byte-identical DPS + healing goldens is the expectation. Audited churn is
accepted only at PR4 (enemy-team debuff lifecycle, team-vs-team only) and PR5 (per-actor
accounting). Anywhere else, a golden diff = a refactor leak → fix the seam, not the snapshot. No
blind `vitest -u`; every accepted diff explained line-by-line in the PR body.

**Testing.**
- Subagent-driven; per-task spec + quality review; final holistic review before PR.
- `audit:skills` 0/141, `lint` + `tsc` clean every PR.
- PR2 fixes get dedicated team-vs-team tests, starting with the codified repro: *lone enemy
  Liberator kills a player ship → it takes 2 turns this round*. Plus a `/simulator` manual check
  on a real fleet.
- **Vacuous-isolation-test trap** (project hit it twice, #103/#114): any "no-leak" or
  byte-identical assertion must compare an observable the actor *actually produces* — assert a
  non-zero baseline, or it can't catch a leak.

**Workflow.**
- Branch `feat/combat-engine-unify-pr1` off the current `feat/combat-sim-phase5-pr2` tip;
  subsequent PRs stack (accept the rebase-`--onto` / retarget-base friction; CodeRabbit only
  auto-reviews base=main PRs).
- Work on the **main checkout** (already on the sim-pr2 branch, where `/simulator` serves on
  :3000) to avoid the fresh-worktree esbuild crash. If a worktree is unavoidable, symlink `.env`,
  `docs/*.csv`, `combat-system.md`, `.husky/_`.
- `gh auth switch --hostname github.com --user TheSusort` before every PR/merge op. docs are
  gitignored → `git add -f`; `--no-verify` for docs-only commits. Poll `mergeState=CLEAN`
  (CodeRabbit's API check reads `null` even on success).
- Verify the checkout's current branch before any `git` op; never reset a branch this session
  didn't create (parallel sessions sometimes own the main checkout).

## 6. Non-goals

- No board-geometry / targeting-model changes (Phases 1–3 shipped those).
- No new ship mechanics, no multi-target healing UI, no 4e consumption / 4f defense-calc work
  beyond what a unified path incidentally touches.
- `healModifier` engine consumption (open Phase-5 limitation) is out unless PR7 makes it free —
  flagged, not chased.

## 7. Risks

- **PR5 (per-actor accounting) is the dangerous one** — sink semantics must reproduce DPS
  exactly. Mitigation: a per-hit-vs-aggregate parity test for the sink's `currentHp` decline
  against the old scalar; audit every golden diff before accepting.
- **PR4 decrement** — the 4-branch decrement is buff-lifecycle-sensitive; characterize before
  touching, lock with tests.
- **Stacked-PR friction + parallel session owning the main checkout** — accepted; verify branch
  before every `git` op.

## 8. Locked game rules (do not re-litigate)

Per `docs/skill-model-coverage.md` §5 and `project-combat-engine-current-state` memory: turn model
(once per round, speed = order not frequency, tiebreak team→attacker→enemy), buff family
overwrite, single landing check at infliction, owner post-turn decrement includes same-turn
applications, extra actions = full re-queued turn, heal formula, Cheat Death semantics, persistent
stacking buffs. Unification must preserve all of these unchanged.

## 9. Canonical references

- Engine: `src/utils/combat/engine.ts`, `playerTurn.ts`, `triggers.ts`, `positionalBinding.ts`,
  `roundContext.ts`, `victimDamage.ts`, `positionalApply.ts`.
- Sim semantics + backlog: `docs/skill-model-coverage.md` (§5 rules, §6 backlog).
- History: `project-combat-engine-roadmap` memory; current state:
  `project-combat-engine-current-state` memory.
- The bug this campaign retires first: `project-enemy-side-reactive-routing-gap` memory.
