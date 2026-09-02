# Role-Focused Simulation Multiplier — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation
**Scope:** `src/components/gear/GearUpgradeAnalysis.tsx` (caller-side only)

## Context

The Analyze Gear feature runs `analyzePotentialUpgrades` once per `(role, slot)` pair. Each call runs `simulationCount` Monte Carlo upgrade simulations per eligible piece to estimate the piece's potential score. Current per-rarity counts are 10 / 20 / 40 for rare / epic / legendary.

After the fast-potential work shipped (2026-04-20, wall-clock for a 11,619-piece inventory on AEGIS dropped from 74.6 s → 2.5 s across all 12 roles), a role-focused run (single role, not "all") processes 1/12th the work — roughly 210 ms. That leaves substantial budget to trade runtime for precision.

## Goal

When the user has narrowed scope to a specific role (`selectedRole !== 'all'`), multiply the per-rarity `simulationCount` by 3 before invoking `analyzePotentialUpgrades`. Monte Carlo variance shrinks as 1/√N, so 40 → 120 simulations reduces relative error by ~42%. Wall-clock stays well under 1 s per role.

## Non-goals

- No change to `analyzePotentialUpgrades` / `fastAnalyzePotentialUpgrades` / `slowAnalyzePotentialUpgrades` — the multiplier is purely caller-side.
- No new UI control, toggle, or prop. The behavior is automatic and invisible from the user's perspective.
- No change to the "all roles" path — 10 / 20 / 40 stays. Users who analyze broadly continue to get the current runtime budget.
- No changes in slot-focused behavior — `selectedSlots[role]` continues to control which result set is displayed, not the simulation count.

## Approach

Introduce a module-level constant and apply it inside `processRole`:

```ts
// Constant, module-top in GearUpgradeAnalysis.tsx
const ROLE_FOCUSED_SIMULATION_MULTIPLIER = 3;
```

```ts
// Inside processRole, after the existing per-rarity simulationCount derivation:
if (selectedRole !== 'all') {
    simulationCount *= ROLE_FOCUSED_SIMULATION_MULTIPLIER;
}
```

Final per-run simulation counts:

| Rarity | `selectedRole === 'all'` | `selectedRole !== 'all'` |
|---|---|---|
| rare | 10 | 30 |
| epic | 20 | 60 |
| legendary | 40 | 120 |

Projected wall-clock for a role-focused run on the benchmark inventory (11,619 pieces, AEGIS, post-fast-potential): ~630 ms for rare (3× of ~210 ms), ~1.3 s for legendary. Both comfortably below the pre-fast-path baseline.

### Why a multiplier, not per-rarity custom counts

A single named constant (`ROLE_FOCUSED_SIMULATION_MULTIPLIER = 3`) keeps the relationship between the two configurations transparent — any change to the base rarity counts automatically flows to the role-focused variant at the same ratio. Tuning later (e.g. 3× → 4×) is a one-line diff.

### Why applies to dummy mode too

Dummy mode with a role selected currently takes ~330 ms per role on the same inventory. Tripling simulations → ~1 s. Still fast. The simpler rule ("narrow scope → higher precision") avoids a special case and gives dummy-mode users the same quality signal as with-ship users.

## Correctness

Zero semantic risk: `simulationCount` is already a well-defined input to `analyzePotentialUpgrades`, handled identically by both fast and slow paths. Any positive integer value is valid. The Monte Carlo average of N independent simulations remains an unbiased estimator of the expected potential score as N grows; the only effect of tripling N is reduced variance.

## Testing

No new tests. Justification:

- The equivalence suite (`src/utils/gear/fastPotential/__tests__/equivalence.test.ts`, 38 tests) already covers `simulationCount` of 10, 20, and 40 across 12 roles. Tripling the value exercises the same code paths more deeply; there is no new branch to test.
- A unit test on the multiplier arithmetic itself (`if (selectedRole !== 'all') count *= 3`) would cover 3 lines of trivial caller code and couple the test to the constant's literal value.
- Manual verification post-change: pick a ship + role, run Analyze, confirm (a) wall-clock stays sub-second per role, (b) `[AnalyzeGear]`-style timing makes sense, (c) Top-6 results are stable across repeat runs (variance should be visibly lower than before).

## Files touched

**Modified:**
- `src/components/gear/GearUpgradeAnalysis.tsx` — add `ROLE_FOCUSED_SIMULATION_MULTIPLIER` constant near `RARITY_OPTIONS`; apply the multiplier inside `processRole` after the existing per-rarity `simulationCount` derivation.

**Not touched:**
- `src/utils/gear/potentialCalculator.ts`
- `src/utils/gear/fastPotential/*`
- Every other caller of `analyzePotentialUpgrades`

## Rollback

Set `ROLE_FOCUSED_SIMULATION_MULTIPLIER = 1` or remove the conditional. No data impact, no cache invalidation needed.

## Open questions

None.
