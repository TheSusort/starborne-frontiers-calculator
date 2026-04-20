# Gear Analyze Fast-Potential — Design

**Date:** 2026-04-20
**Status:** Approved, ready for implementation planning
**Scope:** `src/utils/gear/potentialCalculator.ts`, new `src/utils/gear/fastPotential/` module, shared primitives extracted from `src/utils/autogear/fastScoring/` to `src/utils/fastScoring/`, `src/components/gear/GearUpgradeAnalysis.tsx` (cleanup only)

## Context

The "Analyze Gear" feature on the gear page (`GearUpgradeAnalysis.tsx` → `analyzePotentialUpgrades` in `potentialCalculator.ts`) is slow on real inventories. Baseline timer data on a 11,619-piece inventory:

| Path | Total | Per role |
|---|---|---|
| No selected ship ("dummy") | 4.1 s | ~340 ms |
| Selected ship (real stats) | **82.2 s** | ~6.8 s |

The with-ship path is ~20× slower than the dummy path. The gap isn't algorithmic — both paths do "score a piece against a baseline" — but the ship path allocates a fresh `StatBreakdown` (6 cloned `BaseStats` objects) *per scored piece*, and with ~1.2 M scoring calls per session that's ~7.2 M object allocations per click, dominated by GC pressure.

The autogear fast-scoring module (shipped 2026-04-19, `USE_FAST_SCORING = true` on main) demonstrates that replacing per-call `BaseStats` allocations with reused `Float64Array` workspaces reliably reduces wall-clock time 40 %+ on real workloads. That validation is the basis for applying the same technique here.

## Goals

- **Drop wall-clock time on both analyze-gear paths.** Projected: 82 s → ~10–15 s on the with-ship path (5–8×), 4 s → ~1–1.5 s on the dummy path (3–4×). Validated on the user's real inventory before claiming success.
- **Unify both paths behind a single fast-scoring module.** Today the ship and dummy paths diverge into ~150 and ~50 lines of separate stat-accumulation logic. A single fast path expresses both by varying the baseline input.
- **Zero change to the feature's public API.** `analyzePotentialUpgrades` signature stays stable; `GearUpgradeAnalysis.tsx` is untouched except for removing the temporary console timers after the work lands.
- **Every phase independently shippable.** The shared-primitives extraction can ship alone. The new module can ship dark (flag off). The dispatch can ship behind the flag. The flip is its own commit.
- **Equivalence is the primary correctness gate.** Fast path must produce identical piece rankings (same IDs, same order) with per-piece scores within relative `1e-6` of the slow path across every realistic scenario.

## Non-goals

- **Changing `calculateTotalStats`, `calculatePriorityScore`, `simulateUpgrade`, `ROLE_BASE_STATS`, or `SUBSTAT_RANGES`.** The existing slow-path functions remain canonical. The fast path is parallel, not a replacement.
- **Optimizing the baseline computation itself.** The slow path's `baselineBreakdownCache` already handles this — `calculateTotalStats` runs once per slot per session and is cached. The fast path reads from that cache rather than rebuilding it.
- **Changing the UI.** `GearUpgradeAnalysis.tsx` receives no new props, no layout changes, no new controls. Only the temporary `console.log('[AnalyzeGear] ...')` timers will be removed at the end.
- **Web workers, WASM, SIMD.** Scoped out of autogear; scoped out here.
- **Caching across sessions.** Context is built per `analyzePotentialUpgrades` call. No persistence.
- **Performance assertions in CI.** Timing is noisy; benchmark is manual (user runs in-browser, pastes timer output).

## Approach

A parallel fast-scoring module lives alongside `potentialCalculator.ts`. The existing `analyzePotentialUpgrades` function grows a single dispatch at the top:

```ts
export function analyzePotentialUpgrades(/* args */): PotentialResult[] {
    if (USE_FAST_POTENTIAL) return fastAnalyzePotentialUpgrades(/* args */);
    // ... existing slow-path body, unchanged ...
}
```

With `VERIFY_FAST_POTENTIAL` on (dev-only), both paths run and divergences are `console.error`d for diagnostics.

```
┌─────────────────────────────────────────────────────────┐
│ Existing public API (UNCHANGED)                         │
│   analyzePotentialUpgrades(...)  ← entry point          │
│   simulateUpgrade(...)           ← random upgrade sim   │
│   calculateTotalStats            ← slow, cached baseline│
│   calculatePriorityScore         ← scoring fn unchanged │
│   baselineStatsCache             ← module-level caches  │
│   baselineBreakdownCache         ← stay as-is           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ NEW (shared): src/utils/fastScoring/                    │
│   Extracted from autogear/fastScoring/:                 │
│     ├─ statVector.ts     (fixed-index Float64Array)     │
│     └─ fastCache.ts      (LRU + key builder)            │
│   autogear/fastScoring/ imports updated to `../..`      │
│   Primitives reusable by any future fast-path consumer. │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ NEW: src/utils/gear/fastPotential/                      │
│   ├─ potentialContext.ts                                │
│   │    Builds once per analyzePotentialUpgrades call.   │
│   │    Captures: withShip flag, percentRef, per-slot    │
│   │    baseline vectors (Float64Array + setCount        │
│   │    Uint8Array), workspace, selectedStats.           │
│   ├─ scorePieceUpgrade.ts                               │
│   │    Hot loop. Given a piece + slot + context,        │
│   │    applies piece delta to baseline vector, adjusts  │
│   │    setCount delta, computes priority score. No      │
│   │    allocations in the loop.                         │
│   ├─ fastAnalyze.ts                                     │
│   │    fastAnalyzePotentialUpgrades — same signature    │
│   │    as analyzePotentialUpgrades, drop-in.            │
│   ├─ featureFlag.ts                                     │
│   │    USE_FAST_POTENTIAL (default false until flip)    │
│   │    VERIFY_FAST_POTENTIAL (default false; dev only)  │
│   └─ __tests__/                                         │
│        equivalence + unit tests.                        │
│                                                          │
│ Consumed by: analyzePotentialUpgrades dispatch.         │
└─────────────────────────────────────────────────────────┘
```

### Why a parallel module, not a rewrite in place

- `analyzePotentialUpgrades` has many callers (GearUpgradeAnalysis for analysis + simulation modes, plus potentially helpers/tests). A parallel implementation keeps its public signature stable.
- The slow path uses the `StatBreakdown` shape downstream (via `calculateGearStats` returning `BaseStats`), which is ergonomic for object-based code but incompatible with Float64Array scoring. The two representations live side-by-side rather than mixing.
- Equivalence-by-parallel-run (`VERIFY_FAST_POTENTIAL`) is cheap to set up when both implementations exist.
- Rollback is the flag, not a revert.

### Build order (see also Correctness Invariants below)

1. Extract shared primitives (`statVector`, `fastCache`) from `autogear/fastScoring/` to a neutral `src/utils/fastScoring/`. Mechanical move + import updates. Autogear tests prove nothing broke.
2. Scaffold `fastPotential/` module. No call sites. New unit tests pass.
3. Wire dispatch in `analyzePotentialUpgrades` behind `USE_FAST_POTENTIAL`. Default off. Equivalence tests pass against the slow path.
4. Flip `USE_FAST_POTENTIAL = true`. User benchmarks in-browser. Numbers confirm projection.
5. Remove temporary console timers from `GearUpgradeAnalysis.tsx`.

Each step is independently shippable.

## ⚠ Correctness invariants — read before implementing

These three invariants are subtle and easy to get wrong.

### Invariant 1: percentage references differ by baseline mode

`addStatModifier` in `statsCalculator.ts` uses a `baseStats` reference for computing percentage-typed flexible stats (e.g. `attack +10%` resolves against `baseStats.attack`). That reference differs between modes:

| Mode | Percentage reference |
|---|---|
| With-ship | `shipPrefix + equipmentWithoutSlot-contributions` (= `breakdown.afterEngineering` in the slow path for this slot) |
| Dummy | `ROLE_BASE_STATS[baseRole]` (with per-piece `crit` baseline adjusted for optimistic sort) |

Both become `percentRef` in the fast path. A single field of the `PotentialContext` carries it.

### Invariant 2: set bonus handling differs between modes

**With-ship mode (deltaful):** The existing code (`potentialCalculator.ts:344-382`) computes `setCountsBefore` and `setCountsAfter`, then applies a set bonus only if `floor(countAfter / minPieces) > floor(countBefore / minPieces)`. Scale factor `0.5` is applied for 4-piece sets.

**Dummy mode (optimistic):** The existing code (`potentialCalculator.ts:443-471`) applies the set bonus *always* if the piece has one, scaled by `0.5` for 4-piece sets, treating the set as complete for ranking purposes.

The fast path must preserve both. The `PotentialContext.withShip` flag gates the branch.

### Invariant 3: calibration is applied to the piece's main stat

The slow path (`potentialCalculator.ts:299-304`, `statsCalculator.ts:65-73`) uses `getCalibratedMainStat(piece)` in place of `piece.mainStat` when `piece.calibration?.shipId === ship.id && isCalibrationEligible(piece)`. Only applies to the with-ship path (dummy has no ship.id).

Autogear shipped with this bug and fixed it on final review. Do not repeat — include calibrated-piece equivalence tests from the start.

## Tolerance policy

Same as autogear:

- **Score equality** — relative tolerance `Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))`. Priority scores can reach 10^7+ for defenders; absolute tolerance is below fp precision at those magnitudes.
- **Stat vector equality** — absolute tolerance `1e-9` per index. Stats are bounded (HP ≤ ~10^6, speed ≤ ~10^3) so absolute works.
- **Result-list ordering** — strict: same piece IDs in same positions. Any re-order on a `1e-6` scoring difference is a real bug (means two pieces were that close and ordering is meaningful).

## Design

### 1. Shared primitives extraction (`src/utils/fastScoring/`)

Two files moved from `src/utils/autogear/fastScoring/`:

- `statVector.ts` — `STAT_INDEX`, `STAT_COUNT`, `StatVector` type alias, `createStatVector`, `copyStatVector`, `addStatVector`, `zeroStatVector`, `statVectorToBaseStats`, `baseStatsToStatVector`. No change to exports or behavior.
- `fastCache.ts` — `FastCache<V>` class, `buildFastCacheKey`. No change.

Autogear's `gearRegistry.ts`, `shipPrefix.ts`, `fastCalculateStats.ts`, `context.ts`, `fastScore.ts`, `featureFlag.ts` remain under `src/utils/autogear/fastScoring/` — they are GA-specific.

Import-path updates: any autogear file that imported `'./statVector'` or `'./fastCache'` now imports from `'../../fastScoring/statVector'` / `'../../fastScoring/fastCache'`. Autogear equivalence tests (commit 1c1864c) remain the regression gate.

### 2. `src/utils/gear/fastPotential/potentialContext.ts`

```ts
export interface PotentialContext {
    readonly withShip: boolean;
    readonly ship: Ship | undefined;                       // present iff withShip
    readonly percentRef: BaseStats;                        // afterEngineering | roleBaseStats
    readonly shipRole: ShipTypeName;
    readonly selectedStats: StatName[];                    // for main-stat bonus

    /** Baseline per slot (slot-to-baseline). All slots relevant to the current
     * analyze call are populated lazily before the piece loop. */
    readonly baselinesBySlot: Map<GearSlotName, SlotBaseline>;

    /** Slot-specific baseline when analyzePotentialUpgrades is called with a
     * specific `slot` arg. Null when called with `slot === undefined` ('all'). */
    readonly fixedSlotBaseline: SlotBaseline | null;

    readonly workspace: {
        stats: Float64Array;                               // len = STAT_COUNT
        setCount: Uint8Array;                              // len = setRegistry.size + 1
    };

    readonly setNameToId: Map<string, number>;
    readonly setIdToName: readonly string[];
}

interface SlotBaseline {
    /** final stats with this slot's equipment removed. */
    readonly statsVector: Float64Array;
    /** set counts of the rest of the equipment (excluding this slot). */
    readonly setCount: Uint8Array;
    /** per-piece crit baseline for the dummy path (matches the slow path's per-piece computation). */
    readonly dummyCritBaseline: number | undefined;
}

export function buildPotentialContext(input: BuildContextInput): PotentialContext;
```

Build order:

1. Determine `withShip = input.ship !== undefined && getGearPiece && getEngineeringStats`.
2. Register all set names that appear anywhere in the inventory and ship equipment into `setNameToId` (0 reserved for "no set"). Allocate `workspace.setCount` with `length = setNameToId.size + 1`.
3. Populate `baselinesBySlot`:
   - **With-ship:** for each slot with eligible pieces in this analyze call, either read from the existing `baselineStatsCache` (if already populated) or call `calculateTotalStats` with that slot's equipment removed — same logic the slow path uses today. Convert the `final` `BaseStats` to a `Float64Array` via `baseStatsToStatVector`. Compute `setCount` from the equipment minus the slot. Store.
   - **Dummy:** baseline is `ROLE_BASE_STATS[baseRole]` as a vector; `setCount` is all zeros; the dummy `crit` adjustment happens per-piece in the hot loop (not in the baseline) because it depends on the piece's own crit.
4. If `slot` (the argument) is defined, set `fixedSlotBaseline = baselinesBySlot.get(slot) ?? null`.
5. `percentRef` = `statVectorToBaseStats(slotBaseline.statsVector)` for with-ship (the "afterEngineering" equivalent for this slot's baseline), or the role base stats for dummy. Stored on the context for reuse.

Rationale: building once per `analyzePotentialUpgrades` call (not once per session) is cheap (<1 ms) and correct — different calls have different `shipRole`/`slot`/`selectedStats`/`selectedGearSets`, which affect scoring inputs.

### 3. `src/utils/gear/fastPotential/scorePieceUpgrade.ts`

```ts
/**
 * Score a piece as if it were equipped in `slot`, given the context.
 * Returns the role score including main-stat bonus.
 *
 * Reads context (read-only); writes to workspace (scratch).
 */
export function scorePieceUpgrade(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName
): number;
```

Internal flow per call:

1. Resolve `baseline = ctx.fixedSlotBaseline ?? ctx.baselinesBySlot.get(slot)`. Missing baseline = fatal (bug in context build); throw in dev, `console.error` + return `0` in prod.
2. `copyStatVector(baseline.statsVector, workspace.stats)` — single loop over 14 floats.
3. Copy `baseline.setCount` into `workspace.setCount` — single loop.
4. **Resolve the piece's main stat** (applying calibration if `withShip && piece.calibration?.shipId === ctx.ship.id && isCalibrationEligible(piece)`).
5. **With-ship mode:** apply piece main stat + sub stats to `workspace.stats` using `ctx.percentRef`. Increment `workspace.setCount[pieceSetId]` if piece has a set. For each set where `floor(new / minPieces) > floor(old / minPieces)`, apply set bonus stats (scaled 0.5 for 4-piece) to `workspace.stats` using `ctx.percentRef`.
6. **Dummy mode:** apply piece main stat + sub stats — but the dummy path handles `crit` specially. The slow path computes `baseCrit = max(0, 100 - sum(gearCrit))` per piece and passes a ship baseline with that `crit` — so we do the same here: replace `workspace.stats[STAT_INDEX.crit]` with the per-piece dummy baseline crit before applying piece stats. Apply set bonus *optimistically* if piece has one — scale 0.5 for 4-piece sets — as `workspace.stats[idx] += setStat.value * scale` (using `ctx.percentRef`).
7. `statVectorToBaseStats(workspace.stats)` — stack-allocated BaseStats for the scorer.
8. `baseScore = calculatePriorityScore(stats, [], ctx.shipRole)`.
9. `mainStatBonus = getMainStatBonus(piece, ctx.selectedStats, baseScore)` (existing function, unchanged).
10. Return `baseScore + mainStatBonus`.

**No allocations in the hot loop** except:
- The `BaseStats` object returned by `statVectorToBaseStats` (14 properties; unavoidable because `calculatePriorityScore` takes `BaseStats`). This is a single per-call allocation vs the slow path's 6 × 14 = 84 property copies per call.
- `getMainStatBonus` is pure arithmetic on `piece`.

### 4. `src/utils/gear/fastPotential/fastAnalyze.ts`

```ts
export function fastAnalyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number,
    slot: GearSlotName | undefined,
    minRarity: 'rare' | 'epic' | 'legendary',
    simulationCount: number,
    selectedStats: StatName[],
    statFilterMode: 'AND' | 'OR',
    selectedGearSets: string[],
    ship: Ship | undefined,
    getGearPiece: ((id: string) => GearPiece | undefined) | undefined,
    getEngineeringStatsForShipType:
        | ((shipType: ShipTypeName) => EngineeringStat | undefined)
        | undefined
): PotentialResult[];
```

Signature mirrors `analyzePotentialUpgrades` exactly. Body:

1. Filter eligible pieces — same logic as the slow path (rarity, level, slot, stat filter, gear-set filter, no implants).
2. Build `PotentialContext` (once) for the slot(s) that have eligible pieces.
3. For each eligible piece:
   - Compute `currentScore = scorePieceUpgrade(ctx, piece, slot ?? piece.slot)`.
   - For `i` in `0..simulationCount`: compute `simulated = simulateUpgrade(piece).piece`, then `potentialScore += scorePieceUpgrade(ctx, simulated, slot ?? piece.slot)`.
   - `avgPotentialScore = potentialScore / simulationCount`.
   - Record `{ piece, currentScore, potentialScore: avgPotentialScore, improvement: avgPotentialScore - currentScore }`.
4. Sort by `potentialScore` descending, slice to `count`, return.

### 5. Dispatch in `analyzePotentialUpgrades`

Single change at the top of `src/utils/gear/potentialCalculator.ts`:

```ts
import { USE_FAST_POTENTIAL, VERIFY_FAST_POTENTIAL } from './fastPotential/featureFlag';
import { fastAnalyzePotentialUpgrades } from './fastPotential/fastAnalyze';

export function analyzePotentialUpgrades(/* args */): PotentialResult[] {
    if (USE_FAST_POTENTIAL && !VERIFY_FAST_POTENTIAL) {
        return fastAnalyzePotentialUpgrades(/* args */);
    }

    if (VERIFY_FAST_POTENTIAL) {
        const slowResult = slowAnalyzePotentialUpgrades(/* args */);
        const fastResult = fastAnalyzePotentialUpgrades(/* args */);
        verifyEquivalence(slowResult, fastResult, /* context */);
        // Use the slow result as the production answer while verifying.
        return slowResult;
    }

    return slowAnalyzePotentialUpgrades(/* args */);
}

// Existing body becomes `slowAnalyzePotentialUpgrades` — same code, just
// renamed and extracted so both paths can be invoked from the dispatch.
```

### 6. Feature flag module

```ts
// src/utils/gear/fastPotential/featureFlag.ts

/**
 * USE_FAST_POTENTIAL — when true, routes analyzePotentialUpgrades through
 * fastAnalyzePotentialUpgrades. Flipped on once equivalence tests and
 * user-side benchmarks look good. Default false on first merge; flipped in
 * a dedicated commit later.
 */
export const USE_FAST_POTENTIAL = false;

/**
 * VERIFY_FAST_POTENTIAL — when true, runs BOTH paths per call and
 * console.errors on divergence. The production answer is still the slow
 * path; the fast result is only compared. Dev-only; flip to `true` locally
 * to debug.
 *
 * Kept as a module-level literal const so Vite tree-shakes the verify
 * branch in production builds.
 */
export const VERIFY_FAST_POTENTIAL = false;
```

## Correctness & testing

### Unit tests per module

- `src/utils/fastScoring/__tests__/statVector.test.ts` — moves with the extraction, unchanged content.
- `src/utils/fastScoring/__tests__/fastCache.test.ts` — moves with the extraction, unchanged content.
- `src/utils/gear/fastPotential/__tests__/potentialContext.test.ts` — builds both dummy and with-ship contexts, asserts slot baselines match cached StatBreakdown.final within `1e-9`, asserts setCount vectors match manual counting, asserts percentRef matches slow-path afterEngineering.
- `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts` — scores a single known piece against a fixed context, asserts result matches `calculateGearStats + calculatePriorityScore + getMainStatBonus` for that piece within relative `1e-6`.

### Equivalence tests (primary correctness gate)

`src/utils/gear/fastPotential/__tests__/equivalence.test.ts`.

**Randomized coverage (~30 scenarios):**

Seeded PRNG varies:

- Role (ATTACKER, DEFENDER, DEFENDER_SECURITY, DEBUFFER and variants, SUPPORTER and variants — all 12 roles exercised)
- Slot (undefined = 'all', or one specific slot)
- Rarity (rare, epic, legendary → simulationCount 10, 20, 40)
- selectedStats (none / one / multiple)
- statFilterMode (AND / OR)
- selectedGearSets (none / one / multiple)
- `ship` provided vs undefined

For each: run both paths and assert:

1. Returned arrays are the same length.
2. Same piece IDs in the same order.
3. Each result's `currentScore`, `potentialScore`, `improvement` within relative `1e-6`.

**Explicit coverage:**

- Set bonus thresholds: inventories designed to cross 2-piece and 4-piece boundaries, for both dummy and with-ship modes.
- Calibration: piece calibrated to target ship, piece calibrated to a different ship, ineligible piece (level < 16 or stars < 5).
- Dummy mode with set bonus (optimistic application).
- Dummy mode without set bonus on piece.
- Empty eligible pieces list.
- Single eligible piece.
- Ship with no implants.
- Ship with refits + engineering.
- DEBUFFER_CORROSION (uses `setCount.DECIMATION` specially in `calculatePriorityScore`).
- SUPPORTER_BUFFER / SUPPORTER_OFFENSIVE (use `setCount.BOOST`).

**Determinism:** `simulateUpgrade` uses `Math.random`. Equivalence tests mock `Math.random` with a seeded PRNG so slow and fast paths see the *same* sequence of upgraded pieces. Restore in `afterEach`.

### Verification mode (runtime)

`VERIFY_FAST_POTENTIAL` dev flag per *Design §6*. When on, `analyzePotentialUpgrades` runs both paths, compares piece ordering and scores, and `console.error`s any divergence with scenario inputs. Zero cost when off.

### Benchmark regression

No CI check. User runs analyze-gear in-browser before/after the flag flip (Task 4 / Task 16 equivalent) and pastes the `[AnalyzeGear]` timer output. Compare wall-clock time for both paths.

### Deliberately not tested

- UI end-to-end for GearUpgradeAnalysis (unchanged; manual QA).
- Performance assertions in CI (flaky, low value).
- `simulateUpgrade` internals (unchanged).

## Risks & rollback

### Risks, by likelihood × blast radius

**1. Piece-ordering divergence** — *medium likelihood, small blast.* Floating-point order-of-operations between object math and Float64Array math produces ~1e-10 differences, usually fine but can flip order when two pieces are very close. Mitigated by equivalence tests that assert strict ordering (not just scores within tolerance).

**2. Set bonus threshold bug** — *medium likelihood, medium blast.* Off-by-one at 2/4-piece boundaries, especially with the 0.5 scale factor for 4-piece sets. Mitigated by explicit per-threshold tests in both modes.

**3. Dummy vs ship set-bonus semantics confused** — *medium likelihood, medium blast.* Two different modes, easy to mis-route. Mitigated by `ctx.withShip` as the single source of truth and dedicated tests for each mode.

**4. Calibration dropped** — *low likelihood, medium blast.* Same bug the autogear reviewer caught — now known. Mitigated by explicit calibration tests from day one.

**5. Shared primitives extraction breaks autogear** — *low likelihood, high blast.* Autogear fast-scoring just shipped; a bad extraction regresses it. Mitigated by running the full autogear equivalence + unit tests as the last step of the extraction commit; revert if anything fails. The extraction is Phase 1, isolated.

**6. simulateUpgrade randomness makes equivalence tests flaky** — *high likelihood if unhandled, medium if handled.* Different PRNG draws mask real divergences as variance. Mitigated by mocking `Math.random` in equivalence tests.

**7. Benchmark misses projections** — *medium likelihood, low blast.* Even a 3× speedup (82 s → 27 s) is a meaningful UX win. Worst case: no measurable improvement (unlikely given autogear's validation), in which case we keep the module dark and investigate.

### Rollback plan

- `USE_FAST_POTENTIAL` defaults to `false` on first merge. Phase 3 is dead code until the flip.
- If post-flip divergence is reported, flip it back. No code revert needed.
- Each phase is independently shippable. A stalled Phase 4/5 leaves Phase 1 (shared primitives) and Phase 2 (dark module) in place.
- The slow-path implementation (`slowAnalyzePotentialUpgrades` / `calculateGearStats` / `baselineStatsCache` / `baselineBreakdownCache`) stays in the codebase permanently. "Reverting" the fast path means deleting `fastPotential/`, not restoring removed code.

### Known-unsafe operations this design avoids

- **No changes to public `analyzePotentialUpgrades` signature.** Drop-in.
- **No changes to `calculateTotalStats` / `calculatePriorityScore` / `simulateUpgrade`.** Slow scoring stack untouched.
- **No changes to `baselineStatsCache` / `baselineBreakdownCache`.** Fast path reads from them; cache semantics preserved.
- **No changes to `GearUpgradeAnalysis.tsx` beyond removing the temporary console timers at the end.**

## Files touched

### Created
- `src/utils/fastScoring/statVector.ts` (moved from autogear)
- `src/utils/fastScoring/fastCache.ts` (moved from autogear)
- `src/utils/fastScoring/__tests__/statVector.test.ts` (moved from autogear)
- `src/utils/fastScoring/__tests__/fastCache.test.ts` (moved from autogear)
- `src/utils/gear/fastPotential/potentialContext.ts`
- `src/utils/gear/fastPotential/scorePieceUpgrade.ts`
- `src/utils/gear/fastPotential/fastAnalyze.ts`
- `src/utils/gear/fastPotential/featureFlag.ts`
- `src/utils/gear/fastPotential/__tests__/potentialContext.test.ts`
- `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts`
- `src/utils/gear/fastPotential/__tests__/equivalence.test.ts`

### Modified
- `src/utils/autogear/fastScoring/statVector.ts` — deleted (moved)
- `src/utils/autogear/fastScoring/fastCache.ts` — deleted (moved)
- `src/utils/autogear/fastScoring/__tests__/statVector.test.ts` — deleted (moved)
- `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts` — deleted (moved)
- `src/utils/autogear/fastScoring/gearRegistry.ts` — import path
- `src/utils/autogear/fastScoring/shipPrefix.ts` — import path
- `src/utils/autogear/fastScoring/fastCalculateStats.ts` — import path
- `src/utils/autogear/fastScoring/context.ts` — import path
- `src/utils/autogear/fastScoring/fastScore.ts` — import path
- `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts` — import path
- `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts` — import path
- `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts` — import path (if any)
- `src/utils/gear/potentialCalculator.ts` — dispatch at top of `analyzePotentialUpgrades`; extract existing body as `slowAnalyzePotentialUpgrades` for the verify branch
- `src/components/gear/GearUpgradeAnalysis.tsx` — remove temporary console timers (final cleanup commit)

### Untouched (by design)
- `src/utils/ship/statsCalculator.ts`
- `src/utils/autogear/scoring.ts`, `priorityScore.ts`
- All UI under `src/components/gear/` except the timer-removal line in `GearUpgradeAnalysis.tsx`
- Every non-analyze caller of `calculateTotalStats` / `calculatePriorityScore`

## Open questions (for planning phase)

- **Return value from `statVectorToBaseStats` in the hot loop:** the 14-property object allocation is unavoidable given `calculatePriorityScore`'s signature. If Phase 4 benchmarks show this is a meaningful cost, a follow-up could offer a `calculatePriorityScoreFromVector(vector: Float64Array, ...)` variant. Out of scope here; revisit only if numbers require it.
- **`fastCache` usage:** the existing LRU cache primitive is extracted but not yet used by `fastPotential` (analyze-gear doesn't have the repeated-key access pattern that benefits from caching). Keep it shared for the future; Phase 1 doesn't wire it into fastPotential.
- **Temporary timer removal:** replace with `performanceTracker`-style instrumentation long-term, or fully remove? Design removes. Can be re-added later if a different feature needs it.
