# Autogear Fast-Path Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce autogear wall-clock runtime ~40–50% (670ms → ~350ms on the Salvation benchmark) by introducing a parallel fast-path scoring module used only by the Genetic Algorithm's inner loop, while leaving the public scoring API (`calculateTotalScore` / `calculateTotalStats`) untouched.

**Architecture:** Two-layer scoring. The public API is unchanged and continues to serve UI code. A new `src/utils/autogear/fastScoring/` module provides an equivalent computation on top of (1) a fixed-index `Float64Array` stat layout, (2) a per-run `GearRegistry` assigning integer IDs to inventory pieces with precomputed stat vectors, (3) a per-ship `shipPrefix` Float64Array (base + refits + engineering) computed once per run, and (4) an integer-keyed LRU cache. `GeneticStrategy` builds a `FastScoringContext` once at the start of each run and threads it through the inner loop. A `VERIFY_FAST_SCORING` dev-only runtime check and randomized equivalence tests guarantee correctness; a `USE_FAST_SCORING` feature flag enables instant rollback. The GA algorithm itself (selection, crossover, mutation, elitism) is unchanged.

**Tech Stack:** TypeScript 5, React 18, Vite, Vitest, Tailwind. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-19-autogear-fast-scoring-design.md](../specs/2026-04-19-autogear-fast-scoring-design.md)

**Baseline benchmark (Salvation, 773 pieces, 670.1ms):**
- `CalculateTotalStats` 191.4ms (46,547 calls)
- `Breeding` 141.1ms (26 generations)
- `CreateCacheKey` 65.9ms (64,800 calls)
- `CalculateSetCount` 39.8ms
- Cache hit rate: ~28% (18,253 hits / 64,800 calls)

---

## File Plan

**Created:**
- `src/utils/autogear/fastScoring/statVector.ts` — fixed-index Float64Array stat representation
- `src/utils/autogear/fastScoring/gearRegistry.ts` — per-run integer-ID registry for inventory pieces
- `src/utils/autogear/fastScoring/shipPrefix.ts` — per-ship precomputed base+refits+engineering vector
- `src/utils/autogear/fastScoring/fastCalculateStats.ts` — hot-loop stat pipeline replacement
- `src/utils/autogear/fastScoring/fastScore.ts` — equivalent of `calculateTotalScore`
- `src/utils/autogear/fastScoring/fastCache.ts` — integer-keyed LRU cache
- `src/utils/autogear/fastScoring/context.ts` — `buildFastScoringContext` bundling everything
- `src/utils/autogear/fastScoring/featureFlag.ts` — `USE_FAST_SCORING` / `VERIFY_FAST_SCORING` resolution
- `src/utils/autogear/fastScoring/__tests__/statVector.test.ts`
- `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts`
- `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts`
- `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts`
- `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts` — randomized fastScore vs calculateTotalScore
- `src/utils/autogear/fastScoring/__tests__/fixtures/testInventory.ts` — deterministic inventory generator
- `scripts/benchmark-autogear.ts` — offline benchmark harness

**Modified:**
- `src/utils/autogear/strategies/GeneticStrategy.ts` — pre-indexed inventory + fast-path wiring
- `src/utils/autogear/scoring.ts` — LRU eviction
- `src/utils/autogear/BaseStrategy.ts` — progress throttling

**Not touched (by design):**
- `src/utils/ship/statsCalculator.ts`
- `src/utils/autogear/priorityScore.ts` (apart from a possible re-export)
- All UI under `src/components/autogear/` and `src/pages/manager/AutogearPage.tsx`
- Every non-GA caller of `calculateTotalScore` / `calculateTotalStats`

---

## Tolerance policy for equivalence tests

Two different tolerance rules are used deliberately:

- **Score equality** — use relative tolerance `Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))`. Role-specific scores can reach 10^7+ for defenders; absolute `1e-9` is far below floating-point precision at that magnitude. A mixed relative/absolute form handles both small (~100) and large (~10^9) scores correctly.
- **Stat vector equality** — stats are bounded (HP ≤ ~10^6, speed ≤ ~10^3). Use absolute tolerance `1e-9` per index. Catches arithmetic bugs that a looser score tolerance might hide.

Helper `assertFloatsClose(a, b, { relative: true })` / `assertFloatsClose(a, b, { abs: 1e-9 })` lives in `equivalence.test.ts`.

---

## ⚠ Correctness invariants — read before implementing Phase 2

These three invariants are easy to get wrong and cause hard-to-debug divergence. Re-read `src/utils/ship/statsCalculator.ts` if anything below is unclear.

### Invariant 1: percentage-stat references differ by pipeline stage

`addStatModifier` in `statsCalculator.ts` takes a `baseStats` argument that it uses **only** when the stat is a flexible (non-percentage-only) stat applied with `type: 'percentage'`. The reference `baseStats` used in the slow path varies:

| Pipeline stage | Percentage reference | Slow-path line |
|---|---|---|
| Refits | `baseStats` (the ship's base) | statsCalculator.ts:46 |
| Engineering | `baseStats` | statsCalculator.ts:53 |
| Gear main + sub | `breakdown.afterEngineering` | statsCalculator.ts:76, 80 |
| Set bonuses | `breakdown.afterEngineering` | statsCalculator.ts:159 |
| Implant subs | `breakdown.afterEngineering` | statsCalculator.ts:97 |

Fast-path translation:

- `shipPrefix` = base + refits + engineering → compute using `ship.baseStats` as the percentage reference (matches slow path for refits and engineering). This lives in Task 8.
- Once `shipPrefix` is computed, it *is* the slow path's `afterEngineering`. Convert it once via `statVectorToBaseStats(shipPrefix)` → call the result `percentRef`.
- Pass `percentRef` (NOT `baseStats`) as the percentage reference to: `buildGearRegistry` (both gear and implant registries), and the set-bonus application inside `fastCalculateStats`.

Precomputed per-piece stat vectors in the registry are therefore only valid for the ship they were built for. That's fine — each GA run has exactly one ship and rebuilds its context.

### Invariant 2: ship implants when the GA is not optimizing them

The GA optimizes implants only when the filtered inventory contains implant pieces. When it doesn't, the slow path still applies `ship.implants` (the ship's currently-equipped implants) via `calculateTotalStats`'s `implants` argument.

Fast-path rule: the context captures `ship.implants` at build time and, when `optimizingImplants === false`, uses those fixed ids on every `fastScore` call. When `optimizingImplants === true`, the individual's `implantIds` drive implant selection and ship.implants is ignored.

### Invariant 3: damageReduction cap guard

Slow path (statsCalculator.ts:126):

```ts
if (breakdown.base.damageReduction && breakdown.final.damageReduction) { ... }
```

Both values must be truthy (non-zero, non-undefined). The fast path must use the same guard — a `> 0` check is close but semantically differs for `undefined` (which is treated as 0 by `||` but not by `&&` on a possibly-absent field).

---

# Phase 1 — Surgical wins (independent of fast path)

These land real gains (~100–150ms expected) with zero architectural change. Each task is its own commit. Phase 1 is independently shippable and should be merged before Phase 2 begins.

**Note on the "duplicated arena-modifier application" from the spec:** That duplication only manifests when hard requirements are active (two `calculateTotalStats` + `applyArenaModifiers` calls per fitness eval). Fixing it in-place in today's `GeneticStrategy.calculateFitness` requires an API change to `calculateTotalScore`. Instead of touching the slow path, Phase 2's `fastScore` eliminates the duplication structurally: when `hasHardRequirements`, it returns `finalStats` alongside `fitness` so the caller reuses them for violation without a second stat calculation. Phase 1 does NOT ship this fix. Expect it to land with Phase 2.

## Task 1: Pre-index inventory by slot in `GeneticStrategy`

**Why:** `GeneticStrategy.getPreferredGearForSlot` calls `inventory.filter((gear) => gear.slot === slot)` on every mutation. With ~15% mutation rate × ~6 slots × ~2400 individuals × 27 generations ≈ 58K `.filter()` calls per run, each allocating a fresh array. A one-time pre-index into `Map<GearSlotName, GearPiece[]>` replaces all of them with O(1) Map gets.

**Files:**
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`

- [ ] **Step 1: Add a type for the slot index**

In `GeneticStrategy.ts` near the top (after existing imports), add:

```ts
type InventoryBySlot = Map<GearSlotName, GearPiece[]>;
```

- [ ] **Step 2: Build the index once in `findOptimalGear`**

Inside `findOptimalGear`, immediately after `const cachedGetGearPiece = ...` block (around line 104), build the index and pass it through. Add:

```ts
const inventoryBySlot: InventoryBySlot = new Map();
for (const piece of availableInventory) {
    const existing = inventoryBySlot.get(piece.slot);
    if (existing) existing.push(piece);
    else inventoryBySlot.set(piece.slot, [piece]);
}
```

- [ ] **Step 3: Thread the index through signatures**

Update signatures so the index flows from `findOptimalGear` → `runSingleGAPass` → `initializePopulation` / `mutate` / `getPreferredGearForSlot`. All of these already receive `availableInventory`; add a new parameter `inventoryBySlot: InventoryBySlot` alongside it and pass it through at each call site.

- [ ] **Step 4: Replace `.filter(...)` in `getPreferredGearForSlot`**

Change the top of `getPreferredGearForSlot` from:

```ts
const availablePieces = inventory.filter((gear) => gear.slot === slot);
```

to:

```ts
const availablePieces = inventoryBySlot.get(slot) ?? EMPTY_PIECES;
```

Declare `const EMPTY_PIECES: GearPiece[] = [];` at module top (outside the class) to avoid per-call allocation of empty arrays.

- [ ] **Step 5: Run existing GA tests**

Run: `npm test -- src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts --run`
Expected: all pass — the refactor is behaviour-preserving.

- [ ] **Step 6: Run full test suite**

Run: `npm test -- --run`
Expected: 167 passed. No new tests yet; we're only verifying nothing regressed.

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/strategies/GeneticStrategy.ts
git commit -m "perf(autogear): pre-index inventory by slot to eliminate per-mutation filter()"
```

---

## Task 2: LRU eviction in score cache

**Why:** `scoring.ts` clears the entire `scoreCache` when it hits `CACHE_SIZE_LIMIT` (50K). For typical runs this never triggers, but for large inventories or batched runs the full-clear creates a cold spike mid-optimization. LRU eviction (drop oldest) keeps the cache hot.

**Files:**
- Modify: `src/utils/autogear/scoring.ts:248-256`

- [ ] **Step 1: Write failing test**

Add to `src/utils/autogear/__tests__/scoring.test.ts`:

```ts
import { calculateTotalScore, clearScoreCache } from '../scoring';
// ... existing imports

describe('scoring cache LRU eviction', () => {
    it('evicts oldest entry when cache fills, not the entire cache', () => {
        // Private cache isn't directly exported; test the observable behavior:
        // rapid-fire unique equipment keys should NOT all miss the cache
        // after filling past CACHE_SIZE_LIMIT. The first entries are evicted,
        // recent entries remain cached.
        //
        // Smoke-test: with a small CACHE_SIZE_LIMIT override via a helper,
        // verify ENTRY_N+1 inserted after fill still has access to ENTRY_N.
        //
        // If cache internals are not exposed, SKIP this assertion and rely
        // on the unit test below for the eviction helper itself.
    });
});
```

If the private cache can't be observed from tests, **skip this test and instead unit-test a new helper**. Proceed to Step 2.

- [ ] **Step 2: Extract the eviction logic into a pure helper (testable)**

In `scoring.ts`, just above the existing cache declarations, add:

```ts
// Exported for testing only.
export function evictOldestIfFull<K, V>(
    cache: Map<K, V>,
    limit: number,
    onEvict?: (key: K) => void
): void {
    if (cache.size < limit) return;
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
        cache.delete(oldestKey);
        onEvict?.(oldestKey);
    }
}
```

- [ ] **Step 3: Write a test for `evictOldestIfFull`**

Append to `src/utils/autogear/__tests__/scoring.test.ts`:

```ts
import { evictOldestIfFull } from '../scoring';

describe('evictOldestIfFull', () => {
    it('does nothing when size < limit', () => {
        const m = new Map<string, number>([['a', 1]]);
        evictOldestIfFull(m, 2);
        expect(m.size).toBe(1);
    });

    it('evicts the oldest entry when size === limit', () => {
        const m = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);
        evictOldestIfFull(m, 3);
        expect(m.has('a')).toBe(false);
        expect(m.has('b')).toBe(true);
        expect(m.has('c')).toBe(true);
    });

    it('calls onEvict with the evicted key', () => {
        const m = new Map([['a', 1], ['b', 2]]);
        const evicted: string[] = [];
        evictOldestIfFull(m, 2, (k) => evicted.push(k));
        expect(evicted).toEqual(['a']);
    });
});
```

Run: `npm test -- src/utils/autogear/__tests__/scoring.test.ts --run`
Expected: new tests fail until Step 2 is committed to the same branch (they should actually pass — Step 2 adds the helper; this is a guard test).

- [ ] **Step 4: Replace the full-clear logic**

In `scoring.ts`, find the `CacheResult` block (around line 249):

```ts
if (scoreCache.size >= CACHE_SIZE_LIMIT) {
    scoreCache.clear();
    equipmentKeyCache.clear();
}
scoreCache.set(cacheKey, score);
```

Replace with:

```ts
evictOldestIfFull(scoreCache, CACHE_SIZE_LIMIT);
scoreCache.set(cacheKey, score);
```

Note: we intentionally drop the `equipmentKeyCache.clear()` that was paired with the full clear. The equipment key cache has its own size cap (10000) enforced at insertion time (line 158) — no action needed when the score cache evicts.

- [ ] **Step 5: Run tests**

Run: `npm test -- --run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/autogear/scoring.ts src/utils/autogear/__tests__/scoring.test.ts
git commit -m "perf(autogear): LRU eviction on score cache overflow"
```

---

## Task 3: Throttle progress callbacks in `BaseStrategy`

**Why:** `incrementProgress` fires the callback on every single operation. In a 64,800-op run, that's 64,800 React re-renders if the callback sets state. The cost is mostly on the UI side (invisible in `performanceTimer`), but it's real. Throttling to at most once per ~16ms and at least once every N ops caps the callback rate.

**Files:**
- Modify: `src/utils/autogear/BaseStrategy.ts:36-59`

- [ ] **Step 1: Add throttle state**

In `BaseStrategy.ts`, add protected fields:

```ts
protected lastProgressEmitTime: number = 0;
protected readonly PROGRESS_THROTTLE_MS = 16; // ~60fps cap
```

- [ ] **Step 2: Throttle `updateProgress`**

Replace the existing `updateProgress` method with:

```ts
protected updateProgress(force: boolean = false) {
    if (!this.progressCallback || this.totalOperations <= 0) return;
    const now = performance.now();
    if (!force && now - this.lastProgressEmitTime < this.PROGRESS_THROTTLE_MS) return;
    this.lastProgressEmitTime = now;

    const current = Math.min(this.currentOperation, this.totalOperations);
    const percentage = Math.round((current / this.totalOperations) * 100);
    this.progressCallback({
        current,
        total: this.totalOperations,
        percentage,
        attempt: this.currentAttempt,
        maxAttempts: this.maxAttempts,
    });
}
```

- [ ] **Step 3: Force emit on initialize/complete**

Update:

```ts
protected initializeProgress(total: number) {
    this.totalOperations = total;
    this.currentOperation = 0;
    this.lastProgressEmitTime = 0;
    this.updateProgress(true); // force
}

protected completeProgress() {
    if (this.progressCallback) {
        this.currentOperation = this.totalOperations;
        this.lastProgressEmitTime = 0;
        this.progressCallback({
            current: this.totalOperations,
            total: this.totalOperations,
            percentage: 100,
        });
    }
}
```

(`incrementProgress` stays as-is — it calls `updateProgress()` without the force flag, so it's naturally throttled.)

- [ ] **Step 4: Manual smoke test**

Run `npm start`, open the app, run autogear on any ship, and confirm:
- Progress bar still animates smoothly (not stuck).
- Progress reaches 100% at completion.
- No visual regression.

- [ ] **Step 5: Run full test suite**

Run: `npm test -- --run`
Expected: 167 passed.

- [ ] **Step 6: Commit**

```bash
git add src/utils/autogear/BaseStrategy.ts
git commit -m "perf(autogear): throttle progress callbacks to ~60fps"
```

---

## Task 4: Capture Phase 1 benchmark

**Why:** Establish baseline-vs-Phase-1 numbers so Phase 2 can be measured against a concrete reference point.

**Files:** (no code changes — this is a measurement task)

- [ ] **Step 1: Run the app in dev mode**

Run: `npm start`. Open in browser. Sign in / import data for a realistic inventory.

- [ ] **Step 2: Run autogear on a representative ship**

Pick the same ship used for the spec's baseline (Salvation, 773 pieces) or the closest available. Run autogear with the default Genetic strategy.

- [ ] **Step 3: Record the `performanceTimer` summary**

Open DevTools → Console. Copy the `🚀 Autogear Performance Summary` block.

- [ ] **Step 4: Paste into a Phase 1 results note**

Paste into the PR description or a scratch file. Format:

```
Phase 1 baseline (Salvation, 773 pieces)
Total: XXXms (was 670ms)
CalculateTotalStats: XXXms
Breeding: XXXms
CreateCacheKey: XXXms
Cache hits: XXX
```

Not committed — this is for the PR description and plan notes only.

---

# Phase 2 — Fast-scoring module (no production call sites yet)

Phase 2 builds the fast-path module in isolation. Every module is unit-tested against the existing slow path before the module graduates. Nothing in the production code path changes — `GeneticStrategy` still uses `calculateTotalScore`.

Phase 2 is mergeable on its own (dead code is harmless).

## Task 5: Lock the stat vector layout

**Why:** Every fast-scoring module (`gearRegistry`, `shipPrefix`, `fastCalculateStats`) must agree on stat indices. Lock this first, before any consumer is written — per spec reviewer recommendation #1.

**Files:**
- Create: `src/utils/autogear/fastScoring/statVector.ts`
- Create: `src/utils/autogear/fastScoring/__tests__/statVector.test.ts`

- [ ] **Step 1: Enumerate stats from `src/types/stats.ts`**

The stat set is the union of `FlexibleStats` and `PercentageOnlyStats`. Full list from `src/types/stats.ts`:

- Flexible (6): `hp`, `attack`, `defence`, `speed`, `hacking`, `security`
- Percentage-only (8): `crit`, `critDamage`, `healModifier`, `shield`, `hpRegen`, `defensePenetration`, `shieldPenetration`, `damageReduction`

Total: 14 stats. All 14 live in `BaseStats`. We'll use a single-block layout (no separate flat/percent sub-blocks) because `BaseStats` itself conflates them — this matches the existing code's treatment.

- [ ] **Step 2: Write `statVector.ts`**

Create `src/utils/autogear/fastScoring/statVector.ts`:

```ts
import type { BaseStats, StatName } from '../../../types/stats';

/**
 * Fixed-index Float64Array stat layout used by the autogear fast-scoring hot loop.
 * Order is frozen — modules consuming StatVectors rely on this exact index map.
 * Additions go at the end to preserve existing indices.
 */
export const STAT_INDEX: Record<StatName, number> = {
    hp: 0,
    attack: 1,
    defence: 2,
    speed: 3,
    hacking: 4,
    security: 5,
    crit: 6,
    critDamage: 7,
    healModifier: 8,
    shield: 9,
    hpRegen: 10,
    defensePenetration: 11,
    shieldPenetration: 12,
    damageReduction: 13,
};

export const STAT_COUNT = 14;

export type StatVector = Float64Array;

export function createStatVector(): StatVector {
    return new Float64Array(STAT_COUNT);
}

export function copyStatVector(src: StatVector, dst: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) dst[i] = src[i];
}

export function addStatVector(target: StatVector, addend: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) target[i] += addend[i];
}

export function zeroStatVector(target: StatVector): void {
    for (let i = 0; i < STAT_COUNT; i++) target[i] = 0;
}

/**
 * Convert a StatVector back to a BaseStats object. Used for:
 * - Passing to the existing calculatePriorityScore (which takes BaseStats)
 * - Equivalence testing against calculateTotalStats
 */
export function statVectorToBaseStats(v: StatVector): BaseStats {
    return {
        hp: v[STAT_INDEX.hp],
        attack: v[STAT_INDEX.attack],
        defence: v[STAT_INDEX.defence],
        speed: v[STAT_INDEX.speed],
        hacking: v[STAT_INDEX.hacking],
        security: v[STAT_INDEX.security],
        crit: v[STAT_INDEX.crit],
        critDamage: v[STAT_INDEX.critDamage],
        healModifier: v[STAT_INDEX.healModifier],
        shield: v[STAT_INDEX.shield],
        hpRegen: v[STAT_INDEX.hpRegen],
        defensePenetration: v[STAT_INDEX.defensePenetration],
        shieldPenetration: v[STAT_INDEX.shieldPenetration],
        damageReduction: v[STAT_INDEX.damageReduction],
    };
}

/**
 * Inverse of statVectorToBaseStats. Missing BaseStats fields default to 0.
 */
export function baseStatsToStatVector(s: BaseStats, target?: StatVector): StatVector {
    const v = target ?? createStatVector();
    v[STAT_INDEX.hp] = s.hp ?? 0;
    v[STAT_INDEX.attack] = s.attack ?? 0;
    v[STAT_INDEX.defence] = s.defence ?? 0;
    v[STAT_INDEX.speed] = s.speed ?? 0;
    v[STAT_INDEX.hacking] = s.hacking ?? 0;
    v[STAT_INDEX.security] = s.security ?? 0;
    v[STAT_INDEX.crit] = s.crit ?? 0;
    v[STAT_INDEX.critDamage] = s.critDamage ?? 0;
    v[STAT_INDEX.healModifier] = s.healModifier ?? 0;
    v[STAT_INDEX.shield] = s.shield ?? 0;
    v[STAT_INDEX.hpRegen] = s.hpRegen ?? 0;
    v[STAT_INDEX.defensePenetration] = s.defensePenetration ?? 0;
    v[STAT_INDEX.shieldPenetration] = s.shieldPenetration ?? 0;
    v[STAT_INDEX.damageReduction] = s.damageReduction ?? 0;
    return v;
}
```

- [ ] **Step 3: Write `statVector.test.ts`**

Create `src/utils/autogear/fastScoring/__tests__/statVector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    STAT_INDEX,
    STAT_COUNT,
    createStatVector,
    copyStatVector,
    addStatVector,
    zeroStatVector,
    baseStatsToStatVector,
    statVectorToBaseStats,
} from '../statVector';
import type { BaseStats } from '../../../../types/stats';

describe('statVector layout', () => {
    it('exposes one index per stat name without collisions', () => {
        const indices = Object.values(STAT_INDEX);
        expect(indices.length).toBe(STAT_COUNT);
        expect(new Set(indices).size).toBe(STAT_COUNT);
        for (const idx of indices) {
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(STAT_COUNT);
        }
    });

    it('covers every stat in BaseStats', () => {
        const expected = [
            'hp', 'attack', 'defence', 'speed', 'hacking', 'security',
            'crit', 'critDamage', 'healModifier', 'shield', 'hpRegen',
            'defensePenetration', 'shieldPenetration', 'damageReduction',
        ];
        expect(Object.keys(STAT_INDEX).sort()).toEqual(expected.sort());
    });
});

describe('statVector helpers', () => {
    it('createStatVector returns zeroed vector of correct length', () => {
        const v = createStatVector();
        expect(v.length).toBe(STAT_COUNT);
        expect(Array.from(v)).toEqual(new Array(STAT_COUNT).fill(0));
    });

    it('copyStatVector copies all elements', () => {
        const src = createStatVector();
        src[0] = 1; src[5] = 5; src[13] = 13;
        const dst = createStatVector();
        copyStatVector(src, dst);
        expect(Array.from(dst)).toEqual(Array.from(src));
    });

    it('addStatVector adds component-wise in place', () => {
        const a = createStatVector(); a[0] = 10; a[1] = 20;
        const b = createStatVector(); b[0] = 5; b[1] = 7;
        addStatVector(a, b);
        expect(a[0]).toBe(15);
        expect(a[1]).toBe(27);
    });

    it('zeroStatVector resets in place', () => {
        const v = createStatVector(); v[2] = 99; v[7] = -3;
        zeroStatVector(v);
        expect(Array.from(v)).toEqual(new Array(STAT_COUNT).fill(0));
    });
});

describe('BaseStats <-> StatVector round-trip', () => {
    it('round-trips a full BaseStats object', () => {
        const s: BaseStats = {
            hp: 50000, attack: 10000, defence: 8000, speed: 300,
            hacking: 5000, security: 3000, crit: 50, critDamage: 150,
            healModifier: 0, hpRegen: 0, shield: 0, damageReduction: 0,
            defensePenetration: 0,
        };
        const v = baseStatsToStatVector(s);
        const back = statVectorToBaseStats(v);
        expect(back.hp).toBe(s.hp);
        expect(back.attack).toBe(s.attack);
        expect(back.defence).toBe(s.defence);
        expect(back.speed).toBe(s.speed);
        expect(back.hacking).toBe(s.hacking);
        expect(back.security).toBe(s.security);
        expect(back.crit).toBe(s.crit);
        expect(back.critDamage).toBe(s.critDamage);
    });

    it('treats missing optional fields as 0', () => {
        const s: BaseStats = {
            hp: 1, attack: 1, defence: 1, speed: 1,
            hacking: 1, security: 1, crit: 1, critDamage: 1,
        };
        const v = baseStatsToStatVector(s);
        const back = statVectorToBaseStats(v);
        expect(back.healModifier).toBe(0);
        expect(back.hpRegen).toBe(0);
        expect(back.shield).toBe(0);
    });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/statVector.test.ts --run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/fastScoring/statVector.ts src/utils/autogear/fastScoring/__tests__/statVector.test.ts
git commit -m "feat(autogear-fast): lock stat vector layout + helpers"
```

---

## Task 6: Build a test inventory fixture

**Why:** The next several tasks all need a realistic inventory + ship + engineering stats. Build a deterministic, seeded generator once and reuse it.

**Files:**
- Create: `src/utils/autogear/fastScoring/__tests__/fixtures/testInventory.ts`

- [ ] **Step 1: Write the fixture generator**

Create `src/utils/autogear/fastScoring/__tests__/fixtures/testInventory.ts`:

```ts
import type { Ship, Refit } from '../../../../../types/ship';
import type { GearPiece } from '../../../../../types/gear';
import type { BaseStats, EngineeringStat } from '../../../../../types/stats';
import { GEAR_SLOTS } from '../../../../../constants';

/**
 * Tiny deterministic PRNG (mulberry32). Seeded RNG used so tests are reproducible.
 */
export function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s += 0x6D2B79F5;
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

export function makeTestEngineering(): EngineeringStat {
    return {
        shipType: 'ATTACKER',
        stats: [
            { name: 'attack', value: 500, type: 'flat' },
            { name: 'hp', value: 5, type: 'percentage' },
        ],
    };
}

/**
 * Generate a small inventory (default 18 pieces) that covers:
 * - all 6 gear slots
 * - several set bonuses, each with enough pieces to hit 2/4 thresholds
 * - a mix of flat and percentage main stats
 *
 * Deterministic given the same seed.
 */
export function generateTestInventory(seed = 1, count = 18): GearPiece[] {
    const rnd = seededRandom(seed);
    const slots = Object.keys(GEAR_SLOTS) as (keyof typeof GEAR_SLOTS)[];
    const pieces: GearPiece[] = [];

    for (let i = 0; i < count; i++) {
        const slot = slots[i % slots.length];
        const setBonus = TEST_SET_BONUSES[i % TEST_SET_BONUSES.length];
        const id = `gear-${i}`;
        const mainStatFlat = rnd() < 0.5;
        pieces.push({
            id,
            slot,
            setBonus,
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: mainStatFlat
                ? { name: 'attack', value: 500 + Math.floor(rnd() * 200), type: 'flat' }
                : { name: 'attack', value: 5 + Math.floor(rnd() * 10), type: 'percentage' },
            subStats: [
                { name: 'hp', value: 1000 + Math.floor(rnd() * 500), type: 'flat' },
                { name: 'crit', value: 3 + Math.floor(rnd() * 5), type: 'percentage' },
            ],
        } as GearPiece);
    }
    return pieces;
}
```

- [ ] **Step 2: Smoke-test the fixture**

Append to `src/utils/autogear/fastScoring/__tests__/statVector.test.ts` (to keep a single fixture sanity check near existing tests; we don't need a separate file):

```ts
import {
    generateTestInventory,
    makeTestShip,
    seededRandom,
} from './fixtures/testInventory';

describe('test fixture sanity', () => {
    it('generates deterministic inventory given the same seed', () => {
        const a = generateTestInventory(42, 10);
        const b = generateTestInventory(42, 10);
        expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    });

    it('seededRandom(1) is deterministic', () => {
        const r1 = seededRandom(1);
        const r2 = seededRandom(1);
        for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
    });

    it('makeTestShip returns a valid Ship', () => {
        const ship = makeTestShip();
        expect(ship.id).toBeTruthy();
        expect(ship.baseStats.hp).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/statVector.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/autogear/fastScoring/__tests__/fixtures/testInventory.ts src/utils/autogear/fastScoring/__tests__/statVector.test.ts
git commit -m "test(autogear-fast): add seeded inventory/ship fixture generator"
```

---

## Task 7: Implement `gearRegistry.ts`

**Why:** Assigning integer IDs to pieces at context-build time lets the hot loop key caches by integer and fetch stat contributions by array offset. Includes per-piece precomputed stat vectors so `fastCalculateStats` never re-reads piece sub-stats.

**Files:**
- Create: `src/utils/autogear/fastScoring/gearRegistry.ts`
- Create: `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts`

- [ ] **Step 1: Write the module**

Create `src/utils/autogear/fastScoring/gearRegistry.ts`:

```ts
import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants';
import type { BaseStats, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { STAT_INDEX, STAT_COUNT, createStatVector, type StatVector } from './statVector';

export interface GearRegistry {
    /** piece.id (string) -> integer id in [0, N) */
    readonly idOf: Map<string, number>;
    /** int id -> original piece reference */
    readonly pieces: readonly GearPiece[];
    /** flat buffer: N * STAT_COUNT. Piece `i`'s vector is [i*STAT_COUNT, (i+1)*STAT_COUNT). */
    readonly statBuffer: Float64Array;
    /** int id -> integer set bonus id, 0 = none */
    readonly setIds: Uint8Array;
    /** int id -> slot id (0..slotCount-1) */
    readonly slotIds: Uint8Array;
    /** set name -> integer set id (1-indexed; 0 reserved for "none") */
    readonly setNameToId: Map<string, number>;
    /** integer set id -> set name */
    readonly setIdToName: readonly string[];
    /** slot name -> integer slot id */
    readonly slotNameToId: Map<GearSlotName, number>;
    /** integer slot id -> slot name */
    readonly slotIdToName: readonly GearSlotName[];
}

/**
 * Build a registry for the pre-filtered inventory of a single run. Piece stats
 * (main + sub, NOT counting set bonuses or calibration — those are applied later
 * in the pipeline) are precomputed into statBuffer as Float64 contributions.
 *
 * `percentRef` is the reference used for percentage-typed flexible stats. For
 * gear/implant pieces this MUST be the "afterEngineering" stats (i.e. the
 * ship's baseStats with refits+engineering applied), NOT the raw baseStats.
 * See Invariant 1 in the plan preamble.
 *
 * This function mirrors the "piece contributes to afterGear" portion of
 * calculateTotalStats. Keep in sync when that pipeline changes.
 */
export function buildGearRegistry(
    inventory: readonly GearPiece[],
    percentRef: BaseStats
): GearRegistry {
    const pieces = [...inventory];
    const idOf = new Map<string, number>();
    const statBuffer = new Float64Array(pieces.length * STAT_COUNT);
    const setIds = new Uint8Array(pieces.length);
    const slotIds = new Uint8Array(pieces.length);

    const setNameToId = new Map<string, number>();
    const setIdToName: string[] = ['']; // 0 = none
    const slotNameToId = new Map<GearSlotName, number>();
    const slotIdToName: GearSlotName[] = [];

    const tmp = createStatVector();

    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        idOf.set(piece.id, i);

        // Slot id
        let slotId = slotNameToId.get(piece.slot);
        if (slotId === undefined) {
            slotId = slotIdToName.length;
            slotNameToId.set(piece.slot, slotId);
            slotIdToName.push(piece.slot);
        }
        slotIds[i] = slotId;

        // Set id
        if (piece.setBonus) {
            let setId = setNameToId.get(piece.setBonus);
            if (setId === undefined) {
                setId = setIdToName.length; // next integer
                setNameToId.set(piece.setBonus, setId);
                setIdToName.push(piece.setBonus);
            }
            setIds[i] = setId;
        } else {
            setIds[i] = 0;
        }

        // Compute stat contribution (main + subs) into tmp, then copy into buffer.
        // This replicates addStatModifier from statsCalculator for a single piece,
        // using percentRef (= afterEngineering) as the percentage reference.
        for (let k = 0; k < STAT_COUNT; k++) tmp[k] = 0;
        applyPieceStat(piece.mainStat, tmp, percentRef);
        if (piece.subStats) {
            for (const s of piece.subStats) applyPieceStat(s, tmp, percentRef);
        }
        const base = i * STAT_COUNT;
        for (let k = 0; k < STAT_COUNT; k++) statBuffer[base + k] = tmp[k];
    }

    return {
        idOf,
        pieces,
        statBuffer,
        setIds,
        slotIds,
        setNameToId,
        setIdToName,
        slotNameToId,
        slotIdToName,
    };
}

function applyPieceStat(
    stat: Stat | undefined | null,
    target: StatVector,
    percentRef: BaseStats
): void {
    if (!stat) return;
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;

    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const refValue = (percentRef as any)[stat.name] ?? 0;
        target[idx] += refValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}

/**
 * Copy piece `pieceId`'s precomputed stat vector into `target` additively.
 * Used in the hot loop.
 */
export function addPieceStatsInto(
    registry: GearRegistry,
    pieceId: number,
    target: StatVector
): void {
    const base = pieceId * STAT_COUNT;
    for (let k = 0; k < STAT_COUNT; k++) target[k] += registry.statBuffer[base + k];
}
```

- [ ] **Step 2: Write tests**

Create `src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGearRegistry, addPieceStatsInto } from '../gearRegistry';
import { createStatVector, STAT_INDEX, STAT_COUNT } from '../statVector';
import { generateTestInventory, TEST_BASE_STATS } from './fixtures/testInventory';

// For these unit tests percentRef = TEST_BASE_STATS is fine (no engineering).
// The real usage passes `statVectorToBaseStats(shipPrefix)` instead.
describe('buildGearRegistry', () => {
    it('assigns unique integer ids for every piece', () => {
        const inventory = generateTestInventory(1, 12);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS);
        const ids = new Set<number>();
        for (const p of inventory) ids.add(reg.idOf.get(p.id)!);
        expect(ids.size).toBe(inventory.length);
    });

    it('allocates statBuffer of size N * STAT_COUNT', () => {
        const inventory = generateTestInventory(2, 7);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS);
        expect(reg.statBuffer.length).toBe(7 * STAT_COUNT);
    });

    it('maps set bonuses to consecutive positive ids (0 reserved)', () => {
        const inventory = generateTestInventory(3, 8);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS);
        for (const [name, id] of reg.setNameToId) {
            expect(id).toBeGreaterThan(0);
            expect(reg.setIdToName[id]).toBe(name);
        }
    });

    it('precomputes stat contribution: flat + percentage + substats', () => {
        const inventory = generateTestInventory(4, 3);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS);
        for (let i = 0; i < inventory.length; i++) {
            const piece = inventory[i];
            const base = i * STAT_COUNT;
            // Recompute expected manually from the fixture's main+sub stats
            // Attack flat adds value directly; attack percentage adds baseStats.attack * v/100
            // Sub stats always contribute (hp flat, crit percent-only)
            let expectedAttack = 0;
            if (piece.mainStat?.name === 'attack') {
                if (piece.mainStat.type === 'flat') {
                    expectedAttack += piece.mainStat.value;
                } else {
                    expectedAttack += TEST_BASE_STATS.attack * (piece.mainStat.value / 100);
                }
            }
            expect(reg.statBuffer[base + STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
        }
    });
});

describe('addPieceStatsInto', () => {
    it('adds a piece vector into target component-wise', () => {
        const inventory = generateTestInventory(5, 2);
        const reg = buildGearRegistry(inventory, TEST_BASE_STATS);
        const target = createStatVector();
        addPieceStatsInto(reg, 0, target);
        // Adding twice should be double the single contribution.
        const first = target[STAT_INDEX.attack];
        addPieceStatsInto(reg, 0, target);
        expect(target[STAT_INDEX.attack]).toBeCloseTo(first * 2, 9);
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/autogear/fastScoring/gearRegistry.ts src/utils/autogear/fastScoring/__tests__/gearRegistry.test.ts
git commit -m "feat(autogear-fast): gearRegistry with precomputed stat vectors"
```

---

## Task 8: Implement `shipPrefix.ts`

**Why:** Base + refits + engineering stats are constant for a ship across an entire run. Collapse them into one `Float64Array` at context-build time.

**Files:**
- Create: `src/utils/autogear/fastScoring/shipPrefix.ts`
- Create: `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts`

- [ ] **Step 1: Write the module**

Create `src/utils/autogear/fastScoring/shipPrefix.ts`:

```ts
import type { Ship } from '../../../types/ship';
import type { BaseStats, EngineeringStat, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import {
    STAT_INDEX,
    STAT_COUNT,
    createStatVector,
    baseStatsToStatVector,
    type StatVector,
} from './statVector';

/**
 * Compute the per-ship "constant prefix" (base + refits + engineering) as a
 * Float64Array. This is added to the per-individual gear/implant contributions
 * inside the hot loop.
 *
 * Mirrors the base -> afterRefits -> afterEngineering portion of
 * calculateTotalStats. Keep in sync.
 */
export function computeShipPrefix(
    ship: Ship,
    engineeringStats: EngineeringStat | undefined
): StatVector {
    const prefix = baseStatsToStatVector(ship.baseStats);

    // Refits: apply each stat against the current base stats (the slow path
    // does the same — afterRefits starts from baseStats).
    if (ship.refits) {
        for (const refit of ship.refits) {
            if (!refit.stats) continue;
            for (const stat of refit.stats) applyStat(stat, prefix, ship.baseStats);
        }
    }

    // Engineering: applied against the same baseStats (afterEngineering starts
    // from afterRefits, but percentage stats use baseStats — this matches
    // calculateTotalStats passing `baseStats` as the third arg to addStatModifier).
    if (engineeringStats?.stats) {
        for (const stat of engineeringStats.stats) applyStat(stat, prefix, ship.baseStats);
    }

    return prefix;
}

function applyStat(stat: Stat, target: StatVector, baseStats: BaseStats): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const baseValue = (baseStats as any)[stat.name] ?? 0;
        target[idx] += baseValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}
```

- [ ] **Step 2: Write tests**

Create `src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeShipPrefix } from '../shipPrefix';
import { statVectorToBaseStats, STAT_INDEX } from '../statVector';
import { calculateTotalStats } from '../../../ship/statsCalculator';
import { makeTestShip, makeTestEngineering, TEST_BASE_STATS } from './fixtures/testInventory';

describe('computeShipPrefix', () => {
    it('matches calculateTotalStats afterEngineering with no refits or engineering', () => {
        const ship = makeTestShip();
        const prefix = computeShipPrefix(ship, undefined);
        const slow = calculateTotalStats(
            ship.baseStats,
            {},
            () => undefined,
            [],
            {},
            undefined,
            ship.id
        );
        expect(prefix[STAT_INDEX.hp]).toBeCloseTo(slow.afterEngineering.hp, 9);
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(slow.afterEngineering.attack, 9);
    });

    it('applies refits additively on top of base stats', () => {
        const ship = makeTestShip({
            refits: [
                { stats: [{ name: 'attack', value: 1000, type: 'flat' }] },
                { stats: [{ name: 'attack', value: 10, type: 'percentage' }] }, // +10% of base attack
            ] as any,
        });
        const prefix = computeShipPrefix(ship, undefined);
        const expectedAttack =
            TEST_BASE_STATS.attack + 1000 + TEST_BASE_STATS.attack * 0.1;
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
    });

    it('applies engineering stats on top of base+refits', () => {
        const ship = makeTestShip();
        const eng = makeTestEngineering(); // +500 attack flat, +5% hp
        const prefix = computeShipPrefix(ship, eng);
        const expectedAttack = TEST_BASE_STATS.attack + 500;
        const expectedHp = TEST_BASE_STATS.hp + TEST_BASE_STATS.hp * 0.05;
        expect(prefix[STAT_INDEX.attack]).toBeCloseTo(expectedAttack, 9);
        expect(prefix[STAT_INDEX.hp]).toBeCloseTo(expectedHp, 9);
    });

    it('full parity with calculateTotalStats.afterEngineering for every stat', () => {
        const ship = makeTestShip({
            refits: [
                { stats: [{ name: 'attack', value: 500, type: 'flat' }] },
            ] as any,
        });
        const eng = makeTestEngineering();
        const prefix = computeShipPrefix(ship, eng);
        const slow = calculateTotalStats(
            ship.baseStats,
            {},
            () => undefined,
            ship.refits,
            {},
            eng,
            ship.id
        );
        const asBase = statVectorToBaseStats(prefix);
        for (const key of [
            'hp', 'attack', 'defence', 'speed', 'hacking', 'security',
            'crit', 'critDamage',
        ] as const) {
            expect(asBase[key]).toBeCloseTo(slow.afterEngineering[key] ?? 0, 9);
        }
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts --run`
Expected: all pass. If failures surface subtle differences from `calculateTotalStats`, fix the prefix rather than the expectation — slow path is ground truth.

- [ ] **Step 4: Commit**

```bash
git add src/utils/autogear/fastScoring/shipPrefix.ts src/utils/autogear/fastScoring/__tests__/shipPrefix.test.ts
git commit -m "feat(autogear-fast): per-ship precomputed base+refits+engineering prefix"
```

---

## Task 9: Implement `fastCache.ts`

**Why:** Integer-keyed LRU cache replacing the current string-concatenation cache key. Simpler, faster, independent of the rest of the module.

**Files:**
- Create: `src/utils/autogear/fastScoring/fastCache.ts`
- Create: `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts`

- [ ] **Step 1: Write the module**

Create `src/utils/autogear/fastScoring/fastCache.ts`:

```ts
/**
 * Tiny LRU cache keyed by string (stringified integer tuple). Map insertion
 * order in JS is LRU-friendly: on hit we delete+reinsert; on overflow we
 * delete the oldest (first) key.
 *
 * We use string keys not BigInt for predictable performance across JS engines.
 * The key is a fixed-length delimited string of small integers, much cheaper
 * than the existing `Object.entries().sort().join()` approach.
 */
export class FastCache<V> {
    private readonly store = new Map<string, V>();
    constructor(private readonly limit: number) {}

    get(key: string): V | undefined {
        const v = this.store.get(key);
        if (v === undefined) return undefined;
        // Mark as most recently used
        this.store.delete(key);
        this.store.set(key, v);
        return v;
    }

    set(key: string, value: V): void {
        if (this.store.has(key)) {
            this.store.delete(key);
        } else if (this.store.size >= this.limit) {
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, value);
    }

    get size(): number {
        return this.store.size;
    }

    clear(): void {
        this.store.clear();
    }
}

/**
 * Build a fast cache key from a list of integer ids.
 *
 * Layout: "${id0},${id1},...,${idN}". Empty slots use -1.
 *
 * This is faster than the existing CreateCacheKey because:
 * - No Object.entries() allocation
 * - No Array.sort()
 * - No two-pass string building
 * - Tiny, known-size number->string conversions
 */
export function buildFastCacheKey(ids: readonly number[]): string {
    // Short loop; direct concatenation beats Array.join for small fixed sizes.
    let out = '';
    for (let i = 0; i < ids.length; i++) {
        if (i > 0) out += ',';
        out += ids[i];
    }
    return out;
}
```

- [ ] **Step 2: Write tests**

Create `src/utils/autogear/fastScoring/__tests__/fastCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FastCache, buildFastCacheKey } from '../fastCache';

describe('FastCache (LRU)', () => {
    it('stores and retrieves values', () => {
        const c = new FastCache<number>(3);
        c.set('a', 1);
        c.set('b', 2);
        expect(c.get('a')).toBe(1);
        expect(c.get('b')).toBe(2);
    });

    it('returns undefined for missing keys', () => {
        const c = new FastCache<number>(3);
        expect(c.get('nope')).toBeUndefined();
    });

    it('evicts the least-recently-used entry when full', () => {
        const c = new FastCache<number>(2);
        c.set('a', 1);
        c.set('b', 2);
        c.get('a'); // bump 'a' to most recent
        c.set('c', 3); // should evict 'b'
        expect(c.get('a')).toBe(1);
        expect(c.get('b')).toBeUndefined();
        expect(c.get('c')).toBe(3);
    });

    it('overwriting an existing key refreshes its recency', () => {
        const c = new FastCache<number>(2);
        c.set('a', 1);
        c.set('b', 2);
        c.set('a', 99); // refresh 'a'
        c.set('c', 3); // should evict 'b'
        expect(c.get('a')).toBe(99);
        expect(c.get('b')).toBeUndefined();
    });

    it('tracks size correctly', () => {
        const c = new FastCache<number>(10);
        c.set('a', 1);
        c.set('b', 2);
        expect(c.size).toBe(2);
        c.clear();
        expect(c.size).toBe(0);
    });
});

describe('buildFastCacheKey', () => {
    it('produces a stable, comma-separated key', () => {
        expect(buildFastCacheKey([1, 2, 3])).toBe('1,2,3');
        expect(buildFastCacheKey([0])).toBe('0');
        expect(buildFastCacheKey([])).toBe('');
    });

    it('distinguishes different slot orders', () => {
        expect(buildFastCacheKey([1, 2, 3])).not.toBe(buildFastCacheKey([3, 2, 1]));
    });

    it('represents empty slots with -1', () => {
        expect(buildFastCacheKey([1, -1, 2])).toBe('1,-1,2');
    });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/fastCache.test.ts --run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/autogear/fastScoring/fastCache.ts src/utils/autogear/fastScoring/__tests__/fastCache.test.ts
git commit -m "feat(autogear-fast): integer-keyed LRU cache"
```

---

## Task 10: Implement `fastCalculateStats.ts`

**Why:** The hot-loop replacement for `calculateTotalStats`. Given a `FastScoringContext` and an individual (array of gear/implant piece ids), produce a `StatVector` equivalent to `calculateTotalStats(...).final`.

This is the single largest correctness risk in the plan. Tests before ship.

**Files:**
- Create: `src/utils/autogear/fastScoring/fastCalculateStats.ts`

- [ ] **Step 1: Examine slow-path stages**

Re-read `src/utils/ship/statsCalculator.ts:26-196` and enumerate the stages applied in order:

1. base stats
2. refits (already in prefix)
3. engineering (already in prefix)
4. gear main + sub stats
5. set bonuses (for each set with ≥ minPieces count, apply set-bonus stats `floor(count / minPieces)` times)
6. implant sub stats
7. special implant multipliers (CODE_GUARD, CIPHER_LINK) based on final stats
8. damageReduction cap (max of innate vs gear contribution)

Note: `fastCalculateStats` reimplements stages 4–8. Stages 1–3 live in the prefix.

- [ ] **Step 2: Write the module**

Create `src/utils/autogear/fastScoring/fastCalculateStats.ts`:

```ts
import { GEAR_SETS } from '../../../constants/gearSets';
import type { GearPiece } from '../../../types/gear';
import type { BaseStats, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import {
    STAT_INDEX,
    STAT_COUNT,
    type StatVector,
    copyStatVector,
    createStatVector,
} from './statVector';
import type { GearRegistry } from './gearRegistry';
import { addPieceStatsInto } from './gearRegistry';

export interface FastCalcWorkspace {
    /** Running stats vector. Reused across calls; zeroed at start of each call. */
    stats: StatVector;
    /** Set count buffer, length = registry.setIdToName.length. */
    setCount: Uint8Array;
}

export function createWorkspace(setCount: number): FastCalcWorkspace {
    return {
        stats: createStatVector(),
        setCount: new Uint8Array(setCount),
    };
}

export interface FastCalcInputs {
    readonly registry: GearRegistry;
    readonly shipPrefix: StatVector;
    readonly implantRegistry: GearRegistry; // separate registry for implants
    readonly getImplantPiece: (id: number) => GearPiece;
    readonly getGearPiece: (id: number) => GearPiece;
    /** Ship's raw base stats — only used for the damageReduction cap guard. */
    readonly baseStats: BaseStats;
    /**
     * Percentage reference for gear / set-bonus / implant percentage stats.
     * MUST equal the slow path's `afterEngineering` — i.e. statVectorToBaseStats(shipPrefix).
     * See Invariant 1.
     */
    readonly percentRef: BaseStats;
}

/**
 * Fill `workspace.stats` with the "final" stat vector for an individual.
 *
 * gearIds: one int per gear slot; -1 = empty.
 * implantIds: one int per implant slot; -1 = empty.
 *
 * Mirrors calculateTotalStats in statsCalculator.ts (stages 4–8).
 */
export function fastCalculateStats(
    inputs: FastCalcInputs,
    workspace: FastCalcWorkspace,
    gearIds: readonly number[],
    implantIds: readonly number[]
): void {
    const { registry, shipPrefix, implantRegistry, getImplantPiece, baseStats, percentRef } = inputs;
    const { stats, setCount } = workspace;

    // Stage 1-3: copy prefix into stats
    copyStatVector(shipPrefix, stats);

    // Stage 4: gear contributions (main + sub stats) — precomputed per piece
    // Also accumulate setCount at the same time
    setCount.fill(0);
    for (let i = 0; i < gearIds.length; i++) {
        const id = gearIds[i];
        if (id < 0) continue;
        addPieceStatsInto(registry, id, stats);
        const setId = registry.setIds[id];
        if (setId !== 0) setCount[setId]++;
    }

    // Stage 5: set bonuses — percentage stats reference afterEngineering (= percentRef)
    applySetBonuses(stats, setCount, registry, percentRef);

    // Stage 6: implant sub stats (precomputed vectors already use percentRef)
    for (let i = 0; i < implantIds.length; i++) {
        const id = implantIds[i];
        if (id < 0) continue;
        addPieceStatsInto(implantRegistry, id, stats);
    }

    // Stage 7: special implant multipliers (CODE_GUARD, CIPHER_LINK) — based on final stats
    applySpecialImplants(stats, implantIds, getImplantPiece);

    // Stage 8: damageReduction cap. Match the slow path guard EXACTLY:
    //   slow path: if (breakdown.base.damageReduction && breakdown.final.damageReduction)
    // Both must be truthy (non-zero, non-undefined). See Invariant 3.
    const innateDR = baseStats.damageReduction;
    const finalDR = stats[STAT_INDEX.damageReduction];
    if (innateDR && finalDR) {
        const gearDR = finalDR - innateDR;
        stats[STAT_INDEX.damageReduction] = Math.max(innateDR, gearDR);
    }
}

function applySetBonuses(
    stats: StatVector,
    setCount: Uint8Array,
    registry: GearRegistry,
    percentRef: BaseStats
): void {
    for (let setId = 1; setId < setCount.length; setId++) {
        const count = setCount[setId];
        if (count === 0) continue;
        const setName = registry.setIdToName[setId];
        const setDef = GEAR_SETS[setName];
        if (!setDef?.stats) continue;
        const minPieces = setDef.minPieces || 2;
        const bonusCount = Math.floor(count / minPieces);
        if (bonusCount === 0) continue;

        // Apply setDef.stats bonusCount times, using percentRef (afterEngineering)
        // as the percentage reference — matches slow path statsCalculator.ts:159.
        for (let b = 0; b < bonusCount; b++) {
            for (const stat of setDef.stats) applyStat(stat, stats, percentRef);
        }
    }
}

function applySpecialImplants(
    stats: StatVector,
    implantIds: readonly number[],
    getImplantPiece: (id: number) => GearPiece
): void {
    for (let i = 0; i < implantIds.length; i++) {
        const id = implantIds[i];
        if (id < 0) continue;
        const implant = getImplantPiece(id);
        if (!implant?.setBonus) continue;
        const mult = getSpecialImplantMultiplier(implant.setBonus, implant.rarity);
        if (mult === null) continue;

        if (implant.setBonus === 'CODE_GUARD') {
            stats[STAT_INDEX.security] += stats[STAT_INDEX.hacking] * (mult / 100);
        } else if (implant.setBonus === 'CIPHER_LINK') {
            stats[STAT_INDEX.hacking] += stats[STAT_INDEX.security] * (mult / 100);
        }
    }
}

function getSpecialImplantMultiplier(setBonus: string, rarity: string): number | null {
    if (setBonus === 'CODE_GUARD') {
        const m: Record<string, number> = { common: 20, uncommon: 25, rare: 30, epic: 35, legendary: 40 };
        return m[rarity] ?? null;
    }
    if (setBonus === 'CIPHER_LINK') {
        const m: Record<string, number> = { common: 20, uncommon: 25, rare: 31, epic: 37, legendary: 45 };
        return m[rarity] ?? null;
    }
    return null;
}

function applyStat(stat: Stat, target: StatVector, percentRef: BaseStats): void {
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;
    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const refValue = (percentRef as any)[stat.name] ?? 0;
        target[idx] += refValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}
```

- [ ] **Step 3: Commit (no tests yet — tested via equivalence in Task 12)**

Unit testing `fastCalculateStats` in isolation is less valuable than equivalence-testing it against `calculateTotalStats` via `fastScore`. Move on to Task 11, then Task 12 supplies the coverage.

```bash
git add src/utils/autogear/fastScoring/fastCalculateStats.ts
git commit -m "feat(autogear-fast): fastCalculateStats hot-loop pipeline"
```

---

## Task 11: Implement `context.ts` and `fastScore.ts`

**Why:** `context.ts` bundles the per-run state and exposes `buildFastScoringContext`. `fastScore.ts` is the equivalent of `calculateTotalScore` — combines stats, set-count, arcane siege, arena modifiers, and delegates to the existing `calculatePriorityScore`.

**Files:**
- Create: `src/utils/autogear/fastScoring/context.ts`
- Create: `src/utils/autogear/fastScoring/fastScore.ts`

- [ ] **Step 1: Write `context.ts`**

Create `src/utils/autogear/fastScoring/context.ts`:

```ts
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { EngineeringStat } from '../../../types/stats';
import type { StatPriority, SetPriority, StatBonus } from '../../../types/autogear';
import type { GearSlotName, ShipTypeName } from '../../../constants';
import { buildGearRegistry, type GearRegistry } from './gearRegistry';
import { computeShipPrefix } from './shipPrefix';
import { createWorkspace, type FastCalcWorkspace } from './fastCalculateStats';
import { FastCache } from './fastCache';
import { statVectorToBaseStats, type StatVector } from './statVector';
import type { BaseStats } from '../../../types/stats';

export interface FastScoringContext {
    readonly ship: Ship;
    readonly priorities: readonly StatPriority[];
    readonly setPriorities: readonly SetPriority[] | undefined;
    readonly statBonuses: readonly StatBonus[] | undefined;
    readonly shipRole: ShipTypeName | undefined;
    readonly tryToCompleteSets: boolean | undefined;
    readonly arenaModifiers: Record<string, number> | null | undefined;

    readonly gearRegistry: GearRegistry;
    readonly implantRegistry: GearRegistry;
    readonly shipPrefix: StatVector;
    /** statVectorToBaseStats(shipPrefix). Percentage reference for gear/set/implant. */
    readonly percentRef: BaseStats;
    readonly cache: FastCache<number>;
    readonly workspace: FastCalcWorkspace;
    /** Ordered list of gear-only slots (no implants). */
    readonly gearSlotOrder: readonly GearSlotName[];
    /** Ordered list of implant-only slots. */
    readonly implantSlotOrder: readonly GearSlotName[];

    /** True iff the GA is optimizing implants (inventory contains implant pieces). */
    readonly optimizingImplants: boolean;
    /**
     * When optimizingImplants === false, these are the ids of ship.implants pieces
     * in implantRegistry. Used as a constant "implantIds" array for every fastScore
     * call. Empty array when optimizingImplants === true. See Invariant 2.
     */
    readonly fixedImplantIds: readonly number[];

    readonly hasHardRequirements: boolean;
}

export interface BuildContextInput {
    ship: Ship;
    availableInventory: readonly GearPiece[];
    priorities: readonly StatPriority[];
    setPriorities?: readonly SetPriority[];
    statBonuses?: readonly StatBonus[];
    shipRole?: ShipTypeName;
    tryToCompleteSets?: boolean;
    arenaModifiers?: Record<string, number> | null;
    engineeringStats: EngineeringStat | undefined;
    /**
     * Used only when the GA is NOT optimizing implants — so the context can
     * materialize ship.implants into the implant registry (Invariant 2).
     * Typically this is GeneticStrategy's cachedGetGearPiece.
     */
    resolveGearPiece?: (id: string) => GearPiece | undefined;
}

const CACHE_LIMIT = 50000;

/**
 * IMPORTANT build order (see Invariant 1 in plan preamble):
 *   1. Compute shipPrefix = base + refits + engineering (uses ship.baseStats as percent ref).
 *   2. Convert shipPrefix to BaseStats → percentRef.
 *   3. Build gearRegistry against percentRef (NOT baseStats).
 *   4. Build implantRegistry:
 *        - If optimizing implants: from the inventory's implant pieces, against percentRef.
 *        - Else: from the ship's currently-equipped implants, against percentRef. Also
 *          capture their ids in fixedImplantIds for use on every fastScore call.
 */
export function buildFastScoringContext(input: BuildContextInput): FastScoringContext {
    const gearOnly = input.availableInventory.filter((p) => !p.slot.startsWith('implant_'));
    const inventoryImplants = input.availableInventory.filter((p) => p.slot.startsWith('implant_'));
    const optimizingImplants = inventoryImplants.length > 0;

    // 1–2. Prefix + percentRef
    const shipPrefix = computeShipPrefix(input.ship, input.engineeringStats);
    const percentRef = statVectorToBaseStats(shipPrefix);

    // 3. Gear registry
    const gearRegistry = buildGearRegistry(gearOnly, percentRef);

    // 4. Implant registry — depends on whether GA is optimizing implants
    let implantRegistry: GearRegistry;
    let fixedImplantIds: number[];
    if (optimizingImplants) {
        implantRegistry = buildGearRegistry(inventoryImplants, percentRef);
        fixedImplantIds = [];
    } else {
        // Collect ship.implants piece objects via the getter. Callers (GeneticStrategy)
        // must ensure these are available in the gear cache — normally ship.implants
        // ids are resolvable via getGearPiece at this point.
        const shipImplantPieces: GearPiece[] = [];
        for (const id of Object.values(input.ship.implants ?? {})) {
            if (!id) continue;
            const piece = input.resolveGearPiece?.(id);
            if (piece) shipImplantPieces.push(piece);
        }
        implantRegistry = buildGearRegistry(shipImplantPieces, percentRef);
        fixedImplantIds = shipImplantPieces.map((p) => implantRegistry.idOf.get(p.id)!);
    }

    const totalSets = Math.max(
        gearRegistry.setIdToName.length,
        implantRegistry.setIdToName.length
    );
    const workspace = createWorkspace(totalSets);

    const gearSlotOrder = gearRegistry.slotIdToName;
    const implantSlotOrder = implantRegistry.slotIdToName;

    return {
        ship: input.ship,
        priorities: input.priorities,
        setPriorities: input.setPriorities,
        statBonuses: input.statBonuses,
        shipRole: input.shipRole,
        tryToCompleteSets: input.tryToCompleteSets,
        arenaModifiers: input.arenaModifiers,
        gearRegistry,
        implantRegistry,
        shipPrefix,
        percentRef,
        cache: new FastCache<number>(CACHE_LIMIT),
        workspace,
        gearSlotOrder,
        implantSlotOrder,
        optimizingImplants,
        fixedImplantIds,
        hasHardRequirements: input.priorities.some((p) => p.hardRequirement),
    };
}
```

- [ ] **Step 2: Write `fastScore.ts`**

Create `src/utils/autogear/fastScoring/fastScore.ts`:

```ts
import { applyArenaModifiers } from '../arenaModifiers';
import { calculatePriorityScore } from '../priorityScore';
import type { BaseStats } from '../../../types/stats';
import { fastCalculateStats } from './fastCalculateStats';
import { buildFastCacheKey } from './fastCache';
import { statVectorToBaseStats, STAT_INDEX } from './statVector';
import type { FastScoringContext } from './context';

// Arcane Siege multipliers by rarity — mirrors scoring.ts
const ARCANE_SIEGE_MULTIPLIERS: Record<string, number> = {
    common: 3, uncommon: 5, rare: 10, epic: 15, legendary: 20,
};

export interface FastScoreResult {
    fitness: number;
    /** Only populated when context.hasHardRequirements === true. */
    finalStats?: BaseStats;
}

/**
 * Equivalent of calculateTotalScore, but uses the fast-scoring context and
 * operates on integer gear ids instead of string ids.
 *
 * gearIds: array matching context.gearSlotOrder; -1 for empty slots.
 * implantIds: array matching context.implantSlotOrder; -1 for empty slots.
 *   Pass an empty array [] when the GA is not optimizing implants — the
 *   context's `fixedImplantIds` (built from ship.implants) will be used instead.
 *   See Invariant 2.
 */
export function fastScore(
    context: FastScoringContext,
    gearIds: readonly number[],
    implantIds: readonly number[]
): FastScoreResult {
    const { workspace, cache, hasHardRequirements, optimizingImplants, fixedImplantIds } = context;

    // Resolve effective implant ids (fallback to fixedImplantIds when not optimizing implants)
    const effectiveImplantIds = optimizingImplants ? implantIds : fixedImplantIds;

    // Cache key: concat gear ids, separator, implant ids.
    // Omit implants from the key when they're constant (fixedImplantIds) — saves work.
    const cacheKey = optimizingImplants
        ? buildFastCacheKey(gearIds) + '|' + buildFastCacheKey(effectiveImplantIds)
        : buildFastCacheKey(gearIds);

    const cached = cache.get(cacheKey);
    if (cached !== undefined && !hasHardRequirements) {
        return { fitness: cached };
    }

    // Compute stats
    fastCalculateStats(
        {
            registry: context.gearRegistry,
            shipPrefix: context.shipPrefix,
            implantRegistry: context.implantRegistry,
            getImplantPiece: (id) => context.implantRegistry.pieces[id],
            getGearPiece: (id) => context.gearRegistry.pieces[id],
            baseStats: context.ship.baseStats,
            percentRef: context.percentRef,
        },
        workspace,
        gearIds,
        effectiveImplantIds
    );

    // Convert to BaseStats for the priority scorer
    const finalStats = statVectorToBaseStats(workspace.stats);

    // Apply arena modifiers (same as scoring.ts)
    const statsForScoring =
        context.arenaModifiers && Object.keys(context.arenaModifiers).length > 0
            ? applyArenaModifiers(finalStats, context.arenaModifiers)
            : finalStats;

    // Build setCount as Record<string, number> for the priority scorer
    const setCount: Record<string, number> = {};
    for (let setId = 1; setId < workspace.setCount.length; setId++) {
        const c = workspace.setCount[setId];
        if (c > 0) setCount[context.gearRegistry.setIdToName[setId]] = c;
    }

    // Arcane siege — check effectiveImplantIds for ARCANE_SIEGE
    let arcaneSiegeMultiplier = 0;
    const shieldCount = setCount['SHIELD'] || 0;
    if (shieldCount >= 2) {
        for (let i = 0; i < effectiveImplantIds.length; i++) {
            const id = effectiveImplantIds[i];
            if (id < 0) continue;
            const implant = context.implantRegistry.pieces[id];
            if (implant?.setBonus === 'ARCANE_SIEGE') {
                arcaneSiegeMultiplier = ARCANE_SIEGE_MULTIPLIERS[implant.rarity] ?? 0;
                break;
            }
        }
    }

    const fitness = calculatePriorityScore(
        statsForScoring,
        context.priorities as any,
        context.shipRole,
        setCount,
        context.setPriorities as any,
        context.statBonuses as any,
        context.tryToCompleteSets,
        arcaneSiegeMultiplier
    );

    if (!hasHardRequirements) {
        cache.set(cacheKey, fitness);
    }

    return hasHardRequirements
        ? { fitness, finalStats: statsForScoring }
        : { fitness };
}
```

Note: when `hasHardRequirements` is true, we skip the fitness cache and return the computed stats so the caller can run violation calc without recomputing. This structurally eliminates the duplicated `calculateTotalStats` that exists in today's `GeneticStrategy.calculateFitness` when hard reqs are set — the spec flagged this.

- [ ] **Step 3: Commit (equivalence tested in Task 12)**

```bash
git add src/utils/autogear/fastScoring/context.ts src/utils/autogear/fastScoring/fastScore.ts
git commit -m "feat(autogear-fast): context builder and fastScore"
```

---

## Task 12: Equivalence tests for `fastScore` vs `calculateTotalScore`

**Why:** The primary correctness gate. Randomized scenarios assert fastScore output matches the slow path within tolerance.

**Files:**
- Create: `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts`

- [ ] **Step 1: Write the assertion helper**

Create `src/utils/autogear/fastScoring/__tests__/equivalence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateTotalScore } from '../../scoring';
import { fastScore } from '../fastScore';
import { buildFastScoringContext } from '../context';
import {
    generateTestInventory,
    makeTestShip,
    makeTestEngineering,
    seededRandom,
    TEST_BASE_STATS,
} from './fixtures/testInventory';
import { GEAR_SLOTS, type GearSlotName } from '../../../../constants';
import type { StatPriority } from '../../../../types/autogear';
import type { GearPiece } from '../../../../types/gear';

const SCORE_REL_TOLERANCE = 1e-6;

function scoresEqual(a: number, b: number): boolean {
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= SCORE_REL_TOLERANCE * scale;
}

interface Scenario {
    seed: number;
    priorities: StatPriority[];
    role: 'ATTACKER' | 'DEFENDER' | 'DEBUFFER' | undefined;
    arenaModifiers: Record<string, number> | null;
    equipmentMask: number; // bitmask: which slots to equip (0..63 for 6 slots)
}

function makeScenarios(n: number, startSeed: number): Scenario[] {
    const scenarios: Scenario[] = [];
    const roles: Scenario['role'][] = ['ATTACKER', 'DEFENDER', 'DEBUFFER', undefined];
    for (let i = 0; i < n; i++) {
        const rnd = seededRandom(startSeed + i);
        scenarios.push({
            seed: startSeed + i,
            priorities: [
                { stat: 'attack', weight: 1 + Math.floor(rnd() * 3) },
                { stat: 'hp', weight: 1 + Math.floor(rnd() * 3) },
            ],
            role: roles[Math.floor(rnd() * roles.length)],
            arenaModifiers: rnd() < 0.3 ? { attack: 10, hp: -5 } : null,
            equipmentMask: Math.floor(rnd() * 64),
        });
    }
    return scenarios;
}

describe('fastScore equivalence with calculateTotalScore', () => {
    const ship = makeTestShip();
    const engineering = makeTestEngineering();
    const inventory = generateTestInventory(100, 30);
    const getGearPiece = (id: string) =>
        inventory.find((p) => p.id === id) as GearPiece | undefined;
    const getEng = (type: string) =>
        type === 'ATTACKER' ? engineering : undefined;

    const slots = Object.keys(GEAR_SLOTS) as GearSlotName[];

    function buildEquipment(mask: number): {
        equipment: Partial<Record<GearSlotName, string>>;
        gearIds: number[];
    } {
        const equipment: Partial<Record<GearSlotName, string>> = {};
        const gearIds: number[] = [];
        // For each slot in the registry order, pick a piece if bit set
        return { equipment, gearIds };
    }

    it('matches slow path for 50 randomized scenarios', () => {
        const scenarios = makeScenarios(50, 1);
        const context = buildFastScoringContext({
            ship,
            availableInventory: inventory,
            priorities: scenarios[0].priorities,
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: null,
            resolveGearPiece: getGearPiece,
        });

        const slotOrder = context.gearSlotOrder;

        for (const sc of scenarios) {
            // Rebuild context for each scenario (priorities/role/arena may differ)
            const ctx = buildFastScoringContext({
                ship,
                availableInventory: inventory,
                priorities: sc.priorities,
                shipRole: sc.role,
                engineeringStats: engineering,
                arenaModifiers: sc.arenaModifiers ?? undefined,
                resolveGearPiece: getGearPiece,
            });

            // Build the equipment from the mask, one bit per slot in ctx.gearSlotOrder
            const rnd = seededRandom(sc.seed);
            const equipment: Partial<Record<GearSlotName, string>> = {};
            const gearIds: number[] = [];
            for (let s = 0; s < ctx.gearSlotOrder.length; s++) {
                const slotName = ctx.gearSlotOrder[s];
                const bit = (sc.equipmentMask >> s) & 1;
                if (!bit) {
                    gearIds.push(-1);
                    continue;
                }
                const candidates = inventory.filter((p) => p.slot === slotName);
                if (candidates.length === 0) {
                    gearIds.push(-1);
                    continue;
                }
                const pick = candidates[Math.floor(rnd() * candidates.length)];
                equipment[slotName] = pick.id;
                gearIds.push(ctx.gearRegistry.idOf.get(pick.id)!);
            }

            // Implants: none for equivalence test — covered in a dedicated test below
            const implantIds: number[] = [];

            const slowScore = calculateTotalScore(
                ship,
                equipment,
                sc.priorities,
                getGearPiece,
                getEng,
                sc.role,
                undefined, // setPriorities
                undefined, // statBonuses
                false,
                sc.arenaModifiers
            );
            const fastResult = fastScore(ctx, gearIds, implantIds);

            if (!scoresEqual(slowScore, fastResult.fitness)) {
                // Dump inputs for debugging
                // eslint-disable-next-line no-console
                console.error('Divergence', { sc, equipment, slowScore, fast: fastResult.fitness });
            }
            expect(scoresEqual(slowScore, fastResult.fitness)).toBe(true);
        }
    });

    it('covers explicit set bonus thresholds (2, 4 pieces) for each test set', () => {
        // For each set bonus in TEST_SET_BONUSES, build inventory where exactly
        // N pieces of that set exist across distinct slots, and assert fastScore
        // matches calculateTotalScore at each threshold.
        const setNames = ['SHIELD', 'DECIMATION', 'BOOST', 'HARDENED'] as const;
        const gearSlots = Object.keys(GEAR_SLOTS) as GearSlotName[];

        for (const setName of setNames) {
            for (const pieceCount of [2, 4]) {
                // Construct 'pieceCount' gear pieces of this set, each on a distinct slot,
                // plus simple non-set filler pieces for remaining slots (to ensure the
                // inventory is valid).
                const specific: GearPiece[] = [];
                for (let i = 0; i < pieceCount && i < gearSlots.length; i++) {
                    specific.push({
                        id: `set-${setName}-${i}`,
                        slot: gearSlots[i],
                        setBonus: setName,
                        rarity: 'legendary',
                        level: 16,
                        stars: 6,
                        mainStat: { name: 'attack', value: 500, type: 'flat' },
                        subStats: [{ name: 'hp', value: 1000, type: 'flat' }],
                    } as GearPiece);
                }

                const lookup = (id: string) =>
                    specific.find((p) => p.id === id) as GearPiece | undefined;

                const equipment: Partial<Record<GearSlotName, string>> = {};
                for (const p of specific) equipment[p.slot] = p.id;

                const ctx = buildFastScoringContext({
                    ship,
                    availableInventory: specific,
                    priorities: [{ stat: 'attack', weight: 1 }],
                    shipRole: 'ATTACKER',
                    engineeringStats: engineering,
                    arenaModifiers: undefined,
                    resolveGearPiece: lookup,
                });
                const gearIds = ctx.gearSlotOrder.map((slot) => {
                    const id = equipment[slot];
                    return id ? ctx.gearRegistry.idOf.get(id)! : -1;
                });

                const slowScore = calculateTotalScore(
                    ship,
                    equipment,
                    [{ stat: 'attack', weight: 1 }],
                    lookup,
                    getEng,
                    'ATTACKER',
                    undefined,
                    undefined,
                    false,
                    null
                );
                const fast = fastScore(ctx, gearIds, []);

                expect(
                    scoresEqual(slowScore, fast.fitness),
                    `set=${setName} pieces=${pieceCount} slow=${slowScore} fast=${fast.fitness}`
                ).toBe(true);
            }
        }
    });

    it('cache returns same fitness on repeated call with identical ids', () => {
        const ctx = buildFastScoringContext({
            ship,
            availableInventory: inventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: undefined,
            resolveGearPiece: getGearPiece,
        });
        const gearIds = ctx.gearSlotOrder.map(() => -1);
        gearIds[0] = ctx.gearRegistry.idOf.get(
            inventory.filter((p) => p.slot === ctx.gearSlotOrder[0])[0].id
        )!;
        const first = fastScore(ctx, gearIds, []);
        const second = fastScore(ctx, gearIds, []);
        expect(second.fitness).toBe(first.fitness);
        expect(ctx.cache.size).toBeGreaterThan(0);
    });

    it('equivalence when GA is not optimizing implants but ship has them equipped', () => {
        // Construct a ship that already has implants equipped, and an inventory
        // that contains ONLY gear (no implants). The slow path would apply
        // ship.implants; fastScore should too via fixedImplantIds.
        const implantPiece = {
            id: 'ship-implant-1',
            slot: 'implant_major',
            setBonus: undefined,
            rarity: 'legendary',
            level: 16,
            stars: 6,
            mainStat: null,
            subStats: [{ name: 'attack', value: 200, type: 'flat' }],
        } as unknown as GearPiece;
        const shipWithImplants = makeTestShip({
            implants: { implant_major: implantPiece.id },
        } as any);
        const gearInventory = inventory; // no implants in our fixture

        const lookup = (id: string) =>
            id === implantPiece.id
                ? implantPiece
                : (gearInventory.find((p) => p.id === id) as GearPiece | undefined);

        const ctx = buildFastScoringContext({
            ship: shipWithImplants,
            availableInventory: gearInventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: undefined,
            resolveGearPiece: lookup,
        });

        expect(ctx.optimizingImplants).toBe(false);
        expect(ctx.fixedImplantIds.length).toBe(1);

        const gearIds = ctx.gearSlotOrder.map(() => -1); // no gear equipped
        const slow = calculateTotalScore(
            shipWithImplants,
            {},
            [{ stat: 'attack', weight: 1 }],
            lookup,
            getEng,
            'ATTACKER',
            undefined,
            undefined,
            false,
            null
        );
        const fast = fastScore(ctx, gearIds, []);
        expect(scoresEqual(slow, fast.fitness)).toBe(true);
    });

    it('equivalence holds with arena modifiers active', () => {
        // Covered implicitly by the randomized test but add a deterministic case:
        const ctx = buildFastScoringContext({
            ship,
            availableInventory: inventory,
            priorities: [{ stat: 'attack', weight: 1 }],
            shipRole: 'ATTACKER',
            engineeringStats: engineering,
            arenaModifiers: { attack: 25, hp: -10 },
            resolveGearPiece: getGearPiece,
        });
        const equipment = { weapon: inventory[0].id };
        const gearIds = ctx.gearSlotOrder.map((slot) =>
            slot === 'weapon' ? ctx.gearRegistry.idOf.get(inventory[0].id)! : -1
        );
        const slowScore = calculateTotalScore(
            ship,
            equipment as any,
            [{ stat: 'attack', weight: 1 }],
            getGearPiece,
            getEng,
            'ATTACKER',
            undefined,
            undefined,
            false,
            { attack: 25, hp: -10 }
        );
        const fastResult = fastScore(ctx, gearIds, []);
        expect(scoresEqual(slowScore, fastResult.fitness)).toBe(true);
    });
});
```

Expand the `covers explicit set bonus thresholds` test during implementation to loop over each set bonus at each threshold (2/4/6 pieces). Keep each assertion's divergence output verbose enough to pinpoint which stage diverged.

- [ ] **Step 2: Run the test**

Run: `npm test -- src/utils/autogear/fastScoring/__tests__/equivalence.test.ts --run`
Expected: all pass.

If any scenario fails:
1. Look at the divergence console output.
2. Narrow down which stat diverges (stat vector level).
3. Fix `fastCalculateStats` / `shipPrefix` / `gearRegistry` — don't loosen the test.

- [ ] **Step 3: Commit**

```bash
git add src/utils/autogear/fastScoring/__tests__/equivalence.test.ts
git commit -m "test(autogear-fast): randomized equivalence with calculateTotalScore"
```

---

## Task 13: Feature flag module

**Why:** Centralize `USE_FAST_SCORING` and `VERIFY_FAST_SCORING` so toggling is a one-line change and the flags are tree-shakable in prod builds.

**Files:**
- Create: `src/utils/autogear/fastScoring/featureFlag.ts`

- [ ] **Step 1: Write the module**

Create `src/utils/autogear/fastScoring/featureFlag.ts`:

```ts
/**
 * USE_FAST_SCORING — controls whether GeneticStrategy uses the fast-path
 * scoring module or the existing calculateTotalScore. Flipped on once
 * equivalence tests and benchmarks look good.
 *
 * Defaults to false on first merge; flip to true in Task 16.
 */
export const USE_FAST_SCORING = false;

/**
 * VERIFY_FAST_SCORING — when true, the GA runs BOTH the fast path and the
 * slow path on every fitness eval and console.errors on divergence.
 *
 * Set to a literal `true` locally to debug; revert to `false` before commit.
 * Kept as a module-level constant (not an env-var read) so Vite can dead-code
 * eliminate the verify branch in production builds.
 */
export const VERIFY_FAST_SCORING = false;
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/autogear/fastScoring/featureFlag.ts
git commit -m "feat(autogear-fast): feature flag module"
```

---

# Phase 3 — Wire GA to fast path behind the flag

With the fast-scoring module in place and equivalence-tested, wire `GeneticStrategy` to use it when `USE_FAST_SCORING === true`. Keep the slow path as the default until the flip.

## Task 14: Route `GeneticStrategy.calculateFitness` through `fastScore`

**Files:**
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`

- [ ] **Step 1: Build the fast context in `findOptimalGear`**

In `GeneticStrategy.ts`, just after the `inventoryBySlot` index (Task 1), build the fast context:

```ts
import { buildFastScoringContext, type FastScoringContext } from '../fastScoring/context';
import { USE_FAST_SCORING, VERIFY_FAST_SCORING } from '../fastScoring/featureFlag';
import { fastScore } from '../fastScoring/fastScore';
import { calculateHardViolation } from '../priorityScore';
import type { BaseStats } from '../../../types/stats';

// ...

const fastContext: FastScoringContext | null = USE_FAST_SCORING
    ? buildFastScoringContext({
          ship,
          availableInventory,
          priorities,
          setPriorities,
          statBonuses,
          shipRole,
          tryToCompleteSets,
          arenaModifiers,
          engineeringStats: getEngineeringStatsForShipType(ship.type),
          resolveGearPiece: cachedGetGearPiece,
      })
    : null;
```

Thread `fastContext` through `runSingleGAPass` and then `calculateFitness`.

- [ ] **Step 2: Convert equipment -> gearIds in `calculateFitness`**

The existing `Individual.equipment` is `Partial<Record<GearSlotName, string>>`. The fast path wants two integer arrays (`gearIds`, `implantIds`). Convert:

```ts
private equipmentToIdArrays(
    equipment: Partial<Record<GearSlotName, string>>,
    fastContext: FastScoringContext
): { gearIds: number[]; implantIds: number[] } {
    const gearIds: number[] = [];
    for (const slot of fastContext.gearSlotOrder) {
        const id = equipment[slot];
        gearIds.push(id ? fastContext.gearRegistry.idOf.get(id) ?? -1 : -1);
    }
    const implantIds: number[] = [];
    for (const slot of fastContext.implantSlotOrder) {
        const id = equipment[slot];
        implantIds.push(id ? fastContext.implantRegistry.idOf.get(id) ?? -1 : -1);
    }
    return { gearIds, implantIds };
}
```

- [ ] **Step 3: Update `calculateFitness`**

Replace the existing body with a branching path:

```ts
private calculateFitness(
    equipment: Partial<Record<GearSlotName, string>>,
    ship: Ship,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null,
    fastContext?: FastScoringContext | null
): { fitness: number; violation: number } {
    performanceTracker.startTimer('CalculateFitness');

    if (fastContext) {
        const { gearIds, implantIds } = this.equipmentToIdArrays(equipment, fastContext);
        const { fitness, finalStats } = fastScore(fastContext, gearIds, implantIds);

        let violation = 0;
        if (fastContext.hasHardRequirements) {
            // finalStats is guaranteed defined when hasHardRequirements is true
            violation = calculateHardViolation(finalStats as BaseStats, priorities);
        }

        if (VERIFY_FAST_SCORING) {
            this.verifyAgainstSlowPath(
                equipment, ship, priorities, getGearPiece,
                getEngineeringStatsForShipType, shipRole, setPriorities,
                statBonuses, tryToCompleteSets, arenaModifiers, fitness, violation
            );
        }

        performanceTracker.endTimer('CalculateFitness');
        return { fitness, violation };
    }

    // Slow path (existing code) — unchanged below this line
    // ... existing body
}
```

- [ ] **Step 4: Write the verify helper**

```ts
private verifyAgainstSlowPath(/* ... params ... */): void {
    // Compute slow-path fitness and violation; compare to provided fitness and violation.
    // If they diverge beyond tolerance, console.error with full input dump.
    // Never throws — verification is a diagnostic, not an assertion.
}
```

Use the same tolerance as the equivalence tests (relative `1e-6`).

- [ ] **Step 5: Run full test suite**

Run: `npm test -- --run`
Expected: all pass. If `GeneticStrategy.test.ts` fails, compare slow-path vs fast-path output in the diagnostics.

- [ ] **Step 6: Manual smoke test**

Run `npm start`. Run autogear on a realistic ship. Open DevTools console. Confirm:
- No errors.
- `performanceTimer` summary shows reduced `CalculateTotalStats` and `CreateCacheKey` time.
- Results look sensible (gear suggestions are real, not empty).

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/strategies/GeneticStrategy.ts
git commit -m "feat(autogear-fast): wire GeneticStrategy through fastScore behind USE_FAST_SCORING"
```

---

## Task 15: VERIFY_FAST_SCORING dev check

This is folded into Task 14 Step 3-4. If the verify helper was left as a stub, expand it now:

- [ ] **Step 1: Implement `verifyAgainstSlowPath` fully**

```ts
private verifyAgainstSlowPath(
    equipment: Partial<Record<GearSlotName, string>>,
    ship: Ship,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole: ShipTypeName | undefined,
    setPriorities: SetPriority[] | undefined,
    statBonuses: StatBonus[] | undefined,
    tryToCompleteSets: boolean | undefined,
    arenaModifiers: Record<string, number> | null | undefined,
    fastFitness: number,
    fastViolation: number
): void {
    // Split equipment same way the slow path does
    const gearOnly: Partial<Record<GearSlotName, string>> = {};
    const implantsOnly: Partial<Record<GearSlotName, string>> = {};
    Object.entries(equipment).forEach(([slot, gearId]) => {
        if (slot.startsWith('implant_')) implantsOnly[slot] = gearId;
        else gearOnly[slot] = gearId;
    });
    const hasImplantSlots = Object.keys(implantsOnly).length > 0;
    const shipWithNewImplants: Ship = hasImplantSlots
        ? { ...ship, implants: implantsOnly }
        : ship;

    const slowFitness = calculateTotalScore(
        shipWithNewImplants, gearOnly, priorities, getGearPiece,
        getEngineeringStatsForShipType, shipRole, setPriorities,
        statBonuses, tryToCompleteSets, arenaModifiers
    );

    const relTol = 1e-6;
    const scale = Math.max(1, Math.abs(slowFitness), Math.abs(fastFitness));
    if (Math.abs(slowFitness - fastFitness) > relTol * scale) {
        // eslint-disable-next-line no-console
        console.error('[VERIFY_FAST_SCORING] Fitness divergence', {
            slowFitness, fastFitness, equipment, shipRole, arenaModifiers,
        });
    }
    // Violation check omitted unless hardRequirements — it's expensive.
}
```

- [ ] **Step 2: Manual test with VERIFY_FAST_SCORING flipped on**

Locally edit `featureFlag.ts` to set `VERIFY_FAST_SCORING = true`. Run autogear. Watch console. Should see no divergence errors. Revert the flag.

- [ ] **Step 3: Commit** (if step 1 was a separate diff)

```bash
git add src/utils/autogear/strategies/GeneticStrategy.ts
git commit -m "feat(autogear-fast): VERIFY_FAST_SCORING dev-mode divergence check"
```

---

# Phase 4 — Flip the flag

## Task 16: Default `USE_FAST_SCORING` to on

- [ ] **Step 1: Confirm Phase 2 + 3 are merged**

All prior commits present on the branch. All tests green.

- [ ] **Step 2: Run benchmark before flip**

Follow Task 4 steps with the flag off. Record the current `performanceTimer` summary.

- [ ] **Step 3: Flip the flag**

`src/utils/autogear/fastScoring/featureFlag.ts`:

```ts
export const USE_FAST_SCORING = true;
```

Note: during Phase 3 development, the flag was flipped to `true` locally (uncommitted) to exercise the fast path. Task 16 is the commit that lands the flip.

- [ ] **Step 4: Run benchmark after flip**

Same scenario as Step 2. Record the summary.

- [ ] **Step 5: Verify improvement**

Compare before/after. Expected: total time reduced by ~40–50%. `CalculateTotalStats` time should drop substantially (now inside `fastCalculateStats`, which may not be instrumented by `performanceTimer` — that's fine, look at total time).

- [ ] **Step 6: Commit if any flag change**

```bash
git add src/utils/autogear/fastScoring/featureFlag.ts
git commit -m "feat(autogear-fast): default USE_FAST_SCORING to on"
```

---

# Phase 5 — Benchmark harness

## Task 17: Build `scripts/benchmark-autogear.ts`

**Why:** Repeatable measurement so future changes can be checked against a known-good baseline.

**Caveat:** The fixture generator from Task 6 is synthetic — it does not vary rarity, level, or set complexity the way a real 773-piece Salvation inventory does. Use this benchmark for **relative** before/after comparisons across commits. The **absolute** numbers will not match the spec's 670ms Salvation baseline; always re-verify gains with a browser run on a real imported inventory (Task 4 / Task 16 Step 4) before declaring a win.

**Files:**
- Create: `scripts/benchmark-autogear.ts`

- [ ] **Step 1: Scaffold the script**

Create `scripts/benchmark-autogear.ts`:

```ts
/**
 * Autogear benchmark harness.
 *
 * Usage:
 *   npx tsx scripts/benchmark-autogear.ts
 *
 * Loads a fixed inventory fixture, builds a representative ship, runs the
 * Genetic strategy with a fixed seed, prints the performanceTimer summary.
 */
import { GeneticStrategy } from '../src/utils/autogear/strategies/GeneticStrategy';
import { performanceTracker } from '../src/utils/autogear/performanceTimer';
import {
    generateTestInventory,
    makeTestShip,
    makeTestEngineering,
} from '../src/utils/autogear/fastScoring/__tests__/fixtures/testInventory';

async function main() {
    const inventory = generateTestInventory(42, 400); // larger fixture for realism
    const ship = makeTestShip();
    const engineering = makeTestEngineering();

    const strategy = new GeneticStrategy();
    const start = performance.now();
    const result = await strategy.findOptimalGear(
        ship,
        [{ stat: 'attack', weight: 2 }, { stat: 'hp', weight: 1 }],
        inventory,
        (id: string) => inventory.find((p) => p.id === id),
        (t: string) => (t === 'ATTACKER' ? engineering : undefined),
        'ATTACKER',
        undefined,
        undefined,
        false,
        null
    );
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`Total: ${elapsed.toFixed(1)}ms — ${result.suggestions.length} suggestions`);
    performanceTracker.printSummary();
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
```

- [ ] **Step 2: Verify `tsx` is available (or use an equivalent runner)**

Run: `npx tsx --version`
If not available, install as devDep or adapt the script to use `npx vite-node`.

- [ ] **Step 3: Run the benchmark**

Run: `npx tsx scripts/benchmark-autogear.ts`
Expected: one summary block, total time reflecting current Phase state.

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-autogear.ts
git commit -m "chore(autogear): add benchmark harness script"
```

---

## Task 18: Capture Phase 4/5 benchmark numbers

- [ ] **Step 1: Run `npx tsx scripts/benchmark-autogear.ts` three times**

Record each run's total time. Take the median.

- [ ] **Step 2: Run the browser scenario again**

Same as Task 4. Record summary.

- [ ] **Step 3: Document in the PR description**

Before/after numbers, script output, browser run output. No code change.

---

# Closeout

- [ ] **Step 1: Full test suite green**

Run: `npm test -- --run`
Expected: all tests pass, new tests included.

- [ ] **Step 2: Lint clean**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Build succeeds**

Run: `npm run build`
Expected: successful production build.

- [ ] **Step 4: One-line summary in the PR description**

"Autogear wall-clock: XXXms → YYYms (Z% faster) on the benchmark. Fast-scoring path behind USE_FAST_SCORING (default on). Slow path unchanged and still used by non-GA callers; VERIFY_FAST_SCORING diagnostic available in dev."
