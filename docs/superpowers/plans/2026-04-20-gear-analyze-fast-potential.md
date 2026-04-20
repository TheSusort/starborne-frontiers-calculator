# Gear Analyze Fast-Potential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `analyzePotentialUpgrades` wall-clock time 5–8× on the with-ship path (82 s → ~10–15 s) and 3–4× on the dummy path (4 s → ~1–1.5 s) by routing both paths through a parallel fast-scoring module that reuses Float64Array workspaces instead of allocating fresh `StatBreakdown` objects per scored piece.

**Architecture:** A parallel fast-path module lives at `src/utils/gear/fastPotential/` alongside `potentialCalculator.ts`. The existing `analyzePotentialUpgrades` gains a single dispatch at the top; its body is renamed `slowAnalyzePotentialUpgrades` and remains the production answer behind `USE_FAST_POTENTIAL=false`. The fast path builds a `PotentialContext` once per call (slot baselines as Float64Array, set-count Uint8Array, percentRef, workspace buffers), then scores each piece + its simulated upgrades by mutating the workspace instead of cloning. Shared primitives (`statVector`, `fastCache`) are first extracted from `src/utils/autogear/fastScoring/` to a neutral `src/utils/fastScoring/`; autogear's fast-scoring (shipped 2026-04-19, `USE_FAST_SCORING = true`) becomes a consumer of the shared layer.

**Tech Stack:** TypeScript 5, React 18, Vite, Vitest, Tailwind. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-20-gear-analyze-fast-potential-design.md](../specs/2026-04-20-gear-analyze-fast-potential-design.md)

**Baseline (11,619-piece inventory, existing `[AnalyzeGear]` timers):**

| Path | Total | Per role |
|---|---|---|
| Dummy (no ship) | 4.1 s | ~340 ms |
| With-ship | **82.2 s** | ~6.8 s |

**Projected after flip:** dummy ~1–1.5 s, with-ship ~10–15 s.

---

## File Plan

**Created — shared fast-scoring primitives (moved from autogear):**
- `src/utils/fastScoring/statVector.ts`
- `src/utils/fastScoring/fastCache.ts`
- `src/utils/fastScoring/__tests__/statVector.test.ts`
- `src/utils/fastScoring/__tests__/fastCache.test.ts`

**Created — gear fast-potential module:**
- `src/utils/gear/fastPotential/featureFlag.ts`
- `src/utils/gear/fastPotential/potentialContext.ts`
- `src/utils/gear/fastPotential/scorePieceUpgrade.ts`
- `src/utils/gear/fastPotential/fastAnalyze.ts`
- `src/utils/gear/fastPotential/__tests__/potentialContext.test.ts`
- `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts`
- `src/utils/gear/fastPotential/__tests__/equivalence.test.ts`

**Deleted (moved, not rewritten):**
- `src/utils/autogear/fastScoring/statVector.ts` → `src/utils/fastScoring/statVector.ts`
- `src/utils/autogear/fastScoring/fastCache.ts` → `src/utils/fastScoring/fastCache.ts`
- `src/utils/autogear/fastScoring/__tests__/statVector.test.ts` → `src/utils/fastScoring/__tests__/statVector.test.ts`
- `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts` → `src/utils/fastScoring/__tests__/fastCache.test.ts`

**Modified:**
- `src/utils/autogear/fastScoring/gearRegistry.ts` — import path (`'./statVector'` → `'../../fastScoring/statVector'`)
- `src/utils/autogear/fastScoring/shipPrefix.ts` — import path
- `src/utils/autogear/fastScoring/fastCalculateStats.ts` — import path
- `src/utils/autogear/fastScoring/context.ts` — import paths (statVector + fastCache)
- `src/utils/autogear/fastScoring/fastScore.ts` — import paths (statVector + fastCache)
- `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts` — import path
- `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts` — import path
- `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts` — import path (if any)
- `src/utils/gear/potentialCalculator.ts` — rename existing body to `slowAnalyzePotentialUpgrades`, add dispatch `analyzePotentialUpgrades` at top
- `src/components/gear/GearUpgradeAnalysis.tsx` — remove `[AnalyzeGear]` console timers (final commit only)

**Not touched (by design):**
- `src/utils/ship/statsCalculator.ts`
- `src/utils/autogear/scoring.ts`, `priorityScore.ts`
- `src/utils/gear/calibrationCalculator.ts`, `calibrationUtils.ts`
- `src/utils/gear/mainStatValueFetcher.ts`
- All UI under `src/components/gear/` except the timer-removal line in `GearUpgradeAnalysis.tsx`
- `ROLE_BASE_STATS`, `SUBSTAT_RANGES`, `GEAR_SETS`

---

## Tolerance policy for equivalence tests

Matches the autogear fast-scoring plan:

- **Score equality** — relative tolerance `Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))`. Priority scores reach 10^7+ for defenders; absolute tolerance is below fp precision at those magnitudes.
- **Stat vector equality** — absolute tolerance `1e-9` per index. Stats are bounded (HP ≤ ~10^6, speed ≤ ~10^3).
- **Result-list ordering** — strict: same piece IDs in the same positions. A flip on a `1e-6` scoring difference is a real bug (the pieces were already that close).

Helper `assertFloatsClose(a, b, { relative: true })` / `{ abs: 1e-9 }` lives in `equivalence.test.ts`.

---

## ⚠ Correctness invariants — read before implementing Phase 2

These are subtle and easy to get wrong. Re-read the spec §⚠ if anything below is unclear.

### Invariant 1: percentage reference differs by baseline mode

`addStatModifier` (`statsCalculator.ts`) uses a `baseStats` reference for `type: 'percentage'` flexible stats. The reference differs:

| Mode | Percentage reference |
|---|---|
| With-ship | `baselineBreakdown.afterEngineering` (base + refits + engineering, no gear) |
| Dummy | `ROLE_BASE_STATS[baseRole]` |

Both become the single `ctx.percentRef` field.

**Crit note (dummy only):** the slow path computes `pieceCritBaseline = max(0, 100 - sum(gearCritFromPiece))` and stores it on `workspace.stats[crit]` before the piece's crit contributions are added. `pieceCritBaseline` does NOT go into `percentRef` — `crit` is a percentage-only stat that adds directly; `percentRef` is only consulted for flexible `type: 'percentage'` stats.

### Invariant 2: set bonus handling differs between modes

- **With-ship (deltaful):** apply set bonus only if `floor(countAfter / minPieces) > floor(countBefore / minPieces)` (`potentialCalculator.ts:344-382`). Scale by `0.5` for `minPieces >= 4`.
- **Dummy (optimistic):** apply set bonus always if the piece has one, scaled by `0.5` for `minPieces >= 4` (`potentialCalculator.ts:443-471`).

`ctx.withShip` is the single source of truth for which branch runs.

### Invariant 3: calibration applies only in with-ship mode, on eligible pieces

The slow path (`potentialCalculator.ts:299-304`) substitutes `getCalibratedMainStat(piece)` for `piece.mainStat` when `piece.calibration?.shipId === ship.id && isCalibrationEligible(piece)`. Dummy mode never applies calibration.

Autogear shipped without this and had to patch it in review. Do not repeat — include calibrated-piece equivalence tests from the start.

### Invariant 4: with-ship `currentScore` vs dummy `currentScore` are semantically different

- **With-ship:** `currentScore` uses `baseline.final` (ship state WITHOUT this slot's gear). Piece is NOT applied.
- **Dummy:** `currentScore` uses role-base-stats WITH this piece applied — there is no "ship without this slot" concept.

The fast path exposes two scorers (`scoreCurrentWithShip`, `scorePieceApplied`). `fastAnalyze` picks based on `ctx.withShip`.

---

# Phase 1 — Extract shared primitives (independent; ships alone)

Phase 1 is a mechanical file move + import-path updates. It ships on its own because autogear's equivalence tests are the regression gate — if they pass after the move, nothing regressed. Zero behavior change.

## Task 1: Move `statVector.ts` to shared location

**Why:** Both autogear fast-scoring and the new fastPotential module need this module. The natural home is `src/utils/fastScoring/`, one level up from both consumers.

**Files:**
- Create: `src/utils/fastScoring/statVector.ts` (identical content to current `src/utils/autogear/fastScoring/statVector.ts`)
- Delete: `src/utils/autogear/fastScoring/statVector.ts`

- [ ] **Step 1: Verify current state**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/statVector.test.ts --run`
Expected: all pass (baseline before the move).

- [ ] **Step 2: Create the new file**

Copy the contents of `src/utils/autogear/fastScoring/statVector.ts` verbatim to `src/utils/fastScoring/statVector.ts`. Only the file location changes — not the exports, not the logic, not the types.

- [ ] **Step 3: Delete the old file**

```bash
rm src/utils/autogear/fastScoring/statVector.ts
```

- [ ] **Step 4: Commit (move isolated before import rewrites)**

Skip — combine with Task 2's commit so the tree is never broken in an intermediate state.

---

## Task 2: Move `fastCache.ts` to shared location

**Why:** Same rationale as Task 1. Move `fastCache.ts` in the same commit as `statVector.ts` to keep the primitives co-located.

**Files:**
- Create: `src/utils/fastScoring/fastCache.ts` (identical content to current `src/utils/autogear/fastScoring/fastCache.ts`)
- Delete: `src/utils/autogear/fastScoring/fastCache.ts`

- [ ] **Step 1: Create the new file**

Copy the contents of `src/utils/autogear/fastScoring/fastCache.ts` verbatim to `src/utils/fastScoring/fastCache.ts`.

- [ ] **Step 2: Delete the old file**

```bash
rm src/utils/autogear/fastScoring/fastCache.ts
```

---

## Task 3: Move the test files alongside the sources

**Files:**
- Create: `src/utils/fastScoring/__tests__/statVector.test.ts`
- Create: `src/utils/fastScoring/__tests__/fastCache.test.ts`
- Delete: `src/utils/autogear/fastScoring/__tests__/statVector.test.ts`
- Delete: `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts`

- [ ] **Step 1: Copy the tests verbatim**

Copy both test files into the new `__tests__/` folder. Their import of `'../statVector'` / `'../fastCache'` resolves to the new co-located files — no import changes needed here.

- [ ] **Step 2: Delete the originals**

```bash
rm src/utils/autogear/fastScoring/__tests__/statVector.test.ts
rm src/utils/autogear/fastScoring/__tests__/fastCache.test.ts
```

- [ ] **Step 3: Run the moved tests from their new location**

Run: `npm test -- src/utils/fastScoring/__tests__/ --run`
Expected: all pass (same tests, same logic, new path).

---

## Task 4: Update autogear import paths

**Why:** After Task 1–3 the autogear fast-scoring modules still import from `'./statVector'` and `'./fastCache'` — those files are gone. Rewrite each import to `'../../fastScoring/statVector'` / `'../../fastScoring/fastCache'`.

**Files to modify** (known call sites from Grep of the current tree — confirm with a fresh search):
- `src/utils/autogear/fastScoring/gearRegistry.ts` (1 import)
- `src/utils/autogear/fastScoring/shipPrefix.ts` (1 import)
- `src/utils/autogear/fastScoring/fastCalculateStats.ts` (1 import)
- `src/utils/autogear/fastScoring/context.ts` (2 imports — statVector + fastCache)
- `src/utils/autogear/fastScoring/fastScore.ts` (2 imports — statVector + fastCache)
- `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts` (1 import)
- `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts` (1 import)
- `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts` (if it imports either — check first)

- [ ] **Step 1: Verify the authoritative list of import sites**

Run: `grep -rn "from ['\"]\\./statVector" src/utils/autogear/fastScoring` (use the Grep tool).
Run: `grep -rn "from ['\"]\\./fastCache" src/utils/autogear/fastScoring`.
Expected: matches the list above. Any extra hits must also be updated.

- [ ] **Step 2: Rewrite each import**

For each file, replace `from './statVector'` with `from '../../fastScoring/statVector'` and `from './fastCache'` with `from '../../fastScoring/fastCache'`. Test files under `__tests__/` use `from '../../../fastScoring/statVector'` (one extra `..` because the test file is nested one level deeper).

Double-check by resolving the relative path mentally: from `src/utils/autogear/fastScoring/gearRegistry.ts`, `../../fastScoring/statVector` → `src/utils/fastScoring/statVector`. ✓

- [ ] **Step 3: TypeScript compile check**

Run: `npm run build` (or at minimum `npx tsc --noEmit`).
Expected: no missing-module errors.

- [ ] **Step 4: Run autogear fast-scoring tests (regression gate)**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/ --run`
Expected: all pass. This includes the `equivalence.test.ts` that was the 2026-04-19 regression gate; it proves the move did not break fast-scoring semantics.

- [ ] **Step 5: Run the moved shared primitive tests too**

Run: `npm test -- src/utils/fastScoring/__tests__/ --run`
Expected: all pass.

- [ ] **Step 6: Run full test suite**

Run: `npm test -- --run`
Expected: all pass. Nothing else should import `statVector` or `fastCache`, but run everything to be sure.

- [ ] **Step 7: Commit the whole Phase 1 move**

```bash
git add src/utils/fastScoring/ src/utils/autogear/fastScoring/
git status  # confirm the deleted files are staged
git commit -m "refactor(fastScoring): extract statVector + fastCache to shared src/utils/fastScoring/"
```

Commit message reason: one move, one commit — easy to revert if a downstream consumer we missed crops up.

---

# Phase 2 — Scaffold `fastPotential/` module dark

Phase 2 builds the fast-path module in isolation. Nothing in the production code path changes — `analyzePotentialUpgrades` still runs the slow path. The module is unit-tested against the slow-path canonical functions before it graduates to Phase 3.

Phase 2 is mergeable on its own (dead code is harmless).

## Task 5: Feature flag module

**Why:** Centralize `USE_FAST_POTENTIAL` and `VERIFY_FAST_POTENTIAL` so toggling is a one-line change and Vite can tree-shake the verify branch in prod.

**Files:**
- Create: `src/utils/gear/fastPotential/featureFlag.ts`

- [ ] **Step 1: Write the module**

Create `src/utils/gear/fastPotential/featureFlag.ts`:

```ts
/**
 * USE_FAST_POTENTIAL — when true, routes analyzePotentialUpgrades through
 * fastAnalyzePotentialUpgrades. Defaults to false on first merge; flipped in
 * Phase 5 once equivalence tests and user-side benchmarks look good.
 */
export const USE_FAST_POTENTIAL = false;

/**
 * VERIFY_FAST_POTENTIAL — when true, runs BOTH paths per call and
 * console.errors on divergence. The production answer is still the slow
 * path; the fast result is only compared. Dev-only; flip to `true` locally
 * to debug.
 *
 * Module-level literal const so Vite tree-shakes the verify branch in
 * production builds.
 */
export const VERIFY_FAST_POTENTIAL = false;
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/gear/fastPotential/featureFlag.ts
git commit -m "feat(fast-potential): feature flag module"
```

---

## Task 6: Define `PotentialContext` types and the build-input contract

**Why:** The context is the single source of truth shared across `scorePieceUpgrade` and `fastAnalyze`. Locking its shape first — before any consumer is written — prevents churn when the hot loop is wired.

**Files:**
- Create: `src/utils/gear/fastPotential/potentialContext.ts` (types + stub only; implementation lands in Task 7)

- [ ] **Step 1: Write types and stub**

Create `src/utils/gear/fastPotential/potentialContext.ts`:

```ts
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { BaseStats, EngineeringStat, StatName } from '../../../types/stats';
import type { ShipTypeName, GearSlotName } from '../../../constants';

/**
 * Per-slot baseline vectors. All three fields are driven by the slow path's
 * cached StatBreakdown; see spec §Design.2 and Invariants 1/4.
 */
export interface SlotBaseline {
    /**
     * afterGear vector — base + refits + engineering + all gear EXCEPT this
     * slot's. Starting vector for the upgrade-scoring path.
     * With-ship: Float64Array of baselineBreakdown.afterGear.
     * Dummy: Float64Array of ROLE_BASE_STATS[baseRole].
     */
    readonly afterGearVector: Float64Array;

    /**
     * final vector — baselineBreakdown.final (ship state WITHOUT this slot's
     * gear). With-ship mode only; used for scoreCurrentWithShip.
     * Dummy mode: null (dummy uses scorePieceApplied for the current path).
     */
    readonly finalVector: Float64Array | null;

    /**
     * Set counts of equipment-minus-this-slot, keyed by ctx.setNameToId ids.
     * With-ship: actual counts from ship equipment minus this slot.
     * Dummy: all zeros (no other equipment).
     * Length = ctx.setNameToId.size + 1 (index 0 reserved for "no set").
     */
    readonly setCount: Uint8Array;
}

export interface PotentialContext {
    readonly withShip: boolean;
    readonly ship: Ship | undefined;          // present iff withShip
    readonly percentRef: BaseStats;           // afterEngineering | roleBaseStats
    readonly shipRole: ShipTypeName;
    readonly selectedStats: readonly StatName[];

    /** Baseline per slot. Populated for every slot that has eligible pieces
     * in the current analyze call. Lookup by piece.slot. */
    readonly baselinesBySlot: Map<GearSlotName, SlotBaseline>;

    /** When analyzePotentialUpgrades was called with an explicit `slot` arg,
     * this is the baseline for that slot (shortcut, avoids repeated Map.get).
     * Null when called with `slot === undefined` (=> 'all' mode). */
    readonly fixedSlotBaseline: SlotBaseline | null;

    /** Scratch buffers reused across every scorePieceApplied call. */
    readonly workspace: {
        stats: Float64Array;                  // len = STAT_COUNT
        setCount: Uint8Array;                 // len = setNameToId.size + 1
    };

    /** Integer-ID table for set bonuses. 0 is reserved for "no set". */
    readonly setNameToId: Map<string, number>;
    readonly setIdToName: readonly string[];
}

export interface BuildPotentialContextInput {
    readonly inventory: readonly GearPiece[];       // already filtered to eligible pieces
    readonly shipRole: ShipTypeName;
    readonly slot: GearSlotName | undefined;
    readonly selectedStats: readonly StatName[];
    readonly ship: Ship | undefined;
    readonly getGearPiece: ((id: string) => GearPiece | undefined) | undefined;
    readonly getEngineeringStatsForShipType:
        | ((shipType: ShipTypeName) => EngineeringStat | undefined)
        | undefined;
}

export function buildPotentialContext(
    _input: BuildPotentialContextInput
): PotentialContext {
    throw new Error('not yet implemented — see Task 7');
}
```

- [ ] **Step 2: TypeScript compile check**

Run: `npm run build` (or `npx tsc --noEmit`).
Expected: no errors (no consumers yet).

- [ ] **Step 3: Commit the types**

```bash
git add src/utils/gear/fastPotential/potentialContext.ts
git commit -m "feat(fast-potential): define PotentialContext + SlotBaseline types"
```

---

## Task 7: Implement `buildPotentialContext`

**Why:** Every fast-path call starts here. The context is built once per `analyzePotentialUpgrades` call and reused for every piece + simulation in the loop. Getting this right — especially the three baseline fields in Invariant 1 and 4 — is the most subtle part of Phase 2.

**Files:**
- Modify: `src/utils/gear/fastPotential/potentialContext.ts`

- [ ] **Step 1: Replace the stub with the implementation**

Fill in `buildPotentialContext`. The full body, broken into documented blocks:

```ts
import {
    STAT_COUNT,
    createStatVector,
    baseStatsToStatVector,
    statVectorToBaseStats,
    type StatVector,
} from '../../fastScoring/statVector';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { calculateTotalStats, type StatBreakdown } from '../../ship/statsCalculator';
import { baselineStatsCache, baselineBreakdownCache } from '../potentialCalculator';

// Module-local: the slow path's ROLE_BASE_STATS is not exported; the spec
// (Invariants) says the fast path reuses the same values. Duplicating them
// here is preferable to exporting from potentialCalculator (which would
// couple the module ordering and also mean every fast-path change must go
// through a barrel). If ROLE_BASE_STATS in potentialCalculator.ts ever
// changes, this table MUST be updated in lockstep — equivalence tests will
// catch any drift immediately.
const ROLE_BASE_STATS_FAST = {
    ATTACKER: { hp: 22000, attack: 6250, defence: 5000, hacking: 0, security: 0, speed: 130, crit: 20, critDamage: 80, healModifier: 0, defensePenetration: 0 },
    DEFENDER: { hp: 25000, attack: 3000, defence: 5000, hacking: 0, security: 90, speed: 110, crit: 10, critDamage: 20, healModifier: 0, defensePenetration: 0 },
    DEBUFFER: { hp: 16500, attack: 4400, defence: 2500, hacking: 200, security: 33, speed: 125, crit: 12, critDamage: 20, healModifier: 0, defensePenetration: 0 },
    SUPPORTER: { hp: 20000, attack: 3000, defence: 3250, hacking: 0, security: 0, speed: 99, crit: 12, critDamage: 22, healModifier: 0, defensePenetration: 0 },
} as const satisfies Record<string, BaseStats>;

function getBaseRoleStats(role: ShipTypeName): BaseStats {
    if (role.startsWith('DEFENDER')) return ROLE_BASE_STATS_FAST.DEFENDER;
    if (role.startsWith('DEBUFFER')) return ROLE_BASE_STATS_FAST.DEBUFFER;
    if (role.startsWith('SUPPORTER')) return ROLE_BASE_STATS_FAST.SUPPORTER;
    return ROLE_BASE_STATS_FAST.ATTACKER;
}

export function buildPotentialContext(
    input: BuildPotentialContextInput
): PotentialContext {
    const { inventory, shipRole, slot, selectedStats, ship } = input;
    const withShip =
        ship !== undefined &&
        input.getGearPiece !== undefined &&
        input.getEngineeringStatsForShipType !== undefined;

    // ---------- Set name -> integer id table ----------
    // 0 reserved for "no set". Names come from both (a) the inventory being
    // analyzed and (b) the ship's currently-equipped pieces (with-ship mode),
    // since the slow path counts both when computing setCountsBefore.
    const setNameToId = new Map<string, number>();
    const setIdToName: string[] = [''];
    const registerSet = (name: string | undefined): void => {
        if (!name) return;
        if (setNameToId.has(name)) return;
        const id = setIdToName.length;
        setNameToId.set(name, id);
        setIdToName.push(name);
    };
    for (const p of inventory) registerSet(p.setBonus);
    if (withShip && ship && input.getGearPiece) {
        for (const gearId of Object.values(ship.equipment ?? {})) {
            if (!gearId) continue;
            const g = input.getGearPiece(gearId);
            if (g?.setBonus) registerSet(g.setBonus);
        }
    }

    // ---------- Determine slots that need baselines ----------
    // For 'all' mode, every piece's .slot contributes. For fixed-slot mode,
    // only the given slot is needed.
    const slotsNeeded = new Set<GearSlotName>();
    if (slot) slotsNeeded.add(slot);
    else for (const p of inventory) if (!p.slot.includes('implant')) slotsNeeded.add(p.slot);

    // ---------- percentRef ----------
    let percentRef: BaseStats;
    if (withShip && ship && input.getGearPiece && input.getEngineeringStatsForShipType) {
        // afterEngineering is slot-independent — compute (or reuse cached)
        // baselineBreakdown for any slot we need, and read afterEngineering
        // off it. Pick an arbitrary slot deterministically.
        const firstSlot = [...slotsNeeded][0];
        const breakdown = getOrCreateBreakdown(ship, firstSlot, input.getGearPiece, input.getEngineeringStatsForShipType);
        percentRef = breakdown.afterEngineering;
    } else {
        percentRef = getBaseRoleStats(shipRole);
    }

    // ---------- Per-slot baselines ----------
    const baselinesBySlot = new Map<GearSlotName, SlotBaseline>();
    for (const slotName of slotsNeeded) {
        if (withShip && ship && input.getGearPiece && input.getEngineeringStatsForShipType) {
            const breakdown = getOrCreateBreakdown(ship, slotName, input.getGearPiece, input.getEngineeringStatsForShipType);
            const afterGearVector = baseStatsToStatVector(breakdown.afterGear);
            const finalVector = baseStatsToStatVector(breakdown.final);

            // setCount of equipment-minus-this-slot
            const setCount = new Uint8Array(setIdToName.length);
            for (const [eqSlot, gearId] of Object.entries(ship.equipment ?? {})) {
                if (!gearId) continue;
                if (eqSlot === slotName) continue;
                const g = input.getGearPiece(gearId);
                if (!g?.setBonus) continue;
                const setId = setNameToId.get(g.setBonus);
                if (setId !== undefined) setCount[setId]++;
            }
            baselinesBySlot.set(slotName, { afterGearVector, finalVector, setCount });
        } else {
            // Dummy mode
            const afterGearVector = baseStatsToStatVector(getBaseRoleStats(shipRole));
            baselinesBySlot.set(slotName, {
                afterGearVector,
                finalVector: null,
                setCount: new Uint8Array(setIdToName.length),
            });
        }
    }

    const workspace = {
        stats: createStatVector(),
        setCount: new Uint8Array(setIdToName.length),
    };

    const fixedSlotBaseline = slot ? (baselinesBySlot.get(slot) ?? null) : null;

    return {
        withShip,
        ship: withShip ? ship : undefined,
        percentRef,
        shipRole,
        selectedStats,
        baselinesBySlot,
        fixedSlotBaseline,
        workspace,
        setNameToId,
        setIdToName,
    };
}

/**
 * Read-or-compute a baselineBreakdown for (ship, slot). Populates the module-
 * level baselineBreakdownCache (exported from potentialCalculator) so the slow
 * path reads the same value if VERIFY_FAST_POTENTIAL runs both. Matches the
 * slow path's cache key format exactly.
 */
function getOrCreateBreakdown(
    ship: Ship,
    slotName: GearSlotName,
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined
): StatBreakdown {
    const key = `${ship.id}_${slotName}_breakdown`;
    const cached = baselineBreakdownCache.get(key);
    if (cached) return cached;

    const equipmentWithoutSlot: Partial<Record<GearSlotName, string>> = { ...ship.equipment };
    if (equipmentWithoutSlot[slotName]) delete equipmentWithoutSlot[slotName];

    const breakdown = calculateTotalStats(
        ship.baseStats,
        equipmentWithoutSlot,
        getGearPiece,
        ship.refits || [],
        ship.implants || {},
        getEngineeringStatsForShipType(ship.type),
        ship.id
    );
    baselineBreakdownCache.set(key, breakdown);
    return breakdown;
}

// Also re-export the small utilities so tests can reuse them
export { statVectorToBaseStats, STAT_COUNT };
```

Notes:
- `baselineStatsCache` / `baselineBreakdownCache` are already exported from `potentialCalculator.ts` — the fast path populates and reads them through the same Map objects, so both paths stay coherent during `VERIFY_FAST_POTENTIAL` runs.
- `percentRef` is stored by reference (not copied). It must be treated as read-only; never mutated inside the scoring functions.

- [ ] **Step 2: Write `potentialContext.test.ts`**

Create `src/utils/gear/fastPotential/__tests__/potentialContext.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildPotentialContext } from '../potentialContext';
import { STAT_INDEX } from '../../../fastScoring/statVector';
import { baselineBreakdownCache, baselineStatsCache } from '../../potentialCalculator';
import type { GearPiece } from '../../../../types/gear';
import type { Ship } from '../../../../types/ship';

function makeMinimalPiece(id: string, slot: string, setBonus?: string): GearPiece {
    return {
        id,
        slot: slot as GearPiece['slot'],
        setBonus,
        rarity: 'legendary',
        level: 0,
        stars: 6,
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
    } as GearPiece;
}

function makeShip(overrides: Partial<Ship> = {}): Ship {
    return {
        id: 'ship-1',
        type: 'ATTACKER',
        name: 'TestShip',
        baseStats: {
            hp: 20000, attack: 5000, defence: 4000, speed: 120,
            hacking: 0, security: 0, crit: 20, critDamage: 80,
            healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0,
            defensePenetration: 0,
        },
        refits: [],
        equipment: {},
        implants: {},
        ...overrides,
    } as Ship;
}

beforeEach(() => {
    baselineBreakdownCache.clear();
    baselineStatsCache.clear();
});

describe('buildPotentialContext — dummy mode', () => {
    it('sets withShip=false and uses role base stats for percentRef', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.withShip).toBe(false);
        expect(ctx.ship).toBeUndefined();
        // ATTACKER base attack = 6250 (per spec Invariants + ROLE_BASE_STATS)
        expect(ctx.percentRef.attack).toBe(6250);
    });

    it('leaves all slot setCounts zeroed', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        for (const baseline of ctx.baselinesBySlot.values()) {
            for (const n of baseline.setCount) expect(n).toBe(0);
        }
    });

    it('finalVector is null for every slot', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        for (const baseline of ctx.baselinesBySlot.values()) {
            expect(baseline.finalVector).toBeNull();
        }
    });
});

describe('buildPotentialContext — with-ship mode', () => {
    it('sets withShip=true and percentRef equals afterEngineering', () => {
        const ship = makeShip();
        const inventory = [makeMinimalPiece('g1', 'weapon')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        expect(ctx.withShip).toBe(true);
        // afterEngineering with no refits / no engineering = baseStats
        expect(ctx.percentRef.attack).toBe(ship.baseStats.attack);
    });

    it('populates afterGearVector and finalVector from the cached breakdown', () => {
        const ship = makeShip();
        const inventory = [makeMinimalPiece('g1', 'weapon')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        const baseline = ctx.baselinesBySlot.get('weapon')!;
        expect(baseline.afterGearVector).toBeInstanceOf(Float64Array);
        expect(baseline.finalVector).toBeInstanceOf(Float64Array);
        expect(baseline.afterGearVector[STAT_INDEX.attack]).toBe(ship.baseStats.attack);
        expect(baseline.finalVector![STAT_INDEX.attack]).toBe(ship.baseStats.attack);
    });

    it('setCount excludes gear in the slot being baselined', () => {
        const equippedPiece: GearPiece = makeMinimalPiece('eq-weapon', 'weapon', 'DECIMATION');
        const otherPiece: GearPiece = makeMinimalPiece('eq-hull', 'hull', 'SHIELD');
        const ship = makeShip({ equipment: { weapon: 'eq-weapon', hull: 'eq-hull' } });
        const gearById = new Map<string, GearPiece>([['eq-weapon', equippedPiece], ['eq-hull', otherPiece]]);
        const inventory = [makeMinimalPiece('g1', 'weapon')];

        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: (id) => gearById.get(id),
            getEngineeringStatsForShipType: () => undefined,
        });

        const baseline = ctx.baselinesBySlot.get('weapon')!;
        const decimationId = ctx.setNameToId.get('DECIMATION')!;
        const shieldId = ctx.setNameToId.get('SHIELD')!;
        // weapon slot excluded → DECIMATION count is 0, SHIELD count is 1
        expect(baseline.setCount[decimationId]).toBe(0);
        expect(baseline.setCount[shieldId]).toBe(1);
    });
});

describe('buildPotentialContext — shared', () => {
    it('reserves setNameToId id=0 for "no set"', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.setIdToName[0]).toBe('');
        expect(ctx.setNameToId.get('DECIMATION')).toBeGreaterThan(0);
    });

    it('sizes workspace.setCount to setIdToName.length', () => {
        const inventory = [makeMinimalPiece('g1', 'weapon', 'DECIMATION')];
        const ctx = buildPotentialContext({
            inventory,
            shipRole: 'ATTACKER',
            slot: undefined,
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });
        expect(ctx.workspace.setCount.length).toBe(ctx.setIdToName.length);
    });
});
```

- [ ] **Step 3: Run the tests — watch them pass**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/potentialContext.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Run the full suite — confirm no regression**

Run: `npm test -- --run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/gear/fastPotential/potentialContext.ts src/utils/gear/fastPotential/__tests__/potentialContext.test.ts
git commit -m "feat(fast-potential): implement buildPotentialContext with slot baselines + set counts"
```

---

## Task 8: Implement `scoreCurrentWithShip`

**Why:** With-ship `currentScore` is the simpler of the two scoring paths — no piece application, no set deltas, no calibration. Landing it first gets a working signal on `calculatePriorityScore` integration before the harder `scorePieceApplied` goes in.

**Files:**
- Create: `src/utils/gear/fastPotential/scorePieceUpgrade.ts`
- Create: `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts`

- [ ] **Step 1: Write `scoreCurrentWithShip`**

Create `src/utils/gear/fastPotential/scorePieceUpgrade.ts`:

```ts
import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants';
import type { StatName } from '../../../types/stats';
import { statVectorToBaseStats } from '../../fastScoring/statVector';
import { calculatePriorityScore } from '../../autogear/scoring';
import type { PotentialContext } from './potentialContext';

/**
 * Score the baseline (no piece applied). With-ship mode only — scores
 * baseline.final, i.e. the ship state without this slot's gear.
 *
 * Dummy mode must NOT call this; dummy has no "ship without this slot"
 * concept, and its current/potential both flow through scorePieceApplied.
 */
export function scoreCurrentWithShip(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName
): number {
    const baseline = ctx.fixedSlotBaseline ?? ctx.baselinesBySlot.get(slot);
    if (!baseline || !baseline.finalVector) {
        // Should never happen: dev throws, prod degrades to 0 so a single
        // missing baseline can't break the whole session.
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(`scoreCurrentWithShip: missing finalVector for slot ${slot}`);
        }
        // eslint-disable-next-line no-console
        console.error(`[fast-potential] missing finalVector for slot ${slot}`);
        return 0;
    }

    const stats = statVectorToBaseStats(baseline.finalVector);
    const baseScore = calculatePriorityScore(stats, [], ctx.shipRole);
    return baseScore + getMainStatBonus(piece, ctx.selectedStats, baseScore);
}

function getMainStatBonus(
    piece: GearPiece,
    selectedStats: readonly StatName[],
    baseScore: number
): number {
    if (selectedStats.length === 0 || !piece.mainStat) return 0;
    if (selectedStats.includes(piece.mainStat.name)) return baseScore * 0.5;
    return 0;
}

// Exported for reuse by scorePieceApplied (Task 9).
export { getMainStatBonus };
```

- [ ] **Step 2: Write a unit test — score against a known baseline**

Append to `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreCurrentWithShip } from '../scorePieceUpgrade';
import { buildPotentialContext } from '../potentialContext';
import { calculatePriorityScore } from '../../../autogear/scoring';
import type { GearPiece } from '../../../../types/gear';
import type { Ship } from '../../../../types/ship';

function makeMinimalPiece(id: string, slot: string): GearPiece {
    return {
        id,
        slot: slot as GearPiece['slot'],
        rarity: 'legendary',
        level: 0,
        stars: 6,
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [],
    } as GearPiece;
}

function makeShip(): Ship {
    return {
        id: 'ship-a',
        type: 'ATTACKER',
        name: 'TestShip',
        baseStats: {
            hp: 20000, attack: 5000, defence: 4000, speed: 120,
            hacking: 0, security: 0, crit: 20, critDamage: 80,
            healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0,
            defensePenetration: 0,
        },
        refits: [], equipment: {}, implants: {},
    } as Ship;
}

describe('scoreCurrentWithShip', () => {
    it('equals calculatePriorityScore(baseline.final) + mainStat bonus', () => {
        const ship = makeShip();
        const piece = makeMinimalPiece('g1', 'weapon');
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: ['attack'],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });

        const actual = scoreCurrentWithShip(ctx, piece, 'weapon');
        const expectedBase = calculatePriorityScore(ship.baseStats, [], 'ATTACKER');
        const expectedWithBonus = expectedBase + expectedBase * 0.5;
        expect(actual).toBeCloseTo(expectedWithBonus, 6);
    });

    it('returns bare baseScore when no selectedStats match', () => {
        const ship = makeShip();
        const piece = makeMinimalPiece('g1', 'weapon');
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: ['hp'], // piece's main is attack, no match
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });
        const actual = scoreCurrentWithShip(ctx, piece, 'weapon');
        const expected = calculatePriorityScore(ship.baseStats, [], 'ATTACKER');
        expect(actual).toBeCloseTo(expected, 6);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/gear/fastPotential/scorePieceUpgrade.ts src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts
git commit -m "feat(fast-potential): scoreCurrentWithShip (with-ship current-path scorer)"
```

---

## Task 9: Implement `scorePieceApplied`

**Why:** The main hot-path scorer. Used by three call sites (with-ship potentialScore, dummy currentScore, dummy potentialScore) and is where the wins come from — workspace reuse instead of `StatBreakdown` cloning. Gets the two trickiest invariants (calibration, set-bonus mode split).

**Files:**
- Modify: `src/utils/gear/fastPotential/scorePieceUpgrade.ts`
- Modify: `src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts`

- [ ] **Step 1: Add module imports**

At the top of `scorePieceUpgrade.ts`, alongside the existing imports, add:

```ts
import type { BaseStats, Stat, StatName } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { STAT_INDEX } from '../../fastScoring/statVector';
import { GEAR_SETS } from '../../../constants/gearSets';
import { isCalibrationEligible, getCalibratedMainStat } from '../calibrationCalculator';
```

- [ ] **Step 2: Add the scorer body**

Append to `scorePieceUpgrade.ts`:

```ts
/**
 * Score with the piece applied to the afterGear baseline, plus set-bonus
 * handling. Covers three call sites:
 *   - with-ship potentialScore (piece = original or simulated upgrade)
 *   - dummy currentScore (piece = original)
 *   - dummy potentialScore (piece = simulated upgrade)
 *
 * Mutates ctx.workspace. Caller must not rely on workspace state between calls.
 */
export function scorePieceApplied(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName
): number {
    const baseline = ctx.fixedSlotBaseline ?? ctx.baselinesBySlot.get(slot);
    if (!baseline) {
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(`scorePieceApplied: missing baseline for slot ${slot}`);
        }
        // eslint-disable-next-line no-console
        console.error(`[fast-potential] missing baseline for slot ${slot}`);
        return 0;
    }

    // 1. Reset workspace from baseline.
    const w = ctx.workspace.stats;
    const src = baseline.afterGearVector;
    for (let i = 0; i < w.length; i++) w[i] = src[i];

    // 2. Copy setCount baseline into workspace.setCount.
    const wc = ctx.workspace.setCount;
    const sc = baseline.setCount;
    // The workspace.setCount is always sized to ctx.setIdToName.length;
    // baseline.setCount matches, enforced in buildPotentialContext.
    for (let i = 0; i < wc.length; i++) wc[i] = sc[i];

    // 3. Dummy-mode crit baseline adjustment.
    //    Slow-path reference: potentialCalculator.ts:646-656 + 724.
    //    The slow path sets baseStats.crit = max(0, 100 - gearCrit) BEFORE the
    //    piece stats are applied on top, so the post-apply crit sums to ~100
    //    (baseline + gear contributions cancel). The fast path must follow the
    //    same order: seed workspace.crit with the baseline here, then step 5's
    //    applyStat calls add the piece's crit contributions back on top.
    //    With-ship uses the ship's actual crit (already in afterGear); skip.
    if (!ctx.withShip) {
        let gearCrit = 0;
        if (piece.mainStat?.name === 'crit') gearCrit += piece.mainStat.value;
        if (piece.subStats) {
            for (const s of piece.subStats) if (s.name === 'crit') gearCrit += s.value;
        }
        w[STAT_INDEX.crit] = Math.max(0, 100 - gearCrit);
    }

    // 4. Resolve the piece's main stat for application (calibration).
    //    Only with-ship mode checks calibration; dummy never applies.
    let mainStat: Stat | undefined = piece.mainStat;
    if (
        ctx.withShip &&
        ctx.ship &&
        piece.calibration?.shipId === ctx.ship.id &&
        isCalibrationEligible(piece) &&
        mainStat
    ) {
        mainStat = getCalibratedMainStat(piece);
    }

    // 5. Apply main + substats to workspace.
    if (mainStat) applyStat(mainStat, w, ctx.percentRef);
    if (piece.subStats) {
        for (const s of piece.subStats) applyStat(s, w, ctx.percentRef);
    }

    // 6. Set bonus handling — diverges by mode.
    if (piece.setBonus) {
        const setId = ctx.setNameToId.get(piece.setBonus);
        const setDef = GEAR_SETS[piece.setBonus];

        if (ctx.withShip) {
            // Deltaful: only apply when adding this piece crosses a threshold.
            if (setId !== undefined && setDef) {
                const minPieces = setDef.minPieces ?? 2;
                const before = Math.floor(baseline.setCount[setId] / minPieces);
                wc[setId]++;
                const after = Math.floor(wc[setId] / minPieces);
                const delta = after - before;
                if (delta > 0 && setDef.stats) {
                    const scale = minPieces >= 4 ? 0.5 : 1;
                    for (let k = 0; k < delta; k++) {
                        for (const s of setDef.stats) {
                            applyScaledStat(s, scale, w, ctx.percentRef);
                        }
                    }
                }
            }
        } else {
            // Dummy optimistic: apply the set stats once if present.
            if (setDef?.stats) {
                const minPieces = setDef.minPieces ?? 2;
                const scale = minPieces >= 4 ? 0.5 : 1;
                for (const s of setDef.stats) {
                    applyScaledStat(s, scale, w, ctx.percentRef);
                }
            }
        }
    }

    // 7. Hand off to the canonical scorer.
    const stats = statVectorToBaseStats(w);
    const baseScore = calculatePriorityScore(stats, [], ctx.shipRole);
    return baseScore + getMainStatBonus(piece, ctx.selectedStats, baseScore);
}

function applyStat(stat: Stat, target: Float64Array, percentRef: BaseStats): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const ref = (percentRef as Record<string, number>)[stat.name] ?? 0;
        target[idx] += ref * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}

function applyScaledStat(
    stat: Stat,
    scale: number,
    target: Float64Array,
    percentRef: BaseStats
): void {
    // Scale only the VALUE, not the reference, to match the slow path
    // (potentialCalculator.ts:373-379 and :451-469 both multiply stat.value).
    applyStat({ ...stat, value: stat.value * scale }, target, percentRef);
}
```

- [ ] **Step 3: Add unit tests — with-ship, dummy, set bonus, calibration**

Append to `__tests__/scorePieceUpgrade.test.ts`:

```ts
import { scorePieceApplied } from '../scorePieceUpgrade';
// ... existing imports already cover buildPotentialContext, calculatePriorityScore, etc.

describe('scorePieceApplied — dummy mode', () => {
    it('matches calculateGearStats + calculatePriorityScore for a lone piece', async () => {
        const piece: GearPiece = {
            id: 'g1', slot: 'weapon', rarity: 'legendary', level: 0, stars: 6,
            mainStat: { name: 'attack', value: 200, type: 'flat' },
            subStats: [{ name: 'hp', value: 500, type: 'flat' }],
        } as GearPiece;
        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship: undefined,
            getGearPiece: undefined,
            getEngineeringStatsForShipType: undefined,
        });

        // Slow path: ATTACKER role base + piece applied (no set bonus).
        const { analyzePotentialUpgrades } = await import('../../potentialCalculator');
        const [slowResult] = analyzePotentialUpgrades(
            [piece], 'ATTACKER', 1, undefined, 'rare', 1, [], 'AND', [],
            undefined, undefined, undefined
        );

        const fastScore = scorePieceApplied(ctx, piece, 'weapon');
        // analyzePotentialUpgrades averages over simulationCount — with count=1
        // and piece.level=0 -> simulateUpgrade returns the piece untouched; the
        // currentScore equals scorePieceApplied's output for dummy.
        expect(fastScore).toBeCloseTo(slowResult.currentScore, 5);
    });
});

describe('scorePieceApplied — set bonus (with-ship deltaful)', () => {
    it('applies set bonus only when crossing minPieces threshold', () => {
        // Build a ship with 1 DECIMATION piece equipped in "hull" (not weapon).
        const equippedHull: GearPiece = {
            id: 'h1', slot: 'hull', setBonus: 'DECIMATION',
            rarity: 'legendary', level: 16, stars: 6,
            mainStat: { name: 'hp', value: 100, type: 'flat' },
            subStats: [],
        } as GearPiece;
        const shipWithOne: Ship = {
            id: 'ship-s1', type: 'ATTACKER', name: 'TestShip',
            baseStats: { hp: 20000, attack: 5000, defence: 4000, speed: 120, hacking: 0, security: 0, crit: 20, critDamage: 80, healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
            refits: [], implants: {}, equipment: { hull: 'h1' },
        } as Ship;
        const incoming: GearPiece = {
            id: 'w1', slot: 'weapon', setBonus: 'DECIMATION',
            rarity: 'legendary', level: 16, stars: 6,
            mainStat: { name: 'attack', value: 100, type: 'flat' },
            subStats: [],
        } as GearPiece;
        const pieceLookup = new Map<string, GearPiece>([['h1', equippedHull]]);

        const ctx = buildPotentialContext({
            inventory: [incoming],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship: shipWithOne,
            getGearPiece: (id) => pieceLookup.get(id),
            getEngineeringStatsForShipType: () => undefined,
        });

        // Count before = 1 (hull). Count after adding incoming (weapon) = 2.
        // DECIMATION minPieces = 2 => crosses threshold. The scorer must
        // apply the set bonus at least once; we assert the score is strictly
        // greater than a same-piece-without-setBonus version.
        const scoreWithSet = scorePieceApplied(ctx, incoming, 'weapon');
        const noSet: GearPiece = { ...incoming, setBonus: undefined };
        const scoreNoSet = scorePieceApplied(ctx, noSet, 'weapon');
        expect(scoreWithSet).toBeGreaterThan(scoreNoSet);
    });
});

describe('scorePieceApplied — calibration (with-ship only)', () => {
    it('substitutes calibrated main stat when piece.calibration.shipId matches', () => {
        // Build a calibration-eligible piece (level>=16, stars>=5) that is
        // calibrated to the target ship. Compare against the same piece
        // without calibration — calibrated score must be strictly higher
        // (calibration boosts the main stat).
        const baseStat = { name: 'attack' as const, value: 500, type: 'flat' as const };
        const piece: GearPiece = {
            id: 'c1', slot: 'weapon', rarity: 'legendary', level: 16, stars: 6,
            mainStat: baseStat,
            subStats: [],
            calibration: { shipId: 'ship-c', level: 1 },
        } as GearPiece;
        const uncalibrated: GearPiece = { ...piece, calibration: undefined };

        const ship: Ship = {
            id: 'ship-c', type: 'ATTACKER', name: 'TestShip',
            baseStats: { hp: 20000, attack: 5000, defence: 4000, speed: 120, hacking: 0, security: 0, crit: 20, critDamage: 80, healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0, defensePenetration: 0 },
            refits: [], implants: {}, equipment: {},
        } as Ship;

        const ctx = buildPotentialContext({
            inventory: [piece],
            shipRole: 'ATTACKER',
            slot: 'weapon',
            selectedStats: [],
            ship,
            getGearPiece: () => undefined,
            getEngineeringStatsForShipType: () => undefined,
        });

        const calibrated = scorePieceApplied(ctx, piece, 'weapon');
        const plain = scorePieceApplied(ctx, uncalibrated, 'weapon');
        expect(calibrated).toBeGreaterThan(plain);
    });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts --run`
Expected: all pass. The dummy-mode test must use `toBeCloseTo(…, 5)` (relative-friendly tolerance for scores in the ~10^6 range).

- [ ] **Step 5: Run full suite**

Run: `npm test -- --run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/gear/fastPotential/scorePieceUpgrade.ts src/utils/gear/fastPotential/__tests__/scorePieceUpgrade.test.ts
git commit -m "feat(fast-potential): scorePieceApplied (hot-loop scorer for all 3 call sites)"
```

---

## Task 10: Implement `fastAnalyzePotentialUpgrades`

**Why:** The drop-in replacement for `analyzePotentialUpgrades`. Builds the context once, iterates eligible pieces, runs `simulationCount` upgrades per piece, returns the top-N by `potentialScore`. Signature matches exactly so dispatch in Phase 3 is a one-line call.

**Files:**
- Create: `src/utils/gear/fastPotential/fastAnalyze.ts`

- [ ] **Step 1: Write `fastAnalyzePotentialUpgrades`**

Create `src/utils/gear/fastPotential/fastAnalyze.ts`:

```ts
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { StatName, EngineeringStat } from '../../../types/stats';
import type { ShipTypeName, GearSlotName } from '../../../constants';
import { simulateUpgrade } from '../potentialCalculator';
import { buildPotentialContext } from './potentialContext';
import { scoreCurrentWithShip, scorePieceApplied } from './scorePieceUpgrade';

export interface PotentialResult {
    piece: GearPiece;
    currentScore: number;
    potentialScore: number;
    improvement: number;
}

export function fastAnalyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20,
    selectedStats: StatName[] = [],
    statFilterMode: 'AND' | 'OR' = 'AND',
    selectedGearSets: string[] = [],
    ship?: Ship,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined
): PotentialResult[] {
    // Filter eligible pieces — identical to slowAnalyzePotentialUpgrades.
    const rarityOrder = ['rare', 'epic', 'legendary'];
    const minRarityIndex = rarityOrder.indexOf(minRarity);
    const eligibleRarities = rarityOrder.slice(minRarityIndex);

    const pieceStats = (p: GearPiece): StatName[] => {
        const out: StatName[] = [];
        if (p.mainStat) out.push(p.mainStat.name);
        if (p.subStats) for (const s of p.subStats) out.push(s.name);
        return out;
    };
    const matchesStatFilter = (p: GearPiece): boolean => {
        if (selectedStats.length === 0) return true;
        const names = pieceStats(p);
        return statFilterMode === 'AND'
            ? selectedStats.every((s) => names.includes(s))
            : selectedStats.some((s) => names.includes(s));
    };

    const eligiblePieces = inventory.filter(
        (piece) =>
            piece.level < 16 &&
            eligibleRarities.includes(piece.rarity) &&
            !piece.slot.includes('implant') &&
            (!slot || piece.slot === slot) &&
            matchesStatFilter(piece) &&
            (selectedGearSets.length === 0 ||
                (piece.setBonus && selectedGearSets.includes(piece.setBonus)))
    );

    if (eligiblePieces.length === 0) return [];

    const ctx = buildPotentialContext({
        inventory: eligiblePieces,
        shipRole,
        slot,
        selectedStats,
        ship,
        getGearPiece,
        getEngineeringStatsForShipType,
    });

    const results: PotentialResult[] = [];
    for (const piece of eligiblePieces) {
        const targetSlot = slot ?? piece.slot;

        const currentScore = ctx.withShip
            ? scoreCurrentWithShip(ctx, piece, targetSlot)
            : scorePieceApplied(ctx, piece, targetSlot);

        let sumPotential = 0;
        for (let i = 0; i < simulationCount; i++) {
            const { piece: upgraded } = simulateUpgrade(piece);
            sumPotential += scorePieceApplied(ctx, upgraded, targetSlot);
        }
        const potentialScore = simulationCount > 0 ? sumPotential / simulationCount : currentScore;

        results.push({
            piece,
            currentScore,
            potentialScore,
            improvement: potentialScore - currentScore,
        });
    }

    return results.sort((a, b) => b.potentialScore - a.potentialScore).slice(0, count);
}
```

- [ ] **Step 2: TypeScript compile check**

Run: `npm run build`.
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/gear/fastPotential/fastAnalyze.ts
git commit -m "feat(fast-potential): fastAnalyzePotentialUpgrades (drop-in for analyze)"
```

---

# Phase 3 — Equivalence tests (primary correctness gate)

Phase 3 builds the equivalence test suite that gates the Phase 4 dispatch. These tests run both `slowAnalyzePotentialUpgrades` and `fastAnalyzePotentialUpgrades` on the same inputs, under a mocked PRNG so both see the same simulated upgrades, and assert strict ordering equivalence + per-piece score equivalence.

Phase 3 is self-contained: only test code changes.

## Task 11: Equivalence-test fixtures and helpers

**Why:** Before writing the scenario matrix, land the seeded PRNG + inventory generator + tolerance helper. One commit, reused by every scenario.

**Files:**
- Create: `src/utils/gear/fastPotential/__tests__/fixtures/testInventory.ts`

- [ ] **Step 1: Write the fixture**

Create `src/utils/gear/fastPotential/__tests__/fixtures/testInventory.ts`:

```ts
import type { Ship } from '../../../../../types/ship';
import type { GearPiece } from '../../../../../types/gear';
import type { BaseStats } from '../../../../../types/stats';
import { GEAR_SLOTS } from '../../../../../constants';

export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const TEST_BASE_STATS: BaseStats = {
    hp: 50000, attack: 10000, defence: 8000, speed: 300,
    hacking: 500, security: 300, crit: 30, critDamage: 120,
    healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0,
    defensePenetration: 0,
};

export const TEST_SET_BONUSES = ['SHIELD', 'DECIMATION', 'BOOST', 'HARDENED'] as const;

export function makeTestShip(overrides: Partial<Ship> = {}): Ship {
    return {
        id: 'ship-1',
        type: 'ATTACKER',
        name: 'TestShip',
        baseStats: { ...TEST_BASE_STATS },
        refits: [],
        equipment: {},
        implants: {},
        ...overrides,
    } as Ship;
}

/**
 * Generate an inventory where every piece has level < 16 (so every piece is
 * eligible for the upgrade analysis path) and covers all 6 gear slots + the
 * four test set bonuses. Deterministic given the same seed.
 */
export function generateEligibleInventory(seed = 1, count = 24): GearPiece[] {
    const rnd = seededRandom(seed);
    const slots = Object.keys(GEAR_SLOTS) as (keyof typeof GEAR_SLOTS)[];
    const pieces: GearPiece[] = [];
    for (let i = 0; i < count; i++) {
        const slot = slots[i % slots.length];
        const setBonus = i % 3 === 0 ? TEST_SET_BONUSES[i % TEST_SET_BONUSES.length] : undefined;
        const isPercent = rnd() < 0.5;
        pieces.push({
            id: `g${i}`,
            slot,
            setBonus,
            rarity: 'legendary',
            level: Math.floor(rnd() * 12),     // 0..11 — always < 16
            stars: 5 + Math.floor(rnd() * 2),  // 5 or 6
            mainStat: isPercent
                ? { name: 'attack', value: 5 + Math.floor(rnd() * 10), type: 'percentage' }
                : { name: 'attack', value: 300 + Math.floor(rnd() * 200), type: 'flat' },
            subStats: [
                { name: 'hp', value: 800 + Math.floor(rnd() * 500), type: 'flat' },
                { name: 'crit', value: 3 + Math.floor(rnd() * 5), type: 'percentage' },
            ],
        } as GearPiece);
    }
    return pieces;
}

/**
 * Relative-or-absolute float closeness helper.
 * - { abs: N } → absolute tolerance |a-b| <= N
 * - { relative: true } → relative tolerance matching the plan's score policy
 */
export function assertFloatsClose(
    a: number,
    b: number,
    mode: { abs: number } | { relative: true }
): void {
    if ('abs' in mode) {
        if (Math.abs(a - b) > mode.abs) {
            throw new Error(`expected |${a} - ${b}| <= ${mode.abs} (abs), got ${Math.abs(a - b)}`);
        }
    } else {
        const scale = Math.max(1, Math.abs(a), Math.abs(b));
        if (Math.abs(a - b) > 1e-6 * scale) {
            throw new Error(
                `expected |${a} - ${b}| <= 1e-6 * ${scale} (relative), got ${Math.abs(a - b)}`
            );
        }
    }
}
```

- [ ] **Step 2: Smoke-test the fixture**

Create `src/utils/gear/fastPotential/__tests__/equivalence.test.ts` with just a fixture sanity test for now:

```ts
import { describe, it, expect } from 'vitest';
import { generateEligibleInventory, seededRandom } from './fixtures/testInventory';

describe('fixture sanity', () => {
    it('generates deterministic inventory for the same seed', () => {
        const a = generateEligibleInventory(42, 12);
        const b = generateEligibleInventory(42, 12);
        expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
        expect(a[0].mainStat.value).toBe(b[0].mainStat.value);
    });

    it('seededRandom is reproducible', () => {
        const r1 = seededRandom(1);
        const r2 = seededRandom(1);
        for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
    });

    it('every generated piece has level < 16', () => {
        const pieces = generateEligibleInventory(7, 30);
        for (const p of pieces) expect(p.level).toBeLessThan(16);
    });
});
```

- [ ] **Step 3: Run the sanity tests**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/equivalence.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/gear/fastPotential/__tests__/fixtures/ src/utils/gear/fastPotential/__tests__/equivalence.test.ts
git commit -m "test(fast-potential): seeded inventory fixture + assertFloatsClose helper"
```

---

## Task 12: Equivalence — randomized scenario matrix

**Why:** The primary correctness gate. Produces identical piece ordering + per-piece scores within `1e-6` relative tolerance across ~30 randomized scenarios that cover role variants, slot scope, rarity, stat filter, gear-set filter, and ship-vs-dummy mode.

**Files:**
- Modify: `src/utils/gear/fastPotential/__tests__/equivalence.test.ts`

- [ ] **Step 1: Add the randomized scenario matrix**

Append to `equivalence.test.ts`:

```ts
import { analyzePotentialUpgrades, baselineBreakdownCache, baselineStatsCache } from '../../potentialCalculator';
import { fastAnalyzePotentialUpgrades } from '../fastAnalyze';
import { assertFloatsClose, generateEligibleInventory, makeTestShip, seededRandom } from './fixtures/testInventory';
import type { ShipTypeName, GearSlotName } from '../../../../constants';
import type { StatName } from '../../../../types/stats';
import { beforeEach, afterEach, vi } from 'vitest';

const ALL_ROLES: ShipTypeName[] = [
    'ATTACKER',
    'DEFENDER', 'DEFENDER_SECURITY',
    'DEBUFFER', 'DEBUFFER_DEFENSIVE', 'DEBUFFER_DEFENSIVE_SECURITY',
    'DEBUFFER_BOMBER', 'DEBUFFER_CORROSION',
    'SUPPORTER', 'SUPPORTER_BUFFER', 'SUPPORTER_OFFENSIVE', 'SUPPORTER_SHIELD',
];
const RARITIES = ['rare', 'epic', 'legendary'] as const;
const SIM_COUNT_BY_RARITY: Record<(typeof RARITIES)[number], number> = {
    rare: 10, epic: 20, legendary: 40,
};
const SLOT_OPTIONS: (GearSlotName | undefined)[] = [undefined, 'weapon', 'hull'];
const STAT_OPTIONS: StatName[][] = [[], ['attack'], ['hp', 'crit']];
const FILTER_MODES = ['AND', 'OR'] as const;
const SET_FILTER_OPTIONS = [[], ['DECIMATION'], ['SHIELD', 'BOOST']];

interface Scenario {
    role: ShipTypeName;
    slot: GearSlotName | undefined;
    rarity: (typeof RARITIES)[number];
    selectedStats: StatName[];
    statFilterMode: (typeof FILTER_MODES)[number];
    selectedGearSets: string[];
    withShip: boolean;
    seed: number;
}

function generateScenarios(count: number, seed = 123): Scenario[] {
    const rnd = seededRandom(seed);
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
    const out: Scenario[] = [];
    for (let i = 0; i < count; i++) {
        out.push({
            role: pick(ALL_ROLES),
            slot: pick(SLOT_OPTIONS),
            rarity: pick(RARITIES),
            selectedStats: pick(STAT_OPTIONS),
            statFilterMode: pick(FILTER_MODES),
            selectedGearSets: pick(SET_FILTER_OPTIONS),
            withShip: rnd() < 0.6, // bias toward with-ship, the 20× path
            seed: i + 1,
        });
    }
    return out;
}

beforeEach(() => {
    baselineBreakdownCache.clear();
    baselineStatsCache.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('equivalence: fast vs slow analyzePotentialUpgrades', () => {
    const scenarios = generateScenarios(30);
    it.each(scenarios)(
        'scenario #$seed role=$role slot=$slot rarity=$rarity withShip=$withShip',
        (sc) => {
            // Deterministic PRNG for simulateUpgrade — both paths must see
            // identical random sequences. Reset the sequence between slow and
            // fast by re-mocking with the same seed.
            const inventory = generateEligibleInventory(sc.seed, 30);
            const ship = sc.withShip ? makeTestShip({ type: sc.role }) : undefined;
            const gearById = new Map(inventory.map((p) => [p.id, p]));
            const getGearPiece = ship ? (id: string) => gearById.get(id) : undefined;
            const getEngineeringStats = ship ? () => undefined : undefined;

            const simCount = SIM_COUNT_BY_RARITY[sc.rarity];
            const args = [
                inventory, sc.role, 6, sc.slot, sc.rarity, simCount,
                sc.selectedStats, sc.statFilterMode, sc.selectedGearSets,
                ship, getGearPiece, getEngineeringStats,
            ] as const;

            // Slow run with fresh PRNG
            let rng = seededRandom(sc.seed + 1000);
            vi.spyOn(Math, 'random').mockImplementation(() => rng());
            const slowResults = analyzePotentialUpgrades(...args);

            // Fast run with fresh PRNG — SAME seed, so identical sequence
            rng = seededRandom(sc.seed + 1000);
            vi.spyOn(Math, 'random').mockImplementation(() => rng());
            baselineBreakdownCache.clear();
            baselineStatsCache.clear();
            const fastResults = fastAnalyzePotentialUpgrades(...args);

            expect(fastResults.length).toBe(slowResults.length);
            for (let i = 0; i < slowResults.length; i++) {
                expect(fastResults[i].piece.id).toBe(slowResults[i].piece.id);
                assertFloatsClose(fastResults[i].currentScore, slowResults[i].currentScore, { relative: true });
                assertFloatsClose(fastResults[i].potentialScore, slowResults[i].potentialScore, { relative: true });
                assertFloatsClose(fastResults[i].improvement, slowResults[i].improvement, { relative: true });
            }
        }
    );
});
```

- [ ] **Step 2: Run the equivalence tests**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/equivalence.test.ts --run`
Expected: all 30 pass. If a subset fails, read the assertion message — it prints the scenario record, making it easy to reproduce offline.

- [ ] **Step 3: If any scenario fails, diagnose before moving on**

Common causes, in order of likelihood:
1. Mocked `Math.random` is being called a different number of times by fast vs slow (e.g. the fast path calls `simulateUpgrade` in a different order). Log the count under a spy: the two paths must draw identical numbers of times.
2. Set bonus threshold off-by-one — re-read Invariant 2 and `scorePieceApplied` Step 6.
3. Calibration not applied — re-read Invariant 3.

- [ ] **Step 4: Commit**

```bash
git add src/utils/gear/fastPotential/__tests__/equivalence.test.ts
git commit -m "test(fast-potential): randomized equivalence matrix (30 scenarios, 12 roles, mocked PRNG)"
```

---

## Task 13: Equivalence — explicit edge cases

**Why:** Randomized coverage might not hit specific thresholds. Add targeted tests for the known-risky boundaries from the spec.

**Files:**
- Modify: `src/utils/gear/fastPotential/__tests__/equivalence.test.ts`

- [ ] **Step 1: Append explicit-case tests**

Add to `equivalence.test.ts`:

```ts
describe('equivalence: explicit edge cases', () => {
    // Helper that runs both paths under the same PRNG and returns results
    // for assertion. Keeps individual tests short.
    function runBothPaths(args: Parameters<typeof analyzePotentialUpgrades>, seed = 0) {
        let rng = seededRandom(seed);
        vi.spyOn(Math, 'random').mockImplementation(() => rng());
        const slow = analyzePotentialUpgrades(...args);
        rng = seededRandom(seed);
        vi.spyOn(Math, 'random').mockImplementation(() => rng());
        baselineBreakdownCache.clear();
        baselineStatsCache.clear();
        const fast = fastAnalyzePotentialUpgrades(...args);
        return { slow, fast };
    }

    it('empty eligible pieces returns empty arrays from both paths', () => {
        const { slow, fast } = runBothPaths([
            [], 'ATTACKER', 6, undefined, 'rare', 10,
            [], 'AND', [], undefined, undefined, undefined,
        ]);
        expect(slow).toEqual([]);
        expect(fast).toEqual([]);
    });

    it('single eligible piece produces matching single result (dummy)', () => {
        const inv = generateEligibleInventory(100, 1);
        const { slow, fast } = runBothPaths([
            inv, 'ATTACKER', 6, undefined, 'rare', 5,
            [], 'AND', [], undefined, undefined, undefined,
        ]);
        expect(fast).toHaveLength(1);
        assertFloatsClose(fast[0].potentialScore, slow[0].potentialScore, { relative: true });
    });

    it('simulated-upgrade of calibrated piece applies calibration in both paths', () => {
        // analyzePotentialUpgrades filters for piece.level < 16, but
        // isCalibrationEligible requires piece.level === 16. So the
        // CURRENT-path calibration branch is unreachable — the only place
        // calibration actually runs is inside the simulation loop, where
        // simulateUpgrade() returns a piece at level 16. That upgraded
        // piece inherits the original's calibration metadata (via spread)
        // and therefore hits getCalibratedMainStat.
        //
        // This test exercises exactly that path: an analyze-eligible
        // piece (level 15, stars >= 5) with calibration metadata pointing
        // at the target ship. Fast and slow must produce identical
        // potentialScore (calibration applied to simulated upgrade).
        const ship = makeTestShip();
        const inv = generateEligibleInventory(55, 8);
        inv[0] = {
            ...inv[0],
            level: 15, stars: 5,                                // analyze-eligible; upgrade → 16 → calibration-eligible
            calibration: { shipId: ship.id, level: 2 },
        };
        const gearById = new Map(inv.map((p) => [p.id, p]));
        const { slow, fast } = runBothPaths([
            inv, 'ATTACKER', 6, undefined, 'rare', 10,
            [], 'AND', [], ship, (id) => gearById.get(id), () => undefined,
        ], 77);
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
        for (let i = 0; i < slow.length; i++) {
            assertFloatsClose(fast[i].potentialScore, slow[i].potentialScore, { relative: true });
        }
        // Sanity: the calibrated piece's potentialScore must differ from what
        // it would be without calibration metadata — proves calibration
        // actually ran on the upgraded piece. (Drop this assertion if flaky;
        // the equivalence assertions above are the primary gate.)
        const invNoCal = inv.map((p, i) => (i === 0 ? { ...p, calibration: undefined } : p));
        const gearByIdNoCal = new Map(invNoCal.map((p) => [p.id, p]));
        const { fast: fastNoCal } = runBothPaths([
            invNoCal, 'ATTACKER', 6, undefined, 'rare', 10,
            [], 'AND', [], ship, (id) => gearByIdNoCal.get(id), () => undefined,
        ], 77);
        const calIdx = fast.findIndex((r) => r.piece.id === inv[0].id);
        const noCalIdx = fastNoCal.findIndex((r) => r.piece.id === inv[0].id);
        if (calIdx >= 0 && noCalIdx >= 0) {
            expect(fast[calIdx].potentialScore).not.toBe(fastNoCal[noCalIdx].potentialScore);
        }
    });

    it('2-piece set threshold: with-ship equipping to cross 2-piece boundary', () => {
        // The ship already has 1 DECIMATION piece; the candidate piece is
        // DECIMATION → adding it flips setCount from 1 to 2, crossing the
        // 2-piece boundary. Slow path applies bonus; fast must too.
        const ship = makeTestShip({ equipment: { hull: 'eq-hull' } });
        const equippedHull = {
            id: 'eq-hull', slot: 'hull' as const, setBonus: 'DECIMATION' as const,
            rarity: 'legendary' as const, level: 16, stars: 6,
            mainStat: { name: 'hp' as const, value: 100, type: 'flat' as const },
            subStats: [],
        };
        const inv = generateEligibleInventory(99, 4).map((p, i) =>
            i === 0 ? { ...p, slot: 'weapon' as const, setBonus: 'DECIMATION' as const } : p
        );
        const gearById = new Map<string, GearPiece>([
            ['eq-hull', equippedHull as GearPiece],
            ...inv.map((p) => [p.id, p] as [string, GearPiece]),
        ]);
        const { slow, fast } = runBothPaths([
            inv, 'ATTACKER', 6, 'weapon', 'rare', 10,
            [], 'AND', [], ship, (id) => gearById.get(id), () => undefined,
        ], 11);
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
        for (let i = 0; i < slow.length; i++) {
            assertFloatsClose(fast[i].potentialScore, slow[i].potentialScore, { relative: true });
        }
    });

    it('DEBUFFER_CORROSION with DECIMATION set piece (role-specific bonus)', () => {
        const ship = makeTestShip({ type: 'DEBUFFER_CORROSION' });
        const inv = generateEligibleInventory(21, 6).map((p, i) =>
            i === 0 ? { ...p, setBonus: 'DECIMATION' as const } : p
        );
        const gearById = new Map(inv.map((p) => [p.id, p]));
        const { slow, fast } = runBothPaths([
            inv, 'DEBUFFER_CORROSION', 6, undefined, 'rare', 10,
            [], 'AND', [], ship, (id) => gearById.get(id), () => undefined,
        ], 33);
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
    });
});
```

- [ ] **Step 2: Run the explicit tests**

Run: `npm test -- src/utils/gear/fastPotential/__tests__/equivalence.test.ts --run`
Expected: all pass (randomized + explicit).

- [ ] **Step 3: Run full suite**

Run: `npm test -- --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/gear/fastPotential/__tests__/equivalence.test.ts
git commit -m "test(fast-potential): explicit equivalence cases (empty, single, calibration, set thresholds, role-specific)"
```

---

# Phase 4 — Wire dispatch in `analyzePotentialUpgrades` behind the flag

Phase 4 routes the production entry point through the fast path when `USE_FAST_POTENTIAL === true`. Default remains `false`; flipping is Phase 5. `VERIFY_FAST_POTENTIAL` runs both paths and compares.

## Task 14: Rename the existing body to `slowAnalyzePotentialUpgrades`

**Why:** The dispatch needs to invoke the slow path explicitly (both for the default branch and for the verify branch). Rather than inline the full body, extract it under its original name.

**Files:**
- Modify: `src/utils/gear/potentialCalculator.ts`

- [ ] **Step 1: Rename and re-export**

In `src/utils/gear/potentialCalculator.ts`, locate the existing `export function analyzePotentialUpgrades(...)` (around line 539). Rename it to `slowAnalyzePotentialUpgrades` — keep the entire body identical. Make it a local `function` (not exported) since the only external consumer will be the dispatch wrapper below.

```ts
function slowAnalyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20,
    selectedStats: StatName[] = [],
    statFilterMode: 'AND' | 'OR' = 'AND',
    selectedGearSets: string[] = [],
    ship?: Ship,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined
): PotentialResult[] {
    // ...existing body, unchanged...
}
```

- [ ] **Step 2: TypeScript compile check**

Run: `npm run build`.
Expected: errors pointing at every caller of `analyzePotentialUpgrades` (it no longer exists). Don't fix them yet — the dispatch wrapper in Task 15 restores the export.

- [ ] **Step 3: Do not commit yet**

Hold this change; Task 15 adds the dispatch so the export is restored in the same diff. Leaving the branch compiling between tasks is more important than atomic commits here — this is a case where the two changes are conceptually one.

---

## Task 15: Add the dispatch wrapper

**Why:** The thin wrapper that routes to fast vs slow based on the flag. Also implements the `VERIFY_FAST_POTENTIAL` branch that runs both and logs divergences.

**Files:**
- Modify: `src/utils/gear/potentialCalculator.ts`

- [ ] **Step 1: Add the wrapper**

At the top of `potentialCalculator.ts` (just below imports, above `ROLE_BASE_STATS`), add:

```ts
import { USE_FAST_POTENTIAL, VERIFY_FAST_POTENTIAL } from './fastPotential/featureFlag';
import { fastAnalyzePotentialUpgrades } from './fastPotential/fastAnalyze';
```

Then, immediately after `slowAnalyzePotentialUpgrades` is defined, add the dispatch wrapper that takes its place as the exported entry point:

```ts
export function analyzePotentialUpgrades(
    inventory: GearPiece[],
    shipRole: ShipTypeName,
    count: number = 6,
    slot?: GearSlotName,
    minRarity: 'rare' | 'epic' | 'legendary' = 'rare',
    simulationCount: number = 20,
    selectedStats: StatName[] = [],
    statFilterMode: 'AND' | 'OR' = 'AND',
    selectedGearSets: string[] = [],
    ship?: Ship,
    getGearPiece?: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType?: (shipType: ShipTypeName) => EngineeringStat | undefined
): PotentialResult[] {
    const args = [
        inventory, shipRole, count, slot, minRarity, simulationCount,
        selectedStats, statFilterMode, selectedGearSets,
        ship, getGearPiece, getEngineeringStatsForShipType,
    ] as const;

    if (VERIFY_FAST_POTENTIAL) {
        const slowResult = slowAnalyzePotentialUpgrades(...args);
        const fastResult = fastAnalyzePotentialUpgrades(...args);
        verifyEquivalence(slowResult, fastResult, { shipRole, slot, withShip: !!ship });
        return slowResult; // production answer stays on the slow path while verifying
    }

    if (USE_FAST_POTENTIAL) {
        return fastAnalyzePotentialUpgrades(...args);
    }

    return slowAnalyzePotentialUpgrades(...args);
}

function verifyEquivalence(
    slow: PotentialResult[],
    fast: PotentialResult[],
    ctx: { shipRole: ShipTypeName; slot: GearSlotName | undefined; withShip: boolean }
): void {
    if (fast.length !== slow.length) {
        // eslint-disable-next-line no-console
        console.error('[VERIFY_FAST_POTENTIAL] length mismatch', { slow: slow.length, fast: fast.length, ctx });
        return;
    }
    for (let i = 0; i < slow.length; i++) {
        if (fast[i].piece.id !== slow[i].piece.id) {
            // eslint-disable-next-line no-console
            console.error('[VERIFY_FAST_POTENTIAL] ordering divergence', {
                i, slow: slow[i].piece.id, fast: fast[i].piece.id, ctx,
            });
            return;
        }
        const scale = Math.max(1, Math.abs(slow[i].potentialScore), Math.abs(fast[i].potentialScore));
        if (Math.abs(slow[i].potentialScore - fast[i].potentialScore) > 1e-6 * scale) {
            // eslint-disable-next-line no-console
            console.error('[VERIFY_FAST_POTENTIAL] score divergence', {
                i, pieceId: slow[i].piece.id,
                slowScore: slow[i].potentialScore, fastScore: fast[i].potentialScore, ctx,
            });
        }
    }
}
```

Note: `fastPotential/potentialContext.ts` imports `baselineBreakdownCache` / `baselineStatsCache` from `potentialCalculator.ts`. These are top-level const Maps, already exported. No circular-import issue because the fast path only reads them at call time (not at module-load time). Confirm by building after this step.

- [ ] **Step 2: TypeScript compile check**

Run: `npm run build`.
Expected: no errors. All existing callers import `analyzePotentialUpgrades` as before and get the dispatch wrapper.

- [ ] **Step 3: Run the full test suite**

Run: `npm test -- --run`
Expected: all pass. The flag is `false` → production runs the slow path exactly as before. Equivalence tests call `fastAnalyzePotentialUpgrades` directly, so they bypass the flag.

- [ ] **Step 4: Manual smoke test — flag still off**

Run: `npm start`. Open the Gear page → Analyze. Run against your real inventory with a ship selected.
Expected: identical timing to current main (within noise); identical results. `[AnalyzeGear]` timers still print. No console errors.

- [ ] **Step 5: Manual smoke test — VERIFY_FAST_POTENTIAL on**

Locally edit `src/utils/gear/fastPotential/featureFlag.ts`:

```ts
export const VERIFY_FAST_POTENTIAL = true;
```

Save (hot reload). Run Analyze on the same ship.
Expected:
- Both paths run (roughly 2× the wall-clock time).
- No `[VERIFY_FAST_POTENTIAL]` errors in the console. If any appear, copy the full divergence record and investigate before flipping the flag.

**Revert `VERIFY_FAST_POTENTIAL = false` before committing.**

- [ ] **Step 6: Commit (Task 14 + 15 together)**

```bash
git add src/utils/gear/potentialCalculator.ts
git commit -m "feat(fast-potential): dispatch analyzePotentialUpgrades behind USE_FAST_POTENTIAL (default off)"
```

---

# Phase 5 — Flip the flag + cleanup

## Task 16: Capture pre-flip benchmark

**Why:** Establish the before number so the PR description has a concrete improvement figure.

- [ ] **Step 1: Run `npm start` in dev mode with the real inventory**

Sign in, ensure the 11,619-piece inventory is loaded.

- [ ] **Step 2: Run Analyze with a selected ship (the slow path)**

Pick the same ship you benchmarked the 82 s baseline on. Flag off (`USE_FAST_POTENTIAL = false`).

- [ ] **Step 3: Record `[AnalyzeGear]` timer output**

Copy the `[AnalyzeGear] role=...` per-role lines and `[AnalyzeGear] TOTAL ...` from the console.

- [ ] **Step 4: Run Analyze without a ship (the dummy path)**

Set the ship selector to "None", run Analyze. Record the timers.

- [ ] **Step 5: Paste into the PR description**

Format:

```
Pre-flip (USE_FAST_POTENTIAL=false)
- With ship: TOTAL XXms (X roles, inventory 11,619)
- Without ship: TOTAL XXms
```

No code change — this step exists only so the numbers are pinned before the flip.

---

## Task 17: Flip `USE_FAST_POTENTIAL` to true

**Files:**
- Modify: `src/utils/gear/fastPotential/featureFlag.ts`

- [ ] **Step 1: Confirm Phases 1–4 merged**

`git log` shows: primitive extraction, context/scorer/analyze, equivalence tests, dispatch wrapper. All tests green (`npm test -- --run`).

- [ ] **Step 2: Flip the flag**

```ts
export const USE_FAST_POTENTIAL = true;
```

Leave `VERIFY_FAST_POTENTIAL = false`.

- [ ] **Step 3: Run the full test suite**

Run: `npm test -- --run`
Expected: all pass. (Equivalence tests call the fast path directly; they don't exercise the dispatch. But nothing else should care.)

- [ ] **Step 4: Lint clean**

Run: `npm run lint`
Expected: 0 errors, 0 warnings (`--max-warnings=0`).

- [ ] **Step 5: Manual benchmark — with ship**

`npm start`. Same ship, same inventory. Run Analyze.
Expected timer output: TOTAL ~10–15 s (down from ~82 s).

- [ ] **Step 6: Manual benchmark — without ship**

Ship selector "None". Run Analyze.
Expected timer output: TOTAL ~1–1.5 s (down from ~4 s).

- [ ] **Step 7: Validate correctness**

Compare the Top-6 suggestions shown in the UI for each slot against the pre-flip suggestions captured in Task 16. They must match piece-for-piece. If any ordering changed, stop — diagnose with `VERIFY_FAST_POTENTIAL` before continuing.

- [ ] **Step 8: Commit the flip**

```bash
git add src/utils/gear/fastPotential/featureFlag.ts
git commit -m "feat(fast-potential): default USE_FAST_POTENTIAL to on"
```

---

## Task 18: Remove the `[AnalyzeGear]` console timers

**Why:** The temporary timers in `GearUpgradeAnalysis.tsx` served the benchmark phase. With the flag flipped and numbers captured, they become noise.

**Files:**
- Modify: `src/components/gear/GearUpgradeAnalysis.tsx`

- [ ] **Step 1: Remove the per-role timer**

In `GearUpgradeAnalysis.tsx`, remove:

```ts
const roleStart = performance.now();
```

and the matching:

```ts
// eslint-disable-next-line no-console
console.log(
    `[AnalyzeGear] role=${role} took ${(performance.now() - roleStart).toFixed(1)}ms`
);
```

- [ ] **Step 2: Remove the total timer**

Remove:

```ts
const analyzeStart = performance.now();
```

(at the top of `handleAnalyze`) and:

```ts
const analyzeTotal = performance.now() - analyzeStart;
// eslint-disable-next-line no-console
console.log(
    `[AnalyzeGear] TOTAL ${analyzeTotal.toFixed(1)}ms (${rolesToProcess.length} role(s), ship=${selectedShipId === 'none' ? 'none' : (selectedShip?.name ?? selectedShipId)}, rarity=${selectedRarity}, inventory=${inventory.length})`
);
```

- [ ] **Step 3: TypeScript compile check**

Run: `npm run build`.
Expected: no errors (no unused-variable warnings — `performance.now()` calls are gone together with their assignments).

- [ ] **Step 4: Manual smoke test**

Run: `npm start`. Open Gear → Analyze. Run it.
Expected: still completes in ~10–15 s (with ship) / ~1–1.5 s (without), no `[AnalyzeGear]` lines in the console, no regressions.

- [ ] **Step 5: Full test + lint**

Run: `npm test -- --run`
Run: `npm run lint`
Expected: all green, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/components/gear/GearUpgradeAnalysis.tsx
git commit -m "chore(gear-analysis): remove temporary [AnalyzeGear] console timers"
```

---

# Closeout

- [ ] **Step 1: Full test suite green**

Run: `npm test -- --run`
Expected: all tests pass, including the fastPotential unit + equivalence suites and the autogear fast-scoring regression suite under the moved shared primitives.

- [ ] **Step 2: Lint clean**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Build succeeds**

Run: `npm run build`
Expected: successful production build. Tree-shaking removes the `VERIFY_FAST_POTENTIAL` branch.

- [ ] **Step 4: One-line summary in the PR description**

"Gear Analyze wall-clock: with-ship XXs → YYs (Zx faster), without-ship AAs → BBs. Fast-potential path behind USE_FAST_POTENTIAL (default on). Slow path kept as `slowAnalyzePotentialUpgrades`; VERIFY_FAST_POTENTIAL dev diagnostic available. Shared primitives (`statVector`, `fastCache`) now live at `src/utils/fastScoring/`, consumed by autogear fast-scoring and fast-potential."
