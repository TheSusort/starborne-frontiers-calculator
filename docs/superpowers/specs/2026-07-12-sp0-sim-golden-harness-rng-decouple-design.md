# SP-0 — Sim-Golden Harness + RNG-Stream Decoupling

**Parent epic:** `2026-07-12-team-agnostic-engine-unification-epic-design.md` (approved).
**Status:** Design (2026-07-12).
**Gameplay change:** NONE. Test-infrastructure + new golden fixtures only. Production RNG untouched.

SP-0 is the safety foundation for the epic: it (A) decouples the seeded test RNG so later fidelity
PRs have *local* golden churn, and (B) captures high-level `BattleResult` sim goldens covering the
team-vs-team paths SP-U/SP-F rewrite. It must land before any engine surgery.

---

## Part A — RNG-stream decoupling

### Problem

`rateAccumulator.ts`: every gate is a stateless closure reading the **single module-global `rng`**.
`setupTests.ts` installs one `mulberry32(RATE_GATE_TEST_SEED)` in a global `beforeEach` (reset in
`afterEach`). So under the seed, the golden trajectory is coupled across **every** probabilistic
draw in the battle — crit, debuff landing (hacking vs security), charge manip, procs, counter crits.
Any later change that adds/removes/reorders a draw shifts every subsequent draw, cascade-moving
goldens for unrelated actors. (This is why per-victim crit — F6 — "churns ~all goldens".) The
`// own instances — determinism isolation` comment at `playerTurn.ts:280` is **stale**: the ~22
`makeRateGate()` instances (19 in `engine.ts`, 3 in `triggers.ts`) do NOT isolate streams.

### Approach: keyed sub-streams (test-only)

Parameterize the gate factory: `makeRateGate(streamKey?: string)`. In **production**, `streamKey` is
ignored and the closure draws from `Math.random` exactly as today (zero behavior change). In **test
mode**, the active RNG is a *stream registry* that lazily mints one seeded `mulberry32` sub-stream
per `streamKey` (derived deterministically from the base seed + a hash of the key), so a gate keyed
`e:2:crit` draws independently of one keyed `p:1:landing`.

- **Keying source:** the per-actor gate creation sites already hold actor context (e.g.
  `teamDebuffLandingGate` inside the per-team-actor loop `engine.ts:1812`, the focus gates at
  `:1619`, the enemy gates at `:581`). Key = `${sideActorId}:${purpose}` (purpose ∈
  crit/heal-crit/landing/extend/charge/proc/counter…). Module-level focus/enemy gates use fixed
  ids. Reactive gates created per-drain (`triggers.ts:1715/2393/2423`) get keyed by the owner id in
  scope at the drain site.
- **Context-less sites** (if any gate lacks a stable key) fall back to a shared `"global"` stream —
  the spike enumerates these; goal is zero, acceptable is a small documented set.

### Characterization spike (first task)

Before wiring, measure the cascade on the Part-B fixtures: introduce a throwaway extra draw for one
actor and confirm how many *other* actors' `BattleResult` values move under the shared stream (the
problem), then re-confirm the same probe under keyed sub-streams moves **only** that actor's values
(the fix). This both validates the approach and picks the **coarsest keying that localizes churn**
(per-actor may suffice; per-actor-per-purpose if a single actor's own multi-gate draws still
interfere). Decision recorded in the plan, not pre-committed here.

### The one-time audited golden move

Switching the test RNG from one shared stream to keyed sub-streams **reassigns which draw each gate
sees** → the existing synthetic DPS/healing goldens move once. This is the sole sanctioned
`vitest -u`-style regeneration in SP-0, and it is **audited**: the diff must be pure draw-reassignment
(crit/land booleans flip per the new streams) with **no structural change** — same events, same
actors, same rounds. Document the before/after of a couple of representative goldens in the PR.

### Files (Part A)

`src/utils/calculators/rateAccumulator.ts` (stream registry + `makeRateGate(key?)`), `src/setupTests.ts`
(install the registry-backed seeded RNG), the ~22 `makeRateGate()` call sites in `engine.ts` /
`triggers.ts` (pass keys), and the stale `playerTurn.ts:280` comment (corrected/removed).

---

## Part B — Sim-golden harness

### Approach

`simulateBattle()` + `assembleBattleResult()` + the `BattleResult` interface already exist
(`battleSimulator.ts`). Part B adds a golden test that runs `simulateBattle` on four fixed fixtures
under the seeded (now keyed) RNG and snapshots the resulting `BattleResult`. These become the
**high-level guard**: SP-U increments keep them byte-identical (pure refactor); SP-F increments move
them deliberately with audited diffs.

### The four fixtures (user-approved default set)

1. **2v2 mixed roles + DoT/bomb** — an attacker + a supporter vs two enemies, at least one DoT and
   one bomb in play (exercises DoT ticks, detonation, per-turn decrement).
2. **3v3 AoE + reactions + support/hybrid** — includes an AoE-pattern attacker, a reactive ship
   (counter/on-attacked), and a support/hybrid ship whose incidental damage currently hits the dummy
   sink (gives F1/F7 real coverage).
3. **DPS-mode: attacker vs skill-less real ship** — single focus attacker against the SP-U DPS-calc
   opponent shape (real actor, no skills, default stats). Locks the DPS degenerate case.
4. **Healing-mode: healer + tank vs two enemies** — exercises heal routing, shields, and enemy
   inflictions against tank security (gives F2/F3/F4 coverage).

Fixtures are hand-built roster inputs (stable ship stats/abilities/positions), NOT random — kept in
a committed fixtures module so CI runs them without the gitignored `docs/*.csv`.

### Snapshot discipline

Snapshot the structured `BattleResult` (per-round per-ship damage/heal/shield/hpPct/alive/buffs +
outcome), NOT a free-text log. A diff = a real behavior change to audit. `vitest -u` forbidden except
the Part-A one-time reassignment.

### Files (Part B)

New `src/utils/calculators/__tests__/simGolden.fixtures.ts` (the four rosters) +
`simGolden.test.ts` (snapshot assertions). No production code changes.

---

## Non-goals

- No engine behavior change (Part A is draw-assignment only; Part B is new tests).
- No distribution/Monte-Carlo assertions — one seeded trajectory per fixture.
- No new mechanics, no UI.

## Acceptance

1. `makeRateGate` supports keyed sub-streams; production path unchanged (`Math.random`).
2. Spike demonstrates local churn under keying (probe moves only the probed actor).
3. Existing DPS/healing goldens green after the one audited draw-reassignment move (pure
   reassignment, no structural change, documented).
4. Four `BattleResult` sim goldens committed and green.
5. Full suite green, lint + tsc clean, `audit:skills` 0 findings.

## Open questions (for the plan)

- Keying granularity: per-actor vs per-actor-per-purpose — decided by the spike.
- Any context-less gate sites needing a `"global"` fallback — enumerated by the spike (target zero).
