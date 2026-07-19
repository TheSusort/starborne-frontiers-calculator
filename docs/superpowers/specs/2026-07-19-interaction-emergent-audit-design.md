# Interaction / Emergent Combat Audit — Design

**Date:** 2026-07-19
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Predecessor:** Ship-Kit Correctness epic (Waves 1–8, PR #269, complete 2026-07-19)

## Problem

The ship-kit correctness epic audited **147 ships / 967 clauses → 57 findings, all fixed**. Its
verdict axes were `WRONG-PARSE` / `MISSING` / `WRONG-EXEC` — a **categorical, does-it-happen**
question, verified almost entirely through **single-ship forced traces** (`buildKitBundle`, one
kit in a controlled cell). The `auditSkills.ts` harness is explicit about its ceiling:

> "There is no ground truth for correctness — this only catches coverage GAPS."

That leaves the **interaction / emergent layer** structurally unexplored: what happens when many
ships' primitives — leader auras, reactive cascades, persistent stacking, detonation chains,
protection/redirect — all live in one 4v4 and collide. Given how many reactive/stacking engine
primitives accreted over Waves 3–8, this is where latent bugs most likely remain.

## Key enabling fact (CORRECTED 2026-07-19, during Task 3)

> **Original claim (WRONG):** "The engine is fully deterministic — no `Math.random`." This was based
> on an incomplete grep (only `src/utils/combat/`, missing `src/utils/calculators/rateAccumulator.ts`).

The truth: **production combat is genuinely random.** `rateAccumulator.ts:18` is `let rng =
Math.random`, and crit/hit/landing gates draw from it. Two raw `simulateBattle` calls on the same
input diverge.

BUT determinism is **achievable and cheap**, because the engine already ships the SP-0 rng-decouple
seams: `setupKeyedTestRng(seed)` installs a seeded keyed sub-stream provider, `resetRateGateRng()`
restores `Math.random`, and `mulberry32(seed)` is the seeded PRNG. Verified: wrapping a run in
`setupKeyedTestRng(seed)` / `resetRateGateRng()` makes it **byte-reproducible** (same seed →
identical, different seed → different).

The harness therefore runs EVERY battle through `runSeededBattle(input, seed)` (seed → run → reset).
Under that discipline the original consequences still hold:

- Differential and ablation diffs are **exact**, not statistical — provided both sides run under the
  same seed (a consumer contract, enforced by `runSeededBattle`).
- Reproducibility is a real check (two seeded runs must match), guarding nondeterminism OTHER than
  the now-pinned RNG (Map iteration order, leaked global state).
- `mulberry32` and the seed seams are **reused** from `rateAccumulator` — the fuzzer does not
  hand-roll a second PRNG the engine never consults.

## Reuse surface (do not reinvent)

- **`simulateBattle(input: BattleSimulationInput)`** — `src/utils/calculators/battleSimulator.ts:774`.
  The same high-level entry point the in-app sim and golden fixtures (`twoVsTwo`, `threeVsThree`)
  drive. The harness builds real 4v4 `BattleSimulationInput`s and calls this.
- **`buildStandardScenario` / `buildKitBundle`** — `scripts/lib/traceScenario.ts`, `scripts/lib/kitBundle.ts`.
  The epic's known-good single-ship forced trace = the differential baseline.
- **`collectActorEntryKinds(log, actorId)`** — `scripts/lib/kitBundle.ts:52`. Behavior-fingerprint
  primitive.
- **Ledger format** — mirror `docs/ship-kit-correctness-ledger.{json,md}`.
- Ship data: `docs/ship-data.json` (`npm run fetch:ship-data`); skills: `docs/ship-skills.csv`
  (`npm run fetch:ship-skills`).

## Oracle strategy (no ground truth)

Four layered oracles. The fuzzer *generates*; the three checkers decide "this is a bug".

### Oracle A — Invariant assertions (`invariants.ts`)

Pure functions over `(simResult, combatLog)`; each returns violations. Must hold in ANY battle, so
a hit is unambiguous. Initial catalog:

| Invariant | Catches |
|---|---|
| HP bounds | HP never < 0 or > maxHP (over-heal / negative-damage sign errors) |
| Shield / stack caps | Shield pool ≤ grant cap; buff stacks ≤ declared cap (Wave-3 count-scaling+cap primitive) |
| Damage-transfer conservation | Protection/redirect: dealt = absorbed + landed (no HP created/destroyed in transfer, #247–249 surface) |
| No double-application | One cast produces each effect on each victim at most once (reactive-cascade re-entrancy, Waves 3/7) |
| Detonation ledger balance | Bomb spread total (Toxic Overflow #49) = sum distributed to victims |
| Team symmetry | Composition mirrored player↔enemy yields mirrored outcomes (canonical engine-symmetry rule) |
| Determinism | Same input twice → byte-identical result (guards Map-order / iteration nondeterminism) |
| Turn-order sanity | No actor acts while dead; reactive cascade depth bounded (no infinite loop) |

New invariants = one pure function each; cheap to extend.

### Oracle B — Differential vs. solo (`differential.ts`)

For each ship in a composition, compare its **behavior fingerprint** solo (its `buildStandardScenario`
forced trace — the epic's known-good baseline) vs. inside the composition. Fingerprint = set of
ability-log-kinds produced + their target classes (via `collectActorEntryKinds`). A kit that *stops*
doing something it does solo, or does something it *never* does solo, is flagged as interference.
Surfaces silent "another ship's aura/stasis/purge suppressed my kit" bugs.

### Oracle C — Ablation / superposition (`ablation.ts`)

For a flagged pair (A, B): run `{A+B}`, `{A}`, `{B}` in matched slots; check whether combined
per-actor outcome is explained by the solo runs. Divergence beyond expected leader/aura additivity =
emergent interaction. **Noisiest oracle** (real synergies look like anomalies) → its output lands in
a separate `needsTriage` bucket in the ledger, mirroring the epic's `needsForcedTrace` separation.

## Architecture

```
scripts/auditInteractions.ts            # entry: npm run audit:interactions
scripts/lib/interaction/
  ├── classes.ts        # interaction-class tagging, DERIVED from parsed abilities (stays in sync)
  ├── compose.ts        # seeded fuzzer: legal 4v4 BattleSimulationInputs from tagged pools
  ├── invariants.ts     # Oracle A catalog (pure fns)
  ├── differential.ts   # Oracle B: solo-vs-composition fingerprint diff
  ├── ablation.ts       # Oracle C: A+B vs A-alone + B-alone
  ├── minimize.ts       # ddmin shrink of a failing composition → minimal repro
  └── ledger.ts         # writes docs/interaction-audit-ledger.{json,md}
src/utils/combat/__tests__/interactionInvariants.integration.test.ts   # permanent seeded gate
```

**Data flow:** `compose` draws a battle → `simulateBattle` runs it (deterministic → exact) →
result + log fed to Oracles A/B/C → any violation `minimize`d to smallest failing ship set →
written to ledger. The invariant catalog is ALSO imported by the permanent Vitest gate over a
curated seed set.

### Interaction-class tagging (`classes.ts`)

Ships tagged **by inspecting their parsed abilities** (`buildShipAbilities`), not a hand-maintained
list — so tagging stays in sync with the parser. Classes: `leader/aura`, `reactive-trigger`,
`persistent-stacking`, `detonation/bomb`, `protection/redirect`, `cleanse/purge`, `control`,
`shield`, `stealth`. The fuzzer biases draws to co-locate same/adjacent classes — deliberately
colliding the Wave 3–8 primitives.

### Fuzzer (`compose.ts`)

Legal `BattleSimulationInput`s: 4 ships/side, valid positional slots, each ship at a **canonical
level-60 base-stat baseline** (same fixed stats the forced-trace scenario uses — no gear/refit
variation; interactions, not stat math). Draw policy: pick a primary interaction class, fill
remaining slots biased toward same/adjacent classes with decaying probability. Reproducibility: an
explicit integer **seed** passed via CLI/args — never `Math.random` / `Date.now` (consistent with
deterministic engine + the scripts-must-be-deterministic memory note). Same seed → same battle set.

### Minimizer (`minimize.ts`)

When an oracle fires on a 4v4, shrink to the smallest ship set that still reproduces (ddmin: drop
ships/sides, re-run `simulateBattle`, keep reduction if violation persists). Output = minimal repro
(often 2–3 ships), directly usable as a fix-plan scenario and as a permanent regression seed. Analog
of the epic's per-finding forced trace.

## Deliverables

1. **Discovery ledger** — `docs/interaction-audit-ledger.{json,md}`, mirroring
   `ship-kit-correctness-ledger`. Per finding: `ships`, `slots`, `seed`, `oracle`
   (invariant/differential/ablation), `invariant`/`fingerprintDiff`, `minimalRepro`, `severity`.
   Top-level: `compositionsRun`, `confirmed`, `needsTriage` (ablation), `refuted`. Drives a follow-up
   **fix epic** (its own brainstorm → waves), exactly like `ship-kit-fix-plan.md`.
2. **Regression gate** — `interactionInvariants.integration.test.ts`: runs the invariant catalog
   over a curated seed set (every minimized repro + a fixed diverse seed sample), asserts zero
   violations. Covered by `npm test`'s golden audit. Stops silent reintroduction.
3. `npm run audit:interactions` script + a short section in the fix-plan doc.

## Non-goals (YAGNI)

- **No magnitude / ground-truth checks** — that is the separate "numeric fidelity" frontier. This
  harness asserts internal-consistency invariants and cross-run diffs only.
- **No gear/refit fuzzing** — canonical base stats only; stat-math out of scope.
- **No UI** — script + ledger + test, matching the epic's toolchain.
- **No auto-fixing** — the harness only *finds*; fixes go through the normal wave workflow.

## Risks / calibration

- **Ablation triage burden** — Oracle C separates real synergies from bugs by hand; budgeted via the
  `needsTriage` bucket.
- **Harness-asymmetry false positives** — team-symmetry and determinism invariants may surface
  *harness* setup asymmetries before real bugs. Early runs need a calibration pass (analog of the
  epic's Wave-0 harness calibration) before findings are trusted.

## Workflow constraints (from project memory)

- Full `npm test` is the golden audit; never `vitest -u`.
- Worktrees lack the gitignored `.env` (copy it in) and hit the fresh-worktree Vite/esbuild crash
  (tests/build unaffected).
- `gh auth switch --user TheSusort` before PR ops; dev server on :3000.
- Scripts must avoid `Math.random` / `Date.now` (determinism/resume).
