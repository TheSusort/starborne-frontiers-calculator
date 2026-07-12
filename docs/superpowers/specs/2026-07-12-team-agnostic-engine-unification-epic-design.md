# Epic: Team-Agnostic Engine Unification & Sim Fidelity

**Status:** Design approved (2026-07-12). Epic-level spec — each sub-project below gets its own
spec → plan → implementation cycle.

**Author context:** Follows the combat-engine roadmap. The engine reached a near-symmetric
positional state (Phases 0–5, model-completeness epic, Protection transfer). The remaining
structural debt is the player/enemy **mirror** inside `runCombat` and the sim accounting
**approximations** documented in `battleSimulator.ts`. This epic closes both, plus two deferred
mechanics that are cleanest to build on the unified model.

---

## 1. Motivation

`src/utils/combat/engine.ts` is ~8,000 lines with ~120 dual-path (player-vs-enemy) markers.
Every actor already walks the same `runPlayerTurn` pipeline, but three asymmetries remain:

1. **Dummy-`enemy` sink vs real actors.** The DPS/healing calculators drive a single focus
   attacker against a stat-block *sink* (cumulative-damage scalar, HP%-gates), while the
   simulator drives real per-actor apply (`applyVictimDamage`). Enemies cannot die from player
   attacks on the sink path.
2. **Asymmetric accounting.** Player side uses per-actor damage/heal maps; enemy side uses a
   single scalar + event-only emission.
3. **Vestigial `healTargetId` binding.** The engine throws unless a heal target is set; the
   simulator sets a vestigial one purely to satisfy this.

Downstream, `battleSimulator.ts` documents a set of accounting approximations that all trace to
these asymmetries (AoE damage doesn't reconcile, healing is even-split, shields read 0, etc.).

**Goal (user-ratified): both, equally** — kill the mirror (one bySide path) *and* close every
documented approximation as a tracked deliverable.

---

## 2. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Both goals, equally.** Full unification AND every accounting approximation closed. | User-ratified. |
| D2 | **Mechanics back-loaded.** FrontLine shield + Meatshield stack-stealing land AFTER unification, on the unified model. | Stack-stealing is runtime status manipulation, cleaner on unified per-actor-per-side stores. |
| D3 | **Sim-golden characterization harness first.** Capture `BattleResult` snapshots of representative battles before any engine surgery. | Existing DPS/healing goldens are synthetic single-path fixtures that barely cover team-vs-team — the paths unification rewrites. |
| D4 | **DPS-calc opponent becomes a real skill-less ship.** Replace the dummy sink with a real actor: user-configurable stats + buffs, **no skills**, default stats = today's dummy. | User-specified. Truly one path; the calc keeps its single-opponent UX but on real-actor apply. |
| D5 | **Decouple the seeded RNG into per-stream sub-streams in SP-0**, before capturing sim goldens. Production stays `Math.random`. | Fidelity increments that add/remove/reorder draws otherwise cascade-move unrelated goldens (all gates share one module RNG today). Decoupling keeps each fidelity PR's churn local and unblocks F6. |

### 2.1 RNG model (corrected, load-bearing for this epic)

`rateAccumulator.ts`: every probabilistic event — **crit, debuff landing (hacking vs security),
charge manipulation, procs, counter crits** — flows through `makeRateGate()`, a real random draw
`rng() < clamp(rate)`. **Production `rng = Math.random` (truly random, no seed).** Tests install a
seeded `mulberry32` via `setupTests.ts` so goldens are reproducible. **Hacking/security landing is
already RNG in the sim and matches the game — no change needed.**

**The coupling hazard:** all gate instances (`activeCritGate`, `debuffLandingGate`, enemy/team
variants) are stateless closures reading the **same module-global `rng`**. The
`// own instances — determinism isolation` comment at `playerTurn.ts:280` is **stale** — there is
no per-actor stream isolation. Under the seed, any change to the global count/order of draws shifts
every subsequent draw → unrelated goldens move. D5 fixes this by keying seeded sub-streams
per actor / per gate-purpose in the test harness only.

**Sim goldens are a single seeded trajectory** — a regression guard (same seed → same battle →
any diff is a real behavior change), not an expected-value assertion.

---

## 3. Decomposition & sequencing

```
SP-0  Sim-golden harness + RNG-stream decoupling   (no gameplay change; one audited golden move for RNG)
  │
SP-U  bySide engine unification  (U1…Un)           (pure-refactor increments byte-identical; DPS-calc migration = 1 audited move)
  │
SP-F  Accounting fidelity  (F1…F7)                 (one approximation per PR; each a deliberate audited golden move)
  │
SP-M  Mechanic riders  (M1 FrontLine, M2 Meatshield)
```

Each SP is an independent spec → plan → implement cycle. Later SPs may reveal that an earlier
increment's boundary needs adjustment; the epic spec fixes *intent and acceptance*, not the exact
increment count.

### SP-0 — Sim-golden harness + RNG-stream decoupling

**No gameplay change.**

1. **RNG sub-streams (D5).** In the test harness, seed a distinct sub-stream per actor (and/or per
   gate purpose) so draw-order coupling is broken. Production untouched (`Math.random`). This is a
   one-time, audited global move of the existing DPS/healing goldens (draw reassignment).
2. **Sim goldens.** Add `BattleResult` snapshot fixtures for representative battles: 2v2, 3v3,
   a DPS-mode single-attacker-vs-real-skill-less-ship, and a healing-mode healer-vs-team. These
   become the high-level guard for SP-U/SP-F. Captured under the seeded RNG.

**Acceptance:** new sim goldens committed; existing DPS/healing goldens green after the audited RNG
reassignment; no engine behavior change beyond draw assignment.

### SP-U — bySide engine unification (U1…Un)

Collapse the mirror onto one side-parameterized loop over the single speed-ordered queue. Retire
reconciliation points one increment at a time (the 2026-06-12 asymmetry audit found ~20). Structural
payoffs:

- **Real actors replace the dummy sink.** DPS-calc opponent = skill-less real ship (D4), with a new
  enemy stats + buffs config UI on the DPS calculator page. *This is the one deliberate, audited
  golden move in SP-U.* (Open sub-question for SP-U's spec: DPS-calc opponent HP — keep effectively
  non-terminating so the DPS number accumulates over the full N-round window as today, vs. real
  finite HP that can end the run early. Default proposal: non-terminating, since the DPS metric is
  "output over the window," not "time-to-kill.")
- **Unified per-actor-per-side accounting** — one result surface; retire the player-map/enemy-scalar
  split.
- **Kill the vestigial `healTargetId` binding** requirement.

**Golden discipline:** every pure-refactor increment keeps BOTH golden sets (DPS/healing + sim)
byte-identical. The D4 migration is the sole audited move.

**Acceptance:** no dual-path markers remain for the retired points; single bySide apply/accounting;
DPS/healing calculators work on real actors; sim goldens byte-identical except the audited D4 move.

### SP-F — Accounting fidelity (one approximation per PR)

Each closes one `battleSimulator.ts` approximation with a deliberate, audited golden move. RNG
decoupling (D5) keeps each PR's churn local.

| ID | Approximation closed |
|----|----------------------|
| F1 | AoE reconciliation: attacker-aggregate `damageDealt` == Σ per-victim `damageTaken`. |
| F2 | Per-recipient healing: `heal-performed` carries per-recipient amounts (retire even-split). |
| F3 | `shieldsAbsorbed` channel surfaced in the sim (heal event has no shield channel today → reads 0). |
| F4 | `healModifier` consumed by the engine (forwarded but ignored today). |
| F5 | Charged-skill targeting uses the *charged* selection (uses active selection today). |
| F6 | Per-victim affinity + per-victim crit (the `RateGate`-determinism redesign). Hardest; D5 makes it auditable. |
| F7 | Support/hybrid incidental damage applied to real enemies (no dummy sink). Largely falls out of SP-U — verify + lock. |

**Acceptance:** every approximation comment in `battleSimulator.ts` removed/closed; each backed by a
sim-golden that moved deliberately with an audited diff.

### SP-M — Mechanic riders (back-loaded)

- **M1 FrontLine reactive shield** tracks the *actual damage dealt* by the triggering cast, not a
  flat `basis:'attack' × 24%` approximation. Needs the per-victim dealt-amount plumbing from F1.
  Retire the SP-G known-limitation pin.
- **M2 Meatshield dynamic Protection stack-stealing** — active/charge "steals Protection until this
  Unit has 3 stacks." Runtime status manipulation (move stacks off allies onto Meatshield up to a
  cap) on the unified per-actor-per-side status stores. Builds on the shipped Protection-transfer
  model (`protectionTransfer.ts`, `selfBuffStacksForOwner`).

**Acceptance:** FrontLine shield magnitude tracks dealt damage end-to-end; Meatshield stack-stealing
modeled with tests; both audit-clean (`audit:skills` 0 findings).

---

## 4. Non-goals

- **Distribution/Monte-Carlo sim UI.** The sim shows ONE random outcome per Run (matches the game's
  per-fight randomness). Running N times to show a distribution is out of scope.
- **Positioning/board-data changes.** The board geometry + targeting model is done; this epic does
  not revisit it.
- **New skill mechanics** beyond FrontLine + Meatshield. Model-completeness real-gaps are already
  closed.
- **The #5 composition-selector UX merge** — tracked separately in the sim-testing findings; not
  part of this engine epic.

---

## 5. Cross-cutting invariants (apply to every SP)

- **Two golden tiers.** Low-level: synthetic DPS/healing goldens (`vitest -u` forbidden; a diff =
  bug unless the PR is a sanctioned audited move). High-level: SP-0 sim goldens.
- **Team-symmetric.** Every mechanic behaves identically on either side (engine-team-symmetry rule).
- **`audit:skills` stays at 0 findings.**
- **Production RNG untouched** (`Math.random`); only the test harness seeds/streams.
- **Workflow:** `gh auth switch --user TheSusort` before PR ops; docs are gitignored (`git add -f`,
  docs-only commits `--no-verify`); dev server on :3000.

---

## 6. Acceptance criteria (epic-level "done")

1. The player/enemy mirror is gone — a single bySide path for turn dispatch, apply, and accounting.
2. The DPS/healing calculators run on real actors; the DPS-calc opponent is a configurable
   skill-less real ship (stats + buffs, defaults = today's).
3. Every accounting approximation documented in `battleSimulator.ts` is closed and backed by an
   audited sim-golden.
4. FrontLine reactive shield tracks actual dealt damage; Meatshield dynamic stack-stealing is
   modeled.
5. All goldens (DPS/healing + sim) are green or audited; `audit:skills` 0 findings; lint + tsc clean.

---

## 7. Open questions (deferred to sub-project specs)

- **SP-U:** DPS-calc opponent HP semantics (non-terminating vs finite) — proposal: non-terminating.
- **SP-U:** exact increment slicing of the ~20 reconciliation points (U1…Un boundaries).
- **SP-0:** sub-stream keying granularity — RESOLVED (SP-0 owns this, settled): finest safe key
  `${actorId}:${purpose}`. Not to be reopened by later sub-projects.
- **SP-F/F6:** whether per-victim crit needs a model change to the deterministic anchor-crit
  convention beyond RNG decoupling.
