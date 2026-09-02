# Autogear Fast-Path Scoring — Design

**Date:** 2026-04-19
**Status:** Approved, ready for implementation planning
**Scope:** `src/utils/autogear/` (new `fastScoring/` subdirectory), `src/utils/autogear/strategies/GeneticStrategy.ts`, `src/utils/autogear/scoring.ts`, `src/utils/autogear/BaseStrategy.ts`

## Context

The Genetic autogear strategy is the only user-facing optimizer and runs 36K–288K fitness evaluations per optimization, all on the main thread. A representative run today (single ship "Salvation", inventory of 773 pieces, 670ms total):

| Phase | Time | Share |
|---|---|---|
| `CalculateTotalStats` | 191 ms | 29% |
| `Breeding` (selection + crossover + mutation) | 141 ms | 21% |
| `CreateCacheKey` | 66 ms | 10% |
| `CalculateSetCount` | 40 ms | 6% |
| `CheckCache` / `CacheResult` | 33 ms | 5% |
| `CalculatePriorityScore` | 7 ms | 1% |
| Arcane Siege / arena modifiers | ~14 ms | 2% |

Two observations drive this design:

1. The stat-calculation pipeline is ~60% of total runtime (stats + cache key + set count = 297ms of 670ms). Every call allocates plain objects, spreads them, and enumerates property keys.
2. The cache hit rate is only 28% (18K hits of 65K calls). `CreateCacheKey` — which runs on *every* call before the cache is even consulted — spends ~1μs per call on `Object.entries().sort()` string building.

The priority-scoring step itself is a rounding error (7ms / 1%), so we deliberately leave it alone.

## Goals

- **Reduce single-run wall-clock time by ~40–50%** on representative inventories (target: 670ms → ~350ms for the Salvation case).
- **Preserve result quality exactly.** The GA algorithm itself (selection, crossover, mutation, elitism) is unchanged; the only thing that changes is how fitness is computed inside the loop.
- **Keep the existing public scoring API (`calculateTotalScore`, `calculateTotalStats`) untouched** so that non-GA callers (ship details, gear comparison UI, admin/import flows) are unaffected.
- **Every phase independently shippable.** If a later phase stalls, earlier phases still deliver real gains.

## Non-goals

- Web Workers, WebAssembly, SIMD. (User confirmed prior investigation showed limited realistic gain from workers.)
- Changing the GA algorithm — no new selection scheme, no new mutation strategy, no reducing population/generations.
- Delta scoring (recomputing only what changed between parent and child). Tempting, but the set-bonus threshold semantics make this error-prone; not justified when the rewrite below already meets the target.
- Changing public scoring functions internally. They remain exactly as they are.
- Performance assertions in CI. Timing is noisy; we benchmark locally before/after each phase.
- UI changes. This is invisible to users except as "autogear got faster".

## Approach

The GA's hot path runs on a **parallel fast-scoring module** that lives alongside — not in place of — the existing scoring. The design has two clean layers:

```
┌─────────────────────────────────────────────────┐
│ Existing public API (UNCHANGED)                 │
│   calculateTotalScore(ship, equipment, ...)     │
│   calculateTotalStats(ship, equipment, ...)     │
│ Callers: ship details, autogear result display, │
│          non-GA code paths                      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ NEW: src/utils/autogear/fastScoring/            │
│   statVector.ts     Float64Array layout         │
│   gearRegistry.ts   Integer IDs for gear        │
│   shipPrefix.ts     Per-ship constant prefix    │
│   fastCalculateStats.ts  Hot-loop stat compute  │
│   fastScore.ts      Equivalent of totalScore    │
│   fastCache.ts      Integer-keyed LRU cache     │
│   context.ts        Built once per GA run       │
│ Callers: GeneticStrategy only                   │
└─────────────────────────────────────────────────┘
```

A `FastScoringContext` is built once at the start of `findOptimalGear` and threaded through the inner loop. When the GA returns a winner, the displayed score and stats are recomputed using the **existing** slow path — so UI output is guaranteed correct even if the fast path ever drifted.

### Why a parallel module, not a rewrite in place

- Zero blast radius to the ~30 call sites of `calculateTotalStats` outside the GA.
- The fast path makes representation tradeoffs (typed arrays, integer IDs, fixed stat layout) that are hostile to readability — it's fine for a tight inner loop but a bad fit for general scoring code.
- Equivalence can be asserted by running both paths side-by-side (see *Correctness*).

## Design

### 1. Stat vector layout (`statVector.ts`)

One `Float64Array` per "stats state". Fixed index layout — no maps, no property lookups:

```
Indices  0–7   : flat stats      (hp, attack, defence, hacking, security, speed, crit, critDamage)
Indices  8–15  : percent stats   (hpPercent, attackPercent, ..., speedPercent)
```

The exact layout is derived from `src/types/stats.ts` at implementation time — these indices are illustrative.

Helpers:

- `createStatVector(): Float64Array` — zeroed, correct length
- `copyStatVector(src, dst)` — single `for` loop; no allocation when `dst` is preallocated
- `addStatVector(target, addend)` — in-place component-wise addition
- `scaleStatVector(target, percents)` — applies percent stats to flat stats

All inner-loop stat math becomes tight indexed loops. No object spreads, no property enumeration.

### 2. Gear registry (`gearRegistry.ts`)

Built once per GA run. Assigns each gear piece in the pre-filtered inventory an integer ID `0..N-1`:

```ts
interface GearRegistry {
  idOf: Map<string, number>      // gearPiece.id (string) -> int id
  pieces: GearPiece[]             // id -> original piece (for result mapping)
  statVectors: Float64Array       // flat: N * STAT_COUNT floats, pre-computed stat contribution per piece
  setIds: Uint8Array              // id -> integer set bonus ID (0 = no set)
  slotIds: Uint8Array              // id -> 0..5 (weapon, hull, etc.)
}
```

Each piece's stat contribution (main stat + substats, pre-scaled by star/level as today) is precomputed into `statVectors` at registry build time. Fetching a piece's contribution in the hot loop becomes a pointer offset, not a function call.

Set bonus names (`lethal`, `sturdy`, …) also get integer IDs. The inner loop's set-count tracking is a small `Uint8Array` indexed by set ID, not a string-keyed object.

### 3. Ship prefix (`shipPrefix.ts`)

For each ship in the team (the GA today optimizes one ship at a time, but the structure generalizes), collapse base stats + refits + engineering into a single `Float64Array`. Computed **once** at context-build time — not per generation, not per individual.

Stats computation inside the loop becomes:

1. `copy(prefix) → workspace` (single loop, no allocation)
2. Add each gear piece's precomputed stat vector (6 loops of STAT_COUNT floats)
3. Add each implant's precomputed stat vector
4. Increment set counts (`Uint8Array`)
5. Apply set bonuses from a lookup table
6. Apply percent-stat multipliers to flat stats
7. Apply arena modifiers (if present) — only once, not twice like today
8. Apply Arcane Siege multiplier (single conditional check)

This replaces the bulk of today's `calculateTotalStats` inside the hot loop.

### 4. Integer-keyed cache (`fastCache.ts`)

Cache key = 6 gear IDs (per slot, `-1` if empty) + implant IDs. Encoded as either:

- A packed `BigInt` if the ID space fits. For 773 pieces = 10 bits per ID; 6 slots + 5 implants = 11 × 10 = 110 bits → one `BigInt`.
- Or a small fixed-length string like `${id1},${id2},...`. Slower than BigInt but still dramatically cheaper than `Object.entries().sort().join()`.

The implementation chooses based on benchmark evidence; the design just requires "cheaper than today's string key with `Object.entries().sort()`".

LRU implementation:

- `Map<Key, number>` where `Map` preserves insertion order in JS
- Cache hit: `delete(key)` then `set(key, value)` to mark as recently used
- Overflow: delete the first (oldest) entry returned by `map.keys().next()`
- ~20 lines, no external deps

### 5. Inventory-by-slot index

`Map<GearSlotName, number[]>` holding integer IDs (not objects), built once. The GA's mutation step uses this instead of `inventory.filter(g => g.slot === slot)`, which today allocates a fresh array on every mutation.

### 6. FastScoringContext (`context.ts`)

Bundles everything built once per run:

```ts
interface FastScoringContext {
  registry: GearRegistry
  inventoryBySlot: Map<GearSlotName, number[]>
  shipPrefix: Float64Array
  priorityConfig: PriorityConfig   // pre-compiled priority/bonus rules
  arenaModifiers: ArenaModifiers | null
  cache: FastCache
  workspace: Float64Array           // reused per call; avoids re-alloc
}

buildFastScoringContext(
  ship, inventory, priorities, statBonuses, arenaModifiers
): FastScoringContext
```

`GeneticStrategy.findOptimalGear` builds this once at the top, then the inner loop calls `fastScore(context, individual)` instead of `calculateTotalScore(...)`.

### 7. Equivalence verification

A `VERIFY_FAST_SCORING` flag (dev-only, tree-shaken in prod via Vite's `import.meta.env.DEV`):

- When on, `fastScore` internally runs both paths and `console.error`s if the results differ by more than `1e-9`
- Zero runtime cost when off
- Useful while developing; remains available as a diagnostic after merge

## Phased rollout

Each phase is independently shippable.

**Phase 1 — Surgical wins (no new files)**
- Pre-index inventory by slot in `GeneticStrategy.findOptimalGear`; update mutation to use the index instead of `inventory.filter()`.
- Switch the score cache in `scoring.ts` from "full clear on overflow" to LRU eviction.
- Throttle `ProgressTracker.onProgress` callbacks (emit at most every 16ms *or* every N operations, whichever is first; N is chosen to preserve responsiveness).
- Audit and remove the duplicated arena-modifier application between `calculateTotalScore` and `calculateHardViolation` in `scoring.ts` / `priorityScore.ts`.

Expected gain: ~100–150ms (15–22% faster).

**Phase 2 — Introduce `fastScoring/` module (no call sites yet)**
- Build `statVector.ts`, `gearRegistry.ts`, `shipPrefix.ts`, `fastCalculateStats.ts`, `fastScore.ts`, `fastCache.ts`, `context.ts`.
- Unit tests for each module against `calculateTotalStats` / `calculateTotalScore` output using randomized ship + gear inputs.
- No production call sites — existing code paths are unaffected.

No runtime change.

**Phase 3 — Wire GA to fast path behind a flag**
- `GeneticStrategy` builds a `FastScoringContext` in `findOptimalGear`.
- `calculateFitness` routes through `fastScore` when `USE_FAST_SCORING` is on, `calculateTotalScore` otherwise.
- Verification mode runs both paths in dev builds and asserts equality.

No user-visible change yet; gain is behind the flag.

**Phase 4 — Flip the flag**
- Default `USE_FAST_SCORING` to on after equivalence tests + benchmarks look good.
- `calculateTotalScore` stays in the codebase — it's used by UI and non-GA call sites.

Target gain: ~250–350ms (40–50% faster end-to-end). Phase-1 wins compound.

**Phase 5 — Benchmark harness (accompanies phases 1 and 4)**
- `scripts/benchmark-autogear.ts` or a dev-only route.
- Loads a fixed inventory snapshot (checked-in JSON fixture).
- Runs autogear with a fixed RNG seed.
- Prints the `performanceTimer` summary.
- Run manually; results recorded in PR descriptions.

## Correctness & testing

### Unit tests: randomized equivalence

New file `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts`:

- Seeded PRNG generates ~100 deterministic scenarios: ship template + random equipment + random priorities + optional arena modifiers + optional stat bonuses + optional hard requirements.
- For each scenario, assert `fastScore(...)` ≈ `calculateTotalScore(...)` within `1e-9`.
- Also assert full stat vectors match component-wise (catches silent cancellation bugs where a wrong hp and wrong attack sum to the same score).

Explicit coverage over:

- All 6 gear slots populated; partial-slot cases (1 slot, 3 slots, 5 slots)
- 0 / 2 / 4 / 6-piece set bonus thresholds, for every set bonus present in the fixture inventory
- Every implant type combination
- Ships with and without refits
- Ships with and without engineering bonuses
- Priorities on flat stats; priorities on percent stats; mixed
- Arcane Siege active and inactive
- Arena modifiers present and absent

### Verification mode (runtime)

`VERIFY_FAST_SCORING` dev-only flag — described in *Design §7*. When on, every `fastScore` call runs both paths and logs divergence. Zero cost when off.

### Architectural safety net

Final output to the UI uses the **slow path** — GA picks winners using fast scores, but the displayed numbers are computed with `calculateTotalScore`/`calculateTotalStats`. Even if the fast path developed an undiscovered drift, users see correct stats. Worst case is the GA picks a slightly suboptimal combination, which is already within the noise of a stochastic algorithm.

### Benchmark regression

`scripts/benchmark-autogear.ts`:

- Loads a fixed inventory snapshot.
- Runs autogear with a fixed RNG seed.
- Prints `performanceTimer` summary.
- Run locally before/after each phase; numbers recorded in PR description.

Not part of CI — timing is noisy and inventory/ship complexity varies.

### Deliberately not tested

- UI end-to-end for autogear (unchanged, covered by manual QA).
- Performance assertions in CI (flaky, low value).

## Risks & rollback

### Risks, by likelihood × blast radius

**1. Score drift between fast and slow paths** — *medium likelihood, small blast.* Floating-point order-of-operations bugs are easy to introduce in a rewrite. Mitigated by randomized equivalence tests, verification mode, and the architectural safety net (UI uses slow path).

**2. Set bonus accounting bug** — *medium likelihood, medium blast.* Thresholds at 0/2/4/6 pieces are easy to off-by-one when replacing string-keyed with `Uint8Array` counts. Mitigated by explicit per-threshold coverage in equivalence tests (not just random coverage).

**3. Cache key collisions** — *low likelihood, catastrophic blast.* If two equipment states map to the same key, the GA sees a wrong cached score. Equivalence tests naturally catch this (a collision produces a score mismatch).

**4. Refactor scope creep** — *medium likelihood, low blast.* Tempting to clean up `calculateTotalStats` or adjacent code while in flight. The phased plan explicitly keeps existing functions untouched. Any "while we're here" cleanup is out of scope.

**5. Benchmark numbers miss projections** — *medium likelihood, low blast.* Phase 1 surgical wins deliver meaningful gains on their own (~100–150ms). Even if the fast path delivers half of what's projected, the overall result still beats the current state.

### Rollback plan

- `USE_FAST_SCORING` feature flag defaults to off on first merge.
- If a post-flip regression is reported, flip it off. No code revert required.
- Each phase is independently shippable. A stalled Phase 3/4 leaves Phase 1's wins in place.
- Old `calculateTotalScore` and `calculateTotalStats` stay in the codebase permanently (used by non-GA callers). "Reverting" the fast path means deleting new code, not restoring removed code.

### Explicitly avoided operations

- **No GA algorithm changes** — selection, crossover, mutation logic all stay identical.
- **No public API changes** — `calculateTotalScore` / `calculateTotalStats` signatures stable.
- **No removal of `scoring.ts`'s existing cache** — it serves non-GA callers.

## Files touched

### New files (Phase 2)
- `src/utils/autogear/fastScoring/statVector.ts`
- `src/utils/autogear/fastScoring/gearRegistry.ts`
- `src/utils/autogear/fastScoring/shipPrefix.ts`
- `src/utils/autogear/fastScoring/fastCalculateStats.ts`
- `src/utils/autogear/fastScoring/fastScore.ts`
- `src/utils/autogear/fastScoring/fastCache.ts`
- `src/utils/autogear/fastScoring/context.ts`
- `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts`
- `scripts/benchmark-autogear.ts` (Phase 5)

### Modified files
- `src/utils/autogear/strategies/GeneticStrategy.ts` — Phase 1 mutation indexing; Phase 3 `FastScoringContext` wiring.
- `src/utils/autogear/scoring.ts` — Phase 1 LRU cache eviction; audit for duplicated arena modifier application.
- `src/utils/autogear/priorityScore.ts` — Phase 1 audit for duplicated arena modifier application.
- `src/utils/autogear/BaseStrategy.ts` — Phase 1 progress throttling.

### Untouched (by design)
- `src/utils/ship/statsCalculator.ts` — public stat calculation stays as-is.
- All UI components under `src/components/autogear/`.
- `src/pages/manager/AutogearPage.tsx`.
- Every non-GA caller of `calculateTotalScore` / `calculateTotalStats`.

## Open questions (for planning phase)

- **Cache key encoding**: BigInt-packed vs fixed-length string? Resolve during Phase 2 implementation with a micro-benchmark of both against a typical inventory size.
- **Progress throttle cadence**: 16ms wall-clock or N operations? Resolve in Phase 1 by measuring UI responsiveness at different cadences on the representative run.
- **Inventory snapshot fixture**: captured from which real user? Needs to be realistic (several hundred pieces, mix of sets/rarities) but free of PII — likely a synthesized fixture generated by a seed-based script rather than a real user export.
