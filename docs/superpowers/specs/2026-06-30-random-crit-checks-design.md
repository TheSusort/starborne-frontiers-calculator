# Random crit / hacking-security checks — design

**Date:** 2026-06-30
**Status:** Approved (pending spec review)

## Problem

The combat engine resolves all probabilistic events (crit, debuff landing, charge-manip
checks, proc chances) through a **deterministic fractional accumulator** (`makeRateGate` /
`rollRateGate` in `src/utils/calculators/rateAccumulator.ts`). The accumulator starts at `0`
and fires only once the supplied rate has fully accumulated to `1`.

Consequence: the schedule is **back-loaded**. At a 99% crit rate, call 1 adds 0.99 (< 1 → no
crit) and call 2 reaches 1.98 (→ crit). The **first hit can never crit below 100%**, and
spacing is rigidly even rather than random. For openers, burst, and short fights this skews
results materially. The same gate backs debuff landing (the hacking-vs-security check), charge
manipulation, proc chances, and counter crits — so the skew is system-wide.

## Decision

Replace the deterministic accumulator with **true `Math.random()` draws** in production, for
both the combat sim (`SimulatorPage` → `simulateBattle`) and the DPS/healing calculators
(`simulateDPS`) — both are thin adapters over the same `runCombat` engine and share the same
gates.

Locked choices (from brainstorming):

1. **DPS headline number** = single random run. The figure will jitter on each recalculation.
   Accepted. No Monte Carlo averaging (YAGNI).
2. **Truly random** via `Math.random()`. No product-facing seed or UI.
3. **Golden snapshots survive** (see test seam below) — re-baselined once, not deleted.
4. **Test seam** = injectable RNG override (test-only; production uses raw `Math.random`).

## Architecture

Every gate in the engine flows through the two functions in `rateAccumulator.ts`, so the
production behavior swap is centralized to **one file with zero call-site churn**.

### 1. Production — `src/utils/calculators/rateAccumulator.ts`

- Module-level `let rng: () => number = Math.random`.
- `makeRateGate()` returns a **stateless** closure: `(rate) => rng() < clamp(rate, 0, 1)`.
  The accumulator state is deleted. Each `makeRateGate()` still returns its own function (for
  signature compatibility), now an independent random draw.
- `rollRateGate(gates, key, chance)`: preserve the `gates == undefined → true` pass-through
  contract (D-PR4); otherwise `return rng() < clamp(chance)`. The per-key map becomes vestigial
  but stays so call sites are untouched.
- Edge cases preserved: `rate >= 1` always fires (`rng()` is `[0,1)`); `rate <= 0` never fires.
- **Names kept** (`makeRateGate`, `rollRateGate`, file name) to avoid rippling ~10 imports. The
  file's doc comment is updated to describe random draws instead of the accumulator.

### 2. Test seam — same file

- Export `setRateGateRng(fn: () => number)` and `resetRateGateRng()`. Test-only; production
  never calls them, so `rng` remains `Math.random` in the shipped bundle.

### 3. Global deterministic default for tests — `src/setupTests.ts`

- A global `beforeEach` installs a **seeded deterministic PRNG** (mulberry32, fixed seed) as the
  default RNG; `afterEach` calls `resetRateGateRng()`.
- This makes the **test environment** reproducible without per-file opt-in. Production is
  unaffected and stays truly random.
- Because the test env is deterministic, golden snapshots (`dpsGoldenParity`,
  `healingGoldenParity`, `perHitCrit`) **survive as snapshots**, re-baselined once against the
  seeded sequence. They still guard the damage/mechanics math — only the RNG source swapped
  (accumulator → seeded PRNG).

### 4. Forcing in scheduling-specific tests

- Tests asserting "a crit happened" / "debuff landed" override per-test:
  `setRateGateRng(() => 0)` (always fire), `() => 0.999` (never fire), or a scripted sequence.
- `rateAccumulator.test.ts` is rewritten: the spacing-math assertions are removed; new tests
  cover rng-respect, clamping, rate-1-always / rate-0-never, and a statistical check. The
  statistical check must **temporarily install raw `Math.random`** (`setRateGateRng(Math.random)`)
  and assert `N` draws ≈ rate within a loose tolerance (large `N`, generous band) so it cannot
  flake — it must not run under the seeded default. Reset after.

## Test blast radius

- **Re-baseline once (snapshots):** `dpsGoldenParity.test.ts`, `healingGoldenParity.test.ts`,
  `perHitCrit.test.ts`. Use `vitest -u` on **those files only** — never blanket-update goldens.
- **Rewrite with forcing / new assertions:** `rateAccumulator.test.ts`, `dynamicLanding.test.ts`,
  `procChanceGate.test.ts`, `reactiveDamageProcGate.test.ts`, `reactiveBuffProcGate.test.ts`,
  `enemyDebuffLandingChance.test.ts`, `dpsSimulator.test.ts`, `decimationDps.test.ts`.
- **Pass unchanged:** behavior/mechanics tests that set crit to 0/100, use `noCrit`, or don't
  assert crit-dependent values — the deterministic seeded default keeps them stable.
- Final triage is empirical: run full `npm test`, then fix what the seeded default doesn't cover.

## Out of scope (YAGNI)

- Monte Carlo averaging of the DPS number.
- Product-facing seed or seed UI.
- Renaming `rateAccumulator` / `makeRateGate` / `rollRateGate`.

## Changelog

User-facing behavior change (combat sim + DPS/healing calculators now use real random chance
instead of deterministic scheduling) → add an entry to `UNRELEASED_CHANGES` in
`src/constants/changelog.ts` before committing the implementation.
