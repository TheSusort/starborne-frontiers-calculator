# Combat Simulator — Positional Phase 5 (team-agnostic unification + board playback)

**Date:** 2026-06-15
**Status:** Design (pre-implementation)
**Phase:** Positional combat phase 5 of 5 — the END-STATE goal. (1=geometry resolver #106, 2=positional target-selection #108, 3=forced targeting/stealth #109, Provoke #112, 4=multi-target AoE + per-victim apply #114 + death-fallback #115.)

---

## 1. Problem & goal

Phases 1–4 built the positional combat machinery (board geometry, positional target-selection, forced targeting/stealth/Provoke, multi-target AoE + per-victim damage/death) but it is **all dormant**: no production caller passes board positions, so it never runs and DPS/healing goldens stay byte-identical.

Phase 5 is the **combat simulator page** — the original END-STATE goal: place two squads on the existing 3×4 hex board, run the combat engine, and watch the battle unfold **round-by-round, per-ship** (damage dealt/taken, healing, shields, HP, death) in a board-centric playback. It is the **first production caller that passes board positions**, so it activates everything Phases 1–4 built.

**Goal:** a working `/simulator` page where the user places two real fleet squads (with optional inline stat overrides), runs a battle to resolution, and steps through per-round per-ship results over both boards — backed by a **team-agnostic unified engine** that produces one **symmetric per-actor-per-side** result surface.

**Non-goals:** AI/opponent recommendation, save/share of battles, animation polish beyond a round stepper, balance tuning. Multi-battle comparison (the calculators' multi-config compare) is out — the simulator runs ONE battle.

---

## 2. Scope decisions (user-ratified during brainstorming, 2026-06-15)

- **PAGE-FIRST sequencing (re-decided 2026-06-15 after the unify-cost audit).** A working `/simulator` ships first on today's engine; the full internal team-agnostic unification is deferred to a later incremental phase. Rationale: the unify audit found ~20 hardcoded player-vs-enemy asymmetries across the ~3,780-line dual-path `runCombat` → ~10 sequential engine-surgery PRs with **no user-visible payoff until the page**. Meanwhile the Phase-4 **positional path is already nearly per-actor-per-side symmetric** (`drivePositionalApply` runs for both sides with a side-specific roster + `applyVictimDamage` side-sink + per-victim `emitHit`), so the page can be built on it now.
- **PR sequencing: PR 1 (adapter + thin symmetric result) → PR 2 (page) → later phase (incremental engine unification A1..An, page as live harness).**
- **Subsystem A is RE-SCOPED to a thin symmetric result surface** assembled from the existing positional path's per-victim data + the event stream (`ability-performed`/`attacked`/`hp-changed`/`heal-performed`/`ship-destroyed`) + final actor HP/`destroyedRound`. NOT the full internal unify (that becomes the deferred later phase; the team-agnostic end-state is unchanged, just sequenced after a usable page).
- **DPS and healing modes are UNTOUCHED** by page-first (the simulator runs through the existing positional/healing-mode paths with both teams positioned). Goldens stay **byte-identical** for PR 1 + PR 2 (no engine-internal change; the simulator is a new caller). Audited churn only becomes a concern in the later unification phase.
- **Battle model:** both sides are **real fleet ships**, with **optional inline per-placed-ship stat overrides** (for what-if opponents the user doesn't own).
- **Result/display:** **full per-round, per-ship, board-centric playback** (step through rounds over both boards).
- **Termination:** run until one team is fully destroyed, OR a **30-round cap** (matches in-game PvP).
- **Route:** top-level **`/simulator`**.
- **Page layout (validated via mockup):** two `FormationGrid` boards (Your Team / Enemy Team, enemy mirrored so col 4 = front), a round stepper (◀▶ arrows + slider/scrubber + play), a turn-order strip, a per-round event log, and a click-to-pin per-ship detail card (HP, damage dealt/taken, healing, shields, active buffs/debuffs).

---

## 3. Confirmed model (from prior phases — do NOT re-litigate)

- Board: 3 rows T/M/B × 4 cols; **col 4 = front (nearest enemy), col 1 = back**; enemy board is a display-only horizontal mirror; geometry/axial in `src/utils/targeting/board.ts`; `resolveCells(pattern, anchor)` resolves footprints (origin 100% / covered 50% damage-only).
- Targeting: `parseShipTargeting(ship)` → `{active?, charged?}` each `{target: ParsedTarget, pattern: ParsedPattern}` from the ship's raw `activeTarget`/`activePattern`/`chargedTarget`/`chargedPattern`. The engine consumes `position`/`target`/`pattern` per actor (Phase 2–4): `resolvePositionalTarget` (forced-targeting CF→Taunt→Provoke→stealth + row-first column-priority selection) + `drivePositionalApply` (per-hit re-resolution, footprint, per-victim apply via `applyVictimDamage`).
- Single speed-ordered queue already spans all actors (team → attacker → enemy tiebreak); per-actor status stores, reactive triggers, death/revive all exist.
- `RoundData.perTargetDamage?` (victim id → damage this round, both directions) is the Phase-4 seam the symmetric surface generalizes.

---

## 4. Subsystem A — Symmetric result surface (page-first scope)

> **PAGE-FIRST RE-SCOPE (2026-06-15):** Under page-first, subsystem A is the **thin symmetric result surface assembled from the existing positional path**, NOT the full engine unification. §4.2 (the surface shape) is what PR 1 builds. §4.1 + §4.3–§4.5 below describe the **deferred** full internal unification (the later A1..An phase) and are retained as the end-state reference — they are NOT in the page-first PRs.

### 4.2 The symmetric result surface *(PR 1 — this is the page-first deliverable)*

A single result structure keyed by `(side, actorId)` carrying, per round and as battle totals: `damageDealt`, `damageTaken`, `healingDone`, `healingReceived`, `shieldsAbsorbed`, `hp`/`hpPct`, `alive`/`destroyedRound`, plus active buffs/debuffs and a per-round **event list** (who hit/healed/killed whom, for the event log). **Under page-first this is assembled by the `simulateBattle` adapter (PR 1)** from: the positional path's per-victim `emitHit`/`perTargetDamage` (damage dealt+taken, both sides), the combat event stream (`ability-performed`/`attacked`/`hp-changed`/`heal-performed`/`ship-destroyed` — all carry actor/target ids + round), and final actor `currentHp`/`destroyedRound`. The Phase-4 deferred gaps (per-victim leech, per-victim incoming attribution) are surfaced at this assembly layer for the simulator; the engine internals are untouched, so DPS/healing surfaces + goldens stay byte-identical.

### 4.1 (DEFERRED — later unification phase) The unification

Today `runCombat` is **player-centric**: a focus attacker (+ optional walked team) attacks either a **dummy enemy SINK** (DPS mode: cumulative-damage scalar drives enemy HP% for gates) or the enemy-attackers attack a bound **heal target** (healing mode). The enemy side is a single-scalar **mirror**.

Unify into **one `bySide(...)` machinery**: two teams (`sideA`, `sideB`), every ship a real `CombatActor` in the existing single speed-ordered queue, each actor targeting the **opposing** side, with **per-actor-per-side accounting** throughout. There is no dummy sink and no pre-bound heal target in the unified model — both are degenerate inputs (see §4.3). *(This is the deferred end-state; PR 1 instead assembles the §4.2 surface from the existing positional path.)*

### 4.3 (DEFERRED) Degenerate reductions (how DPS/healing keep working)

- **DPS mode:** sideA = focus attacker (+ walked team); sideB = a **1-ship enemy team** carrying today's dummy stats. The player attacks a real enemy actor whose HP declines per-victim. The legacy `RoundData` (directDamage/cumulative/teamDamage/enemyHpPct) is projected from the symmetric surface for sideA.
- **Healing mode:** sideA = player team + heal target; sideB = the enemy-attackers team (already real actors attacking the heal target). With no positions supplied, enemy→heal-target binding is preserved. Legacy `HealingRoundData` projected from the symmetric surface.

### 4.4 Expected churn + safety

- **Likely audited churn:** DPS goldens reading enemy **HP%-threshold gates** — the dummy sink's *integer-percent* HP becomes a real actor's *exact-percent* HP (`enemyHpDecline` per-victim). Each such golden change is audited as a legitimate model correction and human-confirmed.
- **Likely byte-identical:** modes with no enemy-HP-gate; healing mode (enemy→heal-target binding preserved, no positions).
- **Safety harness:** (1) **characterization tests** on the degenerate reductions (pin today's DPS/healing numbers through the unified engine before/after); (2) a small **two-team battle harness** (tiny synthetic squads, hand-built `ab()` actors) that exercises the symmetric surface directly and becomes the unify's correctness proof. The unify ships behind these BEFORE B/C consume it.

### 4.5 Boundaries
`runCombat` stays the entry point; the unification is internal. The symmetric result is a new exported structure. `applyVictimDamage`, `drivePositionalApply`, `resolvePositionalTarget`, `resolveCells`, the status engine, and reactive triggers are reused unchanged where possible.

---

## 5. Subsystem B — `simulateBattle` adapter

A new `src/utils/calculators/battleSimulator.ts` (mirrors `simulateDPS`/`simulateHealing`):

- **Input:** two squads, each a list of `{ ship | statOverrides, position }`, + global config (round cap = 30).
- **Derivation:** for each placed ship, derive its `CombatActor`-level stats (reuse `deriveTeamEngineActors`-style stat/affinity derivation for BOTH sides) and resolve `parseShipTargeting(ship)` → per-actor `target`/`pattern` (active + charged); apply optional stat overrides.
- **Engine call:** `runCombat` with both teams positioned, run to termination (one side wiped or 30 rounds).
- **Output:** the assembled **per-round per-ship symmetric result** the page renders (§4.2), plus battle outcome (winner, rounds elapsed).

The adapter is the single seam between page state and the engine; the page holds no engine logic.

---

## 6. Subsystem C — Simulator page UI

- **Route:** top-level `/simulator` (new lazy-loaded route in `src/App.tsx`).
- **Placement:** two `FormationGrid` boards (Your Team / Enemy Team, enemy mirrored). Ship selection via `useShips`/`ShipSelector` per cell; optional inline stat-override editor per placed ship.
- **Run:** a Run action calls `simulateBattle` (memoized like the calculator pages).
- **Playback (validated layout):** round stepper — `⏮ ◀ Round N/total ▶ ⏭`, a slider/scrubber, and Play (auto-advance); a turn-order strip for the current round; a per-round **event log**; click any ship cell to **pin** its per-round detail card (HP, damage dealt/taken, healing received, shields, active buffs/debuffs). Per-cell: HP bar, shield bar, this-round effect (damage/heal), dead state.
- **Components:** reuse UI primitives (`card`, `Button`, `StatCard`, `PageLayout`, chart components) per project conventions; new sim-specific components (board pair, round stepper, event log, ship-round card) under `src/components/simulator/` (or similar).
- **Docs/changelog:** update `DocumentationPage.tsx` + add an `UNRELEASED_CHANGES` entry when C ships (the first user-visible Phase-5 surface).

---

## 7. Components & boundaries

| Unit | Responsibility | PR |
|---|---|---|
| `runCombat` unified `bySide` core + symmetric result | one machinery, both teams real, per-actor-per-side accounting | A |
| Degenerate-reduction projections (`RoundData`/`HealingRoundData` from symmetric) | keep DPS/healing adapters working | A |
| Characterization + two-team battle harness tests | prove the unify | A |
| `battleSimulator.ts` (`simulateBattle`) | squads+positions+targeting+overrides → runCombat → assembled result | B |
| `/simulator` page + board pair / stepper / event log / ship-round card | placement, run, playback | C |

Each unit is independently testable; the page holds no engine logic; the adapter is the only page↔engine seam.

---

## 8. Battle configuration

- **Termination:** one side fully destroyed OR **30-round cap** (in-game PvP). Outcome = winner | draw-at-cap + rounds elapsed.
- **Targeting:** per-ship parsed `active`/`charged` target+pattern from ship data; positions from board placement; forced-targeting/stealth/Provoke resolve in-engine.
- **Turn order:** existing single speed-ordered queue across both teams.
- **Overrides:** optional per-placed-ship stat overrides (default = real ship stats).

---

## 9. Risks & mitigations

- **PR 1/2 golden safety:** the simulator is a NEW caller; engine internals are untouched, so DPS/healing goldens stay **byte-identical**. The risk is the *assembly* — the symmetric result must correctly derive both sides' per-round numbers from the positional path + events. Mitigate with a **two-team synthetic battle harness** (hand-built squads) that pins expected per-ship per-round damage/heal/HP/death.
- **`enemyAttackers` requires `healTargetId`:** the engine populates the enemy team only in healing mode (gated on `healTargetId`). The adapter must set a `healTargetId` (a player ship) to get both teams as real positioned actors — a vestigial requirement to work around in PR 1, documented in the plan.
- **Deferred-unify churn (later phase only):** the full `bySide` unification will churn DPS/healing goldens (integer-pct sink → exact-pct actor, etc.) — handled with characterization + audited churn THEN, not in PR 1/2.
- **`runCombat` size (~3,780 lines):** the deferred unify extracts `bySide` into focused units; out of scope for page-first.
- **Termination/stalemate:** 30-round cap bounds healer-vs-healer; the engine already handles dead actors / death-fallback (Phase 4).
- **Performance:** a full battle is ≤30 rounds × a dozen actors — well within a memoized synchronous run (no web worker needed initially).

---

## 10. Testing strategy

- **Two-team battle harness (PR 1):** synthetic squads (hand-built `ab()` actors) exercising the symmetric surface — per-actor damage dealt/taken, healing, death-round, win condition, 30-round cap. The adapter's correctness proof.
- **Adapter tests (PR 1):** squads+positions+targeting+overrides → expected per-ship per-round result; targeting resolution from real ship data; the `healTargetId` workaround verified.
- **Goldens (PR 1 + PR 2):** DPS/healing goldens stay **byte-identical** (engine untouched) — confirm `git diff -- '*.snap'` empty.
- **Page (PR 2):** component/integration tests for placement, run, round stepping, pinned card; reuse the calculator-page test patterns.
- **Always:** `audit:skills` 0/141, tsc + lint clean. Synthetic goldens, never blind `-u`.

---

## 11. PR sequence summary (PAGE-FIRST)

1. **PR 1 — `simulateBattle` adapter + thin symmetric result surface.** Two positioned squads + parsed targeting + overrides → `runCombat` (both teams positioned, run to termination) → assembled per-round per-ship **symmetric result** (§4.2) built from the positional path's per-victim data + the event stream + final actor HP/destroyed-round + outcome. Engine internals untouched → DPS/healing **goldens byte-identical**.
2. **PR 2 — `/simulator` page.** Two-board placement (`FormationGrid`), fleet selection (`useShips`/`ShipSelector`), optional per-ship overrides, Run, board-centric round-stepper playback (arrows + slider + play, turn-order strip, event log, pinned ship-round card). New `/simulator` route. Docs + changelog. → a usable simulator.
3. **LATER PHASE (deferred) — incremental engine unification (A1..An).** Collapse the dual-path `runCombat` into one team-agnostic `bySide` machinery (the ~10 increments from the asymmetry audit), with the live `/simulator` page as the test harness and audited/human-confirmed golden churn. The §4.1/§4.3–§4.5 end-state. NOT in scope for the page-first PRs.

This delivers a usable simulator (PR 1+2), then completes the team-agnostic end-state (later phase).
