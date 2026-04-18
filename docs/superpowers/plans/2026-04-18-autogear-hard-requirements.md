# Autogear Hard Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reintroduce a per-priority "hard requirement" flag in Autogear that forces the optimizer to satisfy `minLimit`/`maxLimit` constraints — without the gradient-collapse failure mode that caused the prior implementation to be removed.

**Architecture:** Apply Deb's feasibility rule in the Genetic strategy. Each individual gains a `violation` score (0 = feasible). A lexicographic comparator (feasible > infeasible; then fitness; then lower violation) replaces raw fitness comparisons in sort/tournament/crossover/early-termination. The strategy returns an `AutogearResult` (suggestions + feasibility metadata + attempt count). On infeasibility, the loop retries up to 5× with fresh random initialization; the best-across-attempts result is returned even if no attempt reached feasibility.

**Tech Stack:** TypeScript, React 18, Vitest, TailwindCSS. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-04-18-autogear-hard-requirements-design.md](../specs/2026-04-18-autogear-hard-requirements-design.md)

---

## File Plan

**Created:**
- `src/utils/autogear/individualComparator.ts` — exports `compareIndividuals` (pure function, reused by tests)
- `src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts` — integration smoke tests

**Modified:**
- `src/types/autogear.ts` — add `hardRequirement?: boolean` to `StatPriority`
- `src/utils/autogear/AutogearStrategy.ts` — add `AutogearResult`, change return type
- `src/utils/autogear/BaseStrategy.ts` — update abstract `findOptimalGear` signature; extend progress callback shape
- `src/utils/autogear/priorityScore.ts` — add `calculateHardViolation`
- `src/utils/autogear/scoring.ts` — re-export `calculateHardViolation`
- `src/utils/autogear/__tests__/scoring.test.ts` — add tests for `calculateHardViolation`
- `src/utils/autogear/strategies/GeneticStrategy.ts` — Individual gains `violation`; comparator threaded through sort/tournament/crossover/early-stop; rerun loop
- `src/utils/autogear/strategies/BeamSearchStrategy.ts` — wrap return in `AutogearResult`
- `src/utils/autogear/strategies/TwoPassStrategy.ts` — wrap return in `AutogearResult`
- `src/utils/autogear/strategies/SetFirstStrategy.ts` — wrap return in `AutogearResult`
- `src/components/stats/StatPriorityForm.tsx` — add "Hard Requirement 2" checkbox
- `src/components/autogear/AutogearSettings.tsx` — add `— Hard Requirement 2` suffix + tooltip in priority list
- `src/components/autogear/GearSuggestions.tsx` — new warning banner (unmet) and attempts note (N > 1)
- `src/pages/manager/AutogearPage.tsx` — consume `AutogearResult`, filter existing soft-limit warning, pass attempt info to progress bar
- `src/pages/DocumentationPage.tsx` — autogear section paragraph on hard requirements

---

## Task 1: Add `hardRequirement` field to `StatPriority`

**Files:**
- Modify: `src/types/autogear.ts:5-10`

- [ ] **Step 1: Add field to interface**

Open `src/types/autogear.ts` and add `hardRequirement?: boolean;` to `StatPriority`:

```ts
export interface StatPriority {
    stat: StatName;
    weight?: number;
    minLimit?: number;
    maxLimit?: number;
    hardRequirement?: boolean;
}
```

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings (absence of consumers means no type errors yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/autogear.ts
git commit -m "feat(autogear): add hardRequirement field to StatPriority type"
```

---

## Task 2: Implement `calculateHardViolation` helper (TDD)

**Files:**
- Modify: `src/utils/autogear/priorityScore.ts` (add function, export)
- Modify: `src/utils/autogear/scoring.ts` (re-export alongside existing re-exports at lines 21-29)
- Modify: `src/utils/autogear/__tests__/scoring.test.ts` (add test suite)

- [ ] **Step 1: Write failing tests**

Append to `src/utils/autogear/__tests__/scoring.test.ts`:

```ts
import { calculateHardViolation } from '../scoring';
import { StatPriority } from '../../../types/autogear';

describe('calculateHardViolation', () => {
    const stats = {
        hp: 400000,
        attack: 10000,
        defence: 8000,
        speed: 180,
        hacking: 0,
        security: 0,
        crit: 50,
        critDamage: 150,
        healModifier: 0,
        hpRegen: 0,
        shield: 0,
        damageReduction: 0,
        defensePenetration: 0,
    };

    it('returns 0 when no priorities', () => {
        expect(calculateHardViolation(stats, [])).toBe(0);
    });

    it('returns 0 when no priorities are hard-flagged', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200 },
            { stat: 'hp', maxLimit: 300000 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('returns 0 when hard-flagged priority has neither minLimit nor maxLimit', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('returns 0 when all hard reqs are met', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 150, hardRequirement: true },
            { stat: 'hp', maxLimit: 500000, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('computes normalized min violation', () => {
        // speed = 180, minLimit = 200 → (200-180)/200 = 0.1
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1, 10);
    });

    it('computes normalized max violation', () => {
        // hp = 400000, maxLimit = 300000 → (400000-300000)/300000 ≈ 0.3333
        const priorities: StatPriority[] = [
            { stat: 'hp', maxLimit: 300000, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(1 / 3, 10);
    });

    it('sums violations across multiple hard priorities', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true }, // 0.1
            { stat: 'hp', maxLimit: 300000, hardRequirement: true }, // 0.3333
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1 + 1 / 3, 10);
    });

    it('handles both min and max on a single hard priority', () => {
        // speed = 180, hard min 200 (violation 0.1), hard max 170 (violation 10/170 ≈ 0.0588)
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, maxLimit: 170, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1 + 10 / 170, 10);
    });

    it('ignores soft limits even when hard limits miss', () => {
        const priorities: StatPriority[] = [
            { stat: 'speed', minLimit: 200, hardRequirement: true }, // 0.1
            { stat: 'hp', maxLimit: 100000 }, // soft, ignored
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(0.1, 10);
    });

    it('treats missing stat as 0', () => {
        // hacking = 0 in stats; minLimit = 100 → violation = (100-0)/100 = 1.0
        const priorities: StatPriority[] = [
            { stat: 'hacking', minLimit: 100, hardRequirement: true },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeCloseTo(1.0, 10);
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/utils/autogear/__tests__/scoring.test.ts`
Expected: `calculateHardViolation` suite fails with import error ("calculateHardViolation" not exported).

- [ ] **Step 3: Implement `calculateHardViolation` in `priorityScore.ts`**

Append to `src/utils/autogear/priorityScore.ts`:

```ts
/**
 * Sum of normalized violations for all hard-flagged priorities.
 * Returns 0 when all hard requirements are met (combo is "feasible").
 * Normalization divides by the limit so cross-stat comparisons are meaningful.
 */
export function calculateHardViolation(
    stats: BaseStats,
    priorities: StatPriority[]
): number {
    let violation = 0;
    for (const p of priorities) {
        if (!p.hardRequirement) continue;
        const value = stats[p.stat] || 0;
        if (p.minLimit && value < p.minLimit) {
            violation += (p.minLimit - value) / p.minLimit;
        }
        if (p.maxLimit && value > p.maxLimit) {
            violation += (value - p.maxLimit) / p.maxLimit;
        }
    }
    return violation;
}
```

- [ ] **Step 4: Re-export from `scoring.ts`**

In `src/utils/autogear/scoring.ts`, extend the import (line 10-18) and re-export (line 21-29):

```ts
// line 10-18:
import {
    calculatePriorityScore,
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateHealingPerHit,
    calculateCritMultiplier,
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
} from './priorityScore';

// line 21-29:
export {
    calculatePriorityScore,
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateHealingPerHit,
    calculateCritMultiplier,
    applyAdditiveBonuses,
    calculateMultiplierFactor,
    calculateHardViolation,
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/utils/autogear/__tests__/scoring.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/autogear/priorityScore.ts src/utils/autogear/scoring.ts src/utils/autogear/__tests__/scoring.test.ts
git commit -m "feat(autogear): add calculateHardViolation helper with tests"
```

---

## Task 3: Implement `compareIndividuals` comparator (TDD)

**Files:**
- Create: `src/utils/autogear/individualComparator.ts`
- Create: `src/utils/autogear/__tests__/individualComparator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/autogear/__tests__/individualComparator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compareIndividuals } from '../individualComparator';

describe('compareIndividuals', () => {
    // Feasibility: violation === 0
    it('feasible beats infeasible regardless of fitness', () => {
        const feasibleLowFit = { fitness: 10, violation: 0 };
        const infeasibleHighFit = { fitness: 1000, violation: 0.01 };
        expect(compareIndividuals(feasibleLowFit, infeasibleHighFit)).toBeLessThan(0);
        expect(compareIndividuals(infeasibleHighFit, feasibleLowFit)).toBeGreaterThan(0);
    });

    it('among feasible, higher fitness ranks first', () => {
        const a = { fitness: 100, violation: 0 };
        const b = { fitness: 50, violation: 0 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('among infeasible, lower violation ranks first', () => {
        const a = { fitness: 10, violation: 0.1 };
        const b = { fitness: 1000, violation: 0.2 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('among infeasible with equal violation, higher fitness ranks first', () => {
        const a = { fitness: 100, violation: 0.1 };
        const b = { fitness: 50, violation: 0.1 };
        expect(compareIndividuals(a, b)).toBeLessThan(0);
        expect(compareIndividuals(b, a)).toBeGreaterThan(0);
    });

    it('returns 0 for identical individuals', () => {
        const a = { fitness: 100, violation: 0 };
        const b = { fitness: 100, violation: 0 };
        expect(compareIndividuals(a, b)).toBe(0);
    });

    it('sorts an array in feasibility-first order', () => {
        const arr = [
            { fitness: 1000, violation: 0.5 }, // infeasible, high fit
            { fitness: 10, violation: 0 },     // feasible, low fit
            { fitness: 500, violation: 0.1 },  // infeasible, mid
            { fitness: 100, violation: 0 },    // feasible, mid
        ];
        arr.sort(compareIndividuals);
        expect(arr.map((x) => x.fitness)).toEqual([100, 10, 1000, 500]);
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/utils/autogear/__tests__/individualComparator.test.ts`
Expected: fails with missing module error.

- [ ] **Step 3: Implement `compareIndividuals`**

Create `src/utils/autogear/individualComparator.ts`:

```ts
/**
 * Minimal shape needed for feasibility-ranked comparison.
 * GeneticStrategy's Individual (with equipment) is assignable to this.
 */
export interface FeasibilityRanked {
    fitness: number;
    violation: number;
}

/**
 * Deb's feasibility rule.
 *
 * 1. Feasible (violation === 0) always beats infeasible, ignoring fitness.
 * 2. Among feasible individuals, higher fitness ranks first.
 * 3. Among infeasible individuals, lower violation ranks first;
 *    fitness is a tiebreaker when violations are identical.
 *
 * Usage: pass as an Array.prototype.sort comparator. Return < 0 means a
 * ranks before b; return > 0 means b ranks before a.
 */
export function compareIndividuals(
    a: FeasibilityRanked,
    b: FeasibilityRanked
): number {
    const aFeasible = a.violation === 0;
    const bFeasible = b.violation === 0;
    if (aFeasible && !bFeasible) return -1;
    if (!aFeasible && bFeasible) return 1;
    if (aFeasible && bFeasible) return b.fitness - a.fitness;
    if (a.violation !== b.violation) return a.violation - b.violation;
    return b.fitness - a.fitness;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/utils/autogear/__tests__/individualComparator.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autogear/individualComparator.ts src/utils/autogear/__tests__/individualComparator.test.ts
git commit -m "feat(autogear): add feasibility-ranked individual comparator with tests"
```

---

## Task 4: Introduce `AutogearResult` return shape

**Files:**
- Modify: `src/utils/autogear/AutogearStrategy.ts`
- Modify: `src/utils/autogear/BaseStrategy.ts:21-31`

- [ ] **Step 1: Add `AutogearResult` interface and update method signature**

Replace `src/utils/autogear/AutogearStrategy.ts` contents with:

```ts
import type { Ship } from '../../types/ship';
import type { GearPiece } from '../../types/gear';
import type {
    StatPriority,
    GearSuggestion,
    SetPriority,
    StatBonus,
} from '../../types/autogear';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { EngineeringStat, StatName } from '../../types/stats';

export interface HardRequirementViolation {
    stat: StatName;
    kind: 'min' | 'max';
    limit: number;
    actual: number;
}

export interface AutogearResult {
    suggestions: GearSuggestion[];
    hardRequirementsMet: boolean;
    /** Only populated when hardRequirementsMet === false. */
    violations?: HardRequirementViolation[];
    /** 1..5 — how many GA passes were run. 1 for strategies without reruns. */
    attempts: number;
}

export interface AutogearProgress {
    current: number;
    total: number;
    percentage: number;
    /** Set by strategies that run multiple attempts; otherwise omitted. */
    attempt?: number;
    maxAttempts?: number;
}

export interface AutogearStrategy {
    name: string;
    description: string;
    findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Promise<AutogearResult> | AutogearResult;
    setProgressCallback(callback: (progress: AutogearProgress) => void): void;
}

export enum AutogearAlgorithm {
    TwoPass = 'twoPass',
    SetFirst = 'setFirst',
    BeamSearch = 'beamSearch',
    Genetic = 'genetic',
}
```

- [ ] **Step 2: Update `BaseStrategy` abstract signature and progress shape**

In `src/utils/autogear/BaseStrategy.ts`:

- Update imports at the top to include `AutogearResult` and `AutogearProgress`:

```ts
import { AutogearStrategy, AutogearResult, AutogearProgress } from './AutogearStrategy';
```

- Change the `progressCallback` field type (line 12-16) to use `AutogearProgress`.
- Change the abstract signature (line 21-31) to return `Promise<AutogearResult> | AutogearResult`.
- Change `setProgressCallback` parameter (line 33-37) to take `AutogearProgress`.
- Change the inline progress objects inside `updateProgress` (line 39-49) and `completeProgress` (line 62-71) to pass `AutogearProgress` (they already match shape-wise, just annotated).

Final state of `BaseStrategy.ts` abstract method and progress typing:

```ts
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { EngineeringStat } from '../../types/stats';
import { AutogearStrategy, AutogearResult, AutogearProgress } from './AutogearStrategy';

export abstract class BaseStrategy implements AutogearStrategy {
    abstract name: string;
    abstract description: string;

    protected progressCallback?: (progress: AutogearProgress) => void;
    protected totalOperations: number = 0;
    protected currentOperation: number = 0;
    protected readonly PROGRESS_UPDATE_INTERVAL = 50000;

    abstract findOptimalGear(
        ship: Ship,
        priorities: StatPriority[],
        inventory: GearPiece[],
        getGearPiece: (id: string) => GearPiece | undefined,
        getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
        shipRole?: ShipTypeName,
        setPriorities?: SetPriority[],
        statBonuses?: StatBonus[],
        tryToCompleteSets?: boolean,
        arenaModifiers?: Record<string, number> | null
    ): Promise<AutogearResult> | AutogearResult;

    public setProgressCallback(callback: (progress: AutogearProgress) => void) {
        this.progressCallback = callback;
    }

    // ...rest unchanged
}
```

Note: `GearSuggestion` remains an import for subclasses that still use it.

- [ ] **Step 3: Run lint + typecheck**

Run: `npm run lint`
Expected: failures in `GeneticStrategy.ts`, `BeamSearchStrategy.ts`, `TwoPassStrategy.ts`, `SetFirstStrategy.ts`, and `AutogearPage.tsx` because their return types no longer match. This is expected — we'll fix them in the next tasks.

- [ ] **Step 4: Commit (WIP marker — compilation is intentionally broken here)**

```bash
git add src/utils/autogear/AutogearStrategy.ts src/utils/autogear/BaseStrategy.ts
git commit -m "refactor(autogear): introduce AutogearResult return shape"
```

---

## Task 5: Update non-Genetic strategies to return `AutogearResult`

**Files:**
- Modify: `src/utils/autogear/strategies/BeamSearchStrategy.ts`
- Modify: `src/utils/autogear/strategies/TwoPassStrategy.ts:74-81`
- Modify: `src/utils/autogear/strategies/SetFirstStrategy.ts`

These strategies are not user-selectable (only `Genetic` is exposed in the UI) but they are still registered in `getStrategy.ts` and must compile. They don't evaluate hard requirements — they simply wrap their existing suggestion array in the new shape with `hardRequirementsMet: true` and `attempts: 1`.

- [ ] **Step 1: Wrap `TwoPassStrategy` return**

In `src/utils/autogear/strategies/TwoPassStrategy.ts`, update the `findOptimalGear` return (around lines 74-81) from:

```ts
return Object.entries(finalEquipment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([slotName, gearId]) => ({
        slotName,
        gearId,
        score: 0,
    }));
```

to:

```ts
const suggestions = Object.entries(finalEquipment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([slotName, gearId]) => ({
        slotName,
        gearId,
        score: 0,
    }));

return {
    suggestions,
    hardRequirementsMet: true,
    attempts: 1,
};
```

- [ ] **Step 2: Repeat the same wrapping for `BeamSearchStrategy` and `SetFirstStrategy`**

Open each file and locate the `findOptimalGear` return statement. Extract the suggestions array into a variable, then return the `AutogearResult` shape with `hardRequirementsMet: true, attempts: 1`.

If the existing return type is inferred (not annotated explicitly), the wrapping compiles without other changes. Verify the `Promise<AutogearResult>` signature is satisfied by updating any explicit `Promise<GearSuggestion[]>` annotations to `Promise<AutogearResult>`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: the three non-Genetic strategies pass. `GeneticStrategy.ts` and `AutogearPage.tsx` still fail — fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/utils/autogear/strategies/BeamSearchStrategy.ts src/utils/autogear/strategies/TwoPassStrategy.ts src/utils/autogear/strategies/SetFirstStrategy.ts
git commit -m "refactor(autogear): adapt non-Genetic strategies to AutogearResult shape"
```

---

## Task 6: Extend `Individual` with `violation` and thread comparator through `GeneticStrategy`

**Files:**
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`

This task swaps every raw-fitness comparison in `GeneticStrategy` for `compareIndividuals`, and computes `violation` during evaluation. The rerun loop and new return shape come in Task 7.

- [ ] **Step 1: Update imports and `Individual` interface**

In `src/utils/autogear/strategies/GeneticStrategy.ts`:

- Update imports at the top (currently line 1-9):

```ts
import { AutogearStrategy, AutogearResult, HardRequirementViolation } from '../AutogearStrategy';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { StatPriority, GearSuggestion, SetPriority, StatBonus } from '../../../types/autogear';
import { GEAR_SLOTS, GearSlotName, ShipTypeName } from '../../../constants';
import { BaseStats, EngineeringStat, StatName } from '../../../types/stats';
import { calculateTotalScore, calculateHardViolation, clearScoreCache } from '../scoring';
import { calculateTotalStats } from '../../ship/statsCalculator';
import { compareIndividuals } from '../individualComparator';
import { BaseStrategy } from '../BaseStrategy';
import { performanceTracker } from '../performanceTimer';
import { applyArenaModifiers } from '../arenaModifiers';
```

- Update the `Individual` interface (line 11-14):

```ts
interface Individual {
    equipment: Partial<Record<GearSlotName, string>>;
    fitness: number;
    violation: number;
}
```

- [ ] **Step 2: Compute violation alongside fitness in `calculateFitness`**

Replace the `calculateFitness` method so it returns `{ fitness, violation }` instead of just `fitness`:

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
    arenaModifiers?: Record<string, number> | null
): { fitness: number; violation: number } {
    performanceTracker.startTimer('CalculateFitness');

    const gearOnly: Partial<Record<GearSlotName, string>> = {};
    const implantsOnly: Partial<Record<GearSlotName, string>> = {};

    Object.entries(equipment).forEach(([slot, gearId]) => {
        if (slot.startsWith('implant_')) {
            implantsOnly[slot] = gearId;
        } else {
            gearOnly[slot] = gearId;
        }
    });

    const hasImplantSlots = Object.keys(implantsOnly).length > 0;
    const shipWithNewImplants: Ship = hasImplantSlots
        ? { ...ship, implants: implantsOnly }
        : ship;

    const fitness = calculateTotalScore(
        shipWithNewImplants,
        gearOnly,
        priorities,
        getGearPiece,
        getEngineeringStatsForShipType,
        shipRole,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arenaModifiers
    );

    // Compute violation from the same post-modifier stats that calculateTotalScore uses.
    const totalStats = calculateTotalStats(
        shipWithNewImplants.baseStats,
        gearOnly,
        getGearPiece,
        shipWithNewImplants.refits,
        shipWithNewImplants.implants,
        getEngineeringStatsForShipType(shipWithNewImplants.type),
        shipWithNewImplants.id
    );
    const statsForViolation =
        arenaModifiers && Object.keys(arenaModifiers).length > 0
            ? applyArenaModifiers(totalStats.final, arenaModifiers)
            : totalStats.final;
    const violation = calculateHardViolation(statsForViolation, priorities);

    performanceTracker.endTimer('CalculateFitness');
    return { fitness, violation };
}
```

Note: `calculateTotalStats` is cached inside itself via `ship.id`-keyed cache (see `statsCalculator.ts`), so calling it here after `calculateTotalScore` (which also calls it) is a cache hit, not a duplicate computation.

- [ ] **Step 3: Update `evaluatePopulation` to consume the new return shape and sort with comparator**

Replace the body of `evaluatePopulation`:

```ts
private evaluatePopulation(
    population: Individual[],
    ship: Ship,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null
): Individual[] {
    performanceTracker.startTimer('EvaluatePopulation');

    const result = population
        .map((individual) => {
            const { fitness, violation } = this.calculateFitness(
                individual.equipment,
                ship,
                priorities,
                getGearPiece,
                getEngineeringStatsForShipType,
                shipRole,
                setPriorities,
                statBonuses,
                tryToCompleteSets,
                arenaModifiers
            );
            return { ...individual, fitness, violation };
        })
        .sort(compareIndividuals);

    performanceTracker.endTimer('EvaluatePopulation');
    return result;
}
```

- [ ] **Step 4: Update `initializePopulation` to set `violation: 0`**

In `initializePopulation` (line 206-232), update the individual push to set `violation: 0` initially (gets overwritten during `evaluatePopulation`):

```ts
population.push({ equipment, fitness: 0, violation: 0 });
```

- [ ] **Step 5: Update `selectParent` (tournament) to use comparator**

Replace the reducer in `selectParent` (line 326-335):

```ts
private selectParent(population: Individual[]): Individual {
    const tournamentSize = 3;
    const tournament = Array(tournamentSize)
        .fill(null)
        .map(() => population[Math.floor(Math.random() * population.length)]);
    return tournament.reduce((best, current) =>
        compareIndividuals(current, best) < 0 ? current : best
    );
}
```

- [ ] **Step 6: Update `crossover` weighting to use comparator**

Replace the weighted-choice block in `crossover` (around line 346-354):

```ts
private crossover(parent1: Individual, parent2: Individual): Individual {
    const childEquipment: Partial<Record<GearSlotName, string>> = {};

    const allSlots = new Set([
        ...Object.keys(parent1.equipment),
        ...Object.keys(parent2.equipment),
    ]);

    // Feasibility-ranked parent preference instead of raw fitness ratio.
    const parent1IsBetter = compareIndividuals(parent1, parent2) < 0;
    const parent1Weight = parent1IsBetter ? 0.7 : 0.3;

    allSlots.forEach((slot) => {
        const useParent1 = Math.random() < parent1Weight;
        childEquipment[slot] = useParent1 ? parent1.equipment[slot] : parent2.equipment[slot];
    });

    return { equipment: childEquipment, fitness: 0, violation: 0 };
}
```

- [ ] **Step 7: Update early-termination check to use comparator**

In `findOptimalGear`, locate the improvement check (currently around line 137-184). Replace the fitness-based comparison (`currentBestFitness > bestFitness`) with a comparator-based one. This is the cleanest version of that loop:

```ts
// Inside findOptimalGear's generation loop (leave the surrounding timers/awaits intact):
let bestIndividual: Individual = population[0];
let generationsWithoutImprovement = 0;
const maxGenerationsWithoutImprovement = Math.max(15, Math.floor(generations * 0.3));

for (let generation = 0; generation < generations; generation++) {
    const newPopulation: Individual[] = [];
    newPopulation.push(...population.slice(0, eliteSize));

    performanceTracker.startTimer('Breeding');
    while (newPopulation.length < populationSize) {
        const parent1 = this.selectParent(population);
        const parent2 = this.selectParent(population);
        const child = this.crossover(parent1, parent2);
        this.mutate(child, availableInventory, cachedGetGearPiece, setPriorities);
        newPopulation.push(child);
        this.incrementProgress();
    }
    performanceTracker.endTimer('Breeding');

    performanceTracker.startTimer('Evaluation');
    population = this.evaluatePopulation(
        newPopulation,
        ship,
        priorities,
        cachedGetGearPiece,
        getEngineeringStatsForShipType,
        shipRole,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arenaModifiers
    );
    performanceTracker.endTimer('Evaluation');

    const currentBest = population[0];
    if (compareIndividuals(currentBest, bestIndividual) < 0) {
        bestIndividual = currentBest;
        generationsWithoutImprovement = 0;
    } else {
        generationsWithoutImprovement++;
        if (generationsWithoutImprovement >= maxGenerationsWithoutImprovement) {
            break;
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
}
```

(The `bestIndividual` tracker replaces the pair of `bestFitness` / separate best ref. We'll use it in Task 7 as the starting point for the rerun loop.)

- [ ] **Step 8: Return the existing result shape as a stopgap**

**This is a temporary step** — Task 7 replaces this with `AutogearResult` and the rerun loop. For now, make the code compile by constructing a minimal `AutogearResult`:

At the bottom of `findOptimalGear`, replace the existing return (around line 196-203) with:

```ts
return {
    suggestions: Object.entries(bestIndividual.equipment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([slotName, gearId]) => ({
            slotName,
            gearId,
            score: bestIndividual.fitness,
        })),
    hardRequirementsMet: bestIndividual.violation === 0,
    attempts: 1,
};
```

- [ ] **Step 9: Run lint**

Run: `npm run lint`
Expected: `GeneticStrategy.ts` passes. `AutogearPage.tsx` still fails (next task).

- [ ] **Step 10: Commit**

```bash
git add src/utils/autogear/strategies/GeneticStrategy.ts
git commit -m "refactor(autogear): thread feasibility comparator through GeneticStrategy"
```

---

## Task 7: Add rerun loop with up to 5 attempts + violation reporting

**Files:**
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts:findOptimalGear`

- [ ] **Step 1: Extract the single-pass body into a private method**

Inside `GeneticStrategy`, create a private method `runSingleGAPass` containing everything currently between `performanceTracker.startTimer('InitializePopulation')` and the `performanceTracker.endTimer('GeneticGenerations')` (inclusive of the generation loop and the best-individual tracking from Task 6 Step 7). It should return the best `Individual` for that pass.

`performanceTracker.reset()` and `clearScoreCache()` stay at the top of `findOptimalGear` (called once per `findOptimalGear` invocation, not per attempt) — the cache is valid across attempts per the spec.

```ts
private async runSingleGAPass(
    ship: Ship,
    priorities: StatPriority[],
    availableInventory: GearPiece[],
    cachedGetGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole: ShipTypeName | undefined,
    setPriorities: SetPriority[] | undefined,
    statBonuses: StatBonus[] | undefined,
    tryToCompleteSets: boolean | undefined,
    arenaModifiers: Record<string, number> | null | undefined,
    populationSize: number,
    generations: number,
    eliteSize: number
): Promise<Individual> {
    performanceTracker.startTimer('InitializePopulation');
    let population = this.initializePopulation(
        availableInventory,
        cachedGetGearPiece,
        setPriorities,
        populationSize
    );
    performanceTracker.endTimer('InitializePopulation');

    performanceTracker.startTimer('InitialEvaluation');
    population = this.evaluatePopulation(
        population,
        ship,
        priorities,
        cachedGetGearPiece,
        getEngineeringStatsForShipType,
        shipRole,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arenaModifiers
    );
    performanceTracker.endTimer('InitialEvaluation');

    let bestIndividual: Individual = population[0];
    let generationsWithoutImprovement = 0;
    const maxGenerationsWithoutImprovement = Math.max(15, Math.floor(generations * 0.3));

    performanceTracker.startTimer('GeneticGenerations');
    for (let generation = 0; generation < generations; generation++) {
        const newPopulation: Individual[] = [];
        newPopulation.push(...population.slice(0, eliteSize));

        performanceTracker.startTimer('Breeding');
        while (newPopulation.length < populationSize) {
            const parent1 = this.selectParent(population);
            const parent2 = this.selectParent(population);
            const child = this.crossover(parent1, parent2);
            this.mutate(child, availableInventory, cachedGetGearPiece, setPriorities);
            newPopulation.push(child);
            this.incrementProgress();
        }
        performanceTracker.endTimer('Breeding');

        performanceTracker.startTimer('Evaluation');
        population = this.evaluatePopulation(
            newPopulation,
            ship,
            priorities,
            cachedGetGearPiece,
            getEngineeringStatsForShipType,
            shipRole,
            setPriorities,
            statBonuses,
            tryToCompleteSets,
            arenaModifiers
        );
        performanceTracker.endTimer('Evaluation');

        const currentBest = population[0];
        if (compareIndividuals(currentBest, bestIndividual) < 0) {
            bestIndividual = currentBest;
            generationsWithoutImprovement = 0;
        } else {
            generationsWithoutImprovement++;
            if (generationsWithoutImprovement >= maxGenerationsWithoutImprovement) {
                break;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    performanceTracker.endTimer('GeneticGenerations');

    return bestIndividual;
}
```

- [ ] **Step 2: Add a helper to compute per-stat violations from the final combo**

Inside `GeneticStrategy`, add:

```ts
private computeViolations(
    equipment: Partial<Record<GearSlotName, string>>,
    ship: Ship,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    arenaModifiers: Record<string, number> | null | undefined
): HardRequirementViolation[] {
    const gearOnly: Partial<Record<GearSlotName, string>> = {};
    const implantsOnly: Partial<Record<GearSlotName, string>> = {};
    Object.entries(equipment).forEach(([slot, gearId]) => {
        if (slot.startsWith('implant_')) implantsOnly[slot] = gearId;
        else gearOnly[slot] = gearId;
    });
    const hasImplantSlots = Object.keys(implantsOnly).length > 0;
    const shipForStats: Ship = hasImplantSlots ? { ...ship, implants: implantsOnly } : ship;

    const totalStats = calculateTotalStats(
        shipForStats.baseStats,
        gearOnly,
        getGearPiece,
        shipForStats.refits,
        shipForStats.implants,
        getEngineeringStatsForShipType(shipForStats.type),
        shipForStats.id
    );
    const stats =
        arenaModifiers && Object.keys(arenaModifiers).length > 0
            ? applyArenaModifiers(totalStats.final, arenaModifiers)
            : totalStats.final;

    const violations: HardRequirementViolation[] = [];
    for (const p of priorities) {
        if (!p.hardRequirement) continue;
        const value = stats[p.stat] || 0;
        if (p.minLimit && value < p.minLimit) {
            violations.push({ stat: p.stat, kind: 'min', limit: p.minLimit, actual: value });
        }
        if (p.maxLimit && value > p.maxLimit) {
            violations.push({ stat: p.stat, kind: 'max', limit: p.maxLimit, actual: value });
        }
    }
    return violations;
}
```

- [ ] **Step 3: Replace `findOptimalGear` body with the rerun loop**

Replace the body of `findOptimalGear` (leave the signature, `performanceTracker.reset()`, `clearScoreCache()`, and `cachedGetGearPiece` setup). New body below the `cachedGetGearPiece` definition:

```ts
const hasImplants = availableInventory.some((gear) => gear.slot.startsWith('implant_'));
const populationSize = this.getPopulationSize(availableInventory.length, hasImplants);
const generations = this.getGenerations(populationSize, hasImplants);
const eliteSize = this.getEliteSize(populationSize);

const MAX_ATTEMPTS = 5;
const hasHardRequirements = priorities.some((p) => p.hardRequirement);
const attemptCount = hasHardRequirements ? MAX_ATTEMPTS : 1;

// Size the progress bar for a single attempt. Each attempt resets progress
// via initializeProgress so the bar restarts for reruns.
let overallBest: Individual | null = null;
let attempts = 0;

for (let attempt = 1; attempt <= attemptCount; attempt++) {
    attempts = attempt;
    this.initializeProgress(populationSize * generations);
    this.emitAttemptProgress(attempt, attemptCount);

    const bestOfThisRun = await this.runSingleGAPass(
        ship,
        priorities,
        availableInventory,
        cachedGetGearPiece,
        getEngineeringStatsForShipType,
        shipRole,
        setPriorities,
        statBonuses,
        tryToCompleteSets,
        arenaModifiers,
        populationSize,
        generations,
        eliteSize
    );

    if (overallBest === null || compareIndividuals(bestOfThisRun, overallBest) < 0) {
        overallBest = bestOfThisRun;
    }
    if (overallBest.violation === 0) break;
}

this.completeProgress();
performanceTracker.endTimer('GeneticAlgorithm');

const best = overallBest!;
const hardRequirementsMet = best.violation === 0;
const result: AutogearResult = {
    suggestions: Object.entries(best.equipment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([slotName, gearId]) => ({
            slotName,
            gearId,
            score: best.fitness,
        })),
    hardRequirementsMet,
    attempts,
};
if (!hardRequirementsMet) {
    result.violations = this.computeViolations(
        best.equipment,
        ship,
        priorities,
        cachedGetGearPiece,
        getEngineeringStatsForShipType,
        arenaModifiers
    );
}
return result;
```

- [ ] **Step 4: Add `emitAttemptProgress` helper**

Add this private method inside `GeneticStrategy` (and import `AutogearProgress` from `../AutogearStrategy` at the top):

```ts
private emitAttemptProgress(attempt: number, maxAttempts: number): void {
    if (!this.progressCallback) return;
    this.progressCallback({
        current: 0,
        total: this.totalOperations,
        percentage: 0,
        attempt,
        maxAttempts,
    });
}
```

Also update `BaseStrategy.updateProgress` to forward `attempt`/`maxAttempts` when set. Add two protected fields to `BaseStrategy`:

```ts
// In BaseStrategy.ts, add near other protected fields:
protected currentAttempt?: number;
protected maxAttempts?: number;

// Update updateProgress() to include them:
protected updateProgress() {
    if (this.progressCallback && this.totalOperations > 0) {
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
}
```

And in `GeneticStrategy.emitAttemptProgress`, set `this.currentAttempt = attempt; this.maxAttempts = maxAttempts;` before calling the callback, so subsequent `incrementProgress` calls (driven from `BaseStrategy`) carry the attempt metadata:

```ts
private emitAttemptProgress(attempt: number, maxAttempts: number): void {
    this.currentAttempt = attempt;
    this.maxAttempts = maxAttempts;
    if (!this.progressCallback) return;
    this.progressCallback({
        current: 0,
        total: this.totalOperations,
        percentage: 0,
        attempt,
        maxAttempts,
    });
}
```

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: `GeneticStrategy.ts` and `BaseStrategy.ts` pass. `AutogearPage.tsx` still fails — next task.

- [ ] **Step 6: Commit**

```bash
git add src/utils/autogear/strategies/GeneticStrategy.ts src/utils/autogear/BaseStrategy.ts
git commit -m "feat(autogear): rerun GA up to 5 attempts when hard requirements unmet"
```

---

## Task 8: Integration smoke tests for `GeneticStrategy`

**Files:**
- Create: `src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts`

These tests validate the strategy's return contract (not convergence correctness). They're designed to be deterministic by:
1. Using a tiny inventory where nearly all combos satisfy an easy requirement.
2. Using an obviously-impossible requirement for the infeasibility path.
3. Not asserting specific gear IDs — only the shape and feasibility flag.

- [ ] **Step 1: Write the tests**

Create `src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GeneticStrategy } from '../GeneticStrategy';
import { Ship } from '../../../../types/ship';
import { GearPiece } from '../../../../types/gear';
import { StatPriority } from '../../../../types/autogear';
import { clearScoreCache } from '../../scoring';
import { BaseStats, EngineeringStat } from '../../../../types/stats';
import { ShipTypeName } from '../../../../constants/shipTypes';

const BASE: BaseStats = {
    hp: 100000,
    attack: 5000,
    defence: 4000,
    speed: 100,
    hacking: 0,
    security: 0,
    crit: 30,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

function makeGear(id: string, slot: string, stat: keyof BaseStats, amount: number): GearPiece {
    return {
        id,
        slot: slot as GearPiece['slot'],
        level: 16,
        stars: 6,
        rarity: 'legendary',
        setBonus: null,
        mainStat: { name: stat, value: amount, type: 'flat' } as GearPiece['mainStat'],
        subStats: [],
    } as GearPiece;
}

function makeShip(): Ship {
    return {
        id: 'ship1',
        name: 'Test Ship',
        type: 'ATTACKER' as ShipTypeName,
        rarity: 'legendary',
        faction: 'TERRAN',
        level: 60,
        rank: 5,
        baseStats: { ...BASE },
        equipment: {},
        implants: {},
        refits: [],
    } as Ship;
}

describe('GeneticStrategy.findOptimalGear', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('returns AutogearResult shape', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [
            makeGear('g1', 'weapon', 'attack', 1000),
            makeGear('g2', 'hull', 'hp', 10000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const priorities: StatPriority[] = [{ stat: 'attack', weight: 1 }];

        const result = await strategy.findOptimalGear(
            ship,
            priorities,
            inventory,
            getGearPiece,
            getEng
        );

        expect(result).toHaveProperty('suggestions');
        expect(result).toHaveProperty('hardRequirementsMet');
        expect(result).toHaveProperty('attempts');
        expect(result.attempts).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('reports hardRequirementsMet === true and attempts === 1 when no hard priorities', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [makeGear('g1', 'weapon', 'attack', 1000)];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            ship,
            [{ stat: 'attack', weight: 1, minLimit: 1000 }], // soft, not hard
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.hardRequirementsMet).toBe(true);
        expect(result.attempts).toBe(1);
        expect(result.violations).toBeUndefined();
    });

    it('reports hardRequirementsMet === false and returns violations when impossible', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [
            makeGear('g1', 'weapon', 'attack', 100),
            makeGear('g2', 'hull', 'hp', 100),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        // Ship attack maxes at ~5100. Hard req min=100000 is impossible.
        const priorities: StatPriority[] = [
            { stat: 'attack', minLimit: 100000, hardRequirement: true },
        ];

        const result = await strategy.findOptimalGear(
            ship,
            priorities,
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.hardRequirementsMet).toBe(false);
        expect(result.attempts).toBe(5);
        expect(result.violations).toBeDefined();
        expect(result.violations?.length).toBeGreaterThan(0);
        expect(result.violations?.[0]).toMatchObject({
            stat: 'attack',
            kind: 'min',
            limit: 100000,
        });
        expect(result.violations?.[0].actual).toBeLessThan(100000);
    });
});
```

- [ ] **Step 2: Run tests and verify**

Run: `npx vitest run src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts`
Expected: all three tests pass. Runtime under ~5 seconds with a tiny inventory.

If any test is flaky on repeat runs (genetic is stochastic), reduce the population size further by shrinking the inventory, or add test-specific seeding. Don't ship a flaky test.

If the `as GearPiece` / `as Ship` casts in `makeGear` / `makeShip` fail to compile because the real types have additional required fields, widen the escape hatch to `as unknown as GearPiece` / `as unknown as Ship`. The fixtures only need to satisfy the properties the GA touches.

- [ ] **Step 3: Commit**

```bash
git add src/utils/autogear/strategies/__tests__/GeneticStrategy.test.ts
git commit -m "test(autogear): integration tests for GeneticStrategy hard requirements"
```

---

## Task 9: Add "Hard Requirement 2" checkbox to `StatPriorityForm`

**Files:**
- Modify: `src/components/stats/StatPriorityForm.tsx`

- [ ] **Step 1: Add `Checkbox` import and new state**

At the top of `StatPriorityForm.tsx`:

```ts
import { Button, Checkbox, Input, Select, Tooltip } from '../ui';
import { useRef } from 'react';  // merge with existing useState import
```

Inside the component, add:

```ts
const [hardRequirement, setHardRequirement] = useState<boolean>(false);
const [showHardTooltip, setShowHardTooltip] = useState<boolean>(false);
const hardLabelRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Include `hardRequirement` in `onAdd` and reset on submit**

Update `handleSubmit` (around lines 40-56). The new field should only be `true` when at least one of min/max was filled AND the checkbox is checked. Otherwise pass `undefined` (matches optional semantics):

```ts
const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const hasLimit = (!hideMinLimit && !!minLimit) || (!hideMaxLimit && !!maxLimit);
    const hardFlag = hasLimit && hardRequirement ? true : undefined;

    onAdd({
        stat: selectedStat,
        maxLimit: hideMaxLimit ? undefined : maxLimit ? Number(maxLimit) : undefined,
        minLimit: hideMinLimit ? undefined : minLimit ? Number(minLimit) : undefined,
        weight: hideWeight ? 1 : weight,
        hardRequirement: hardFlag,
    });

    setMaxLimit('');
    setMinLimit('');
    setHardRequirement(false);
    if (!hideWeight) {
        setWeight(existingPriorities.length > 0 ? existingPriorities.length + 1 : 1);
    }
    setSelectedStat(AVAILABLE_STATS[0]);
};
```

- [ ] **Step 3: Add the checkbox to the form JSX**

Below the Min/Max grid (`</div>` after line 107) and before the Add button section, insert:

```tsx
{(!hideMinLimit || !hideMaxLimit) && (
    <div className="mt-4">
        <div
            ref={hardLabelRef}
            onMouseEnter={() => setShowHardTooltip(true)}
            onMouseLeave={() => setShowHardTooltip(false)}
            className="inline-block"
        >
            <Checkbox
                id="hardRequirement"
                label="Hard Requirement 2"
                checked={hardRequirement}
                onChange={setHardRequirement}
                disabled={!minLimit && !maxLimit}
                helpLabel="Force the optimizer to meet this limit. Unlike soft limits, hard requirements are must-meet — the optimizer will retry up to 5 times and fall back to the closest result if no combo can satisfy them."
            />
        </div>
        <Tooltip
            isVisible={showHardTooltip && hardRequirement}
            targetElement={hardLabelRef.current}
            className="bg-dark border border-dark-lighter p-2"
        >
            <p className="text-xs">this time it&apos;s personal</p>
        </Tooltip>
    </div>
)}
```

The checkbox is disabled until at least one of min/max is filled (matches the `handleSubmit` guard).

- [ ] **Step 4: Manually test the form in the browser**

Start dev server if not running: `npm start`

Navigate to the Autogear page, expand the priority form, set a min value, tick the checkbox — verify the tooltip appears on hover and the checkbox is enabled/disabled correctly based on min/max values. Submit once with and once without the checkbox checked.

- [ ] **Step 5: Commit**

```bash
git add src/components/stats/StatPriorityForm.tsx
git commit -m "feat(autogear): add hard requirement checkbox to stat priority form"
```

---

## Task 10: Display "— Hard Requirement 2" suffix in priority list

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx:402-428`

- [ ] **Step 1: Add the suffix + tooltip to each priority row**

Locate the stat priority rendering block (around lines 402-428). The row currently reads:

```tsx
<span>
    {STATS[priority.stat].label}
    {priority.minLimit && ` (min: ${priority.minLimit})`}
    {priority.maxLimit && ` (max: ${priority.maxLimit})`}
    {priority.weight && priority.weight !== 1 && ` (weight: ${priority.weight})`}
</span>
```

We need a per-row tooltip, which means extracting the row into a small local component (cleaner than managing tooltip state for a variable number of rows). Above the `AutogearSettings` component definition (below `SetPriorityForm`), add:

```tsx
import { Tooltip } from '../ui';
import { StatPriority } from '../../types/autogear';

const StatPriorityRow: React.FC<{
    priority: StatPriority;
    onRemove: () => void;
}> = ({ priority, onRemove }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const hardRef = useRef<HTMLSpanElement>(null);

    return (
        <div className="flex items-center text-sm">
            <span>
                {STATS[priority.stat].label}
                {priority.minLimit && ` (min: ${priority.minLimit})`}
                {priority.maxLimit && ` (max: ${priority.maxLimit})`}
                {priority.weight && priority.weight !== 1 && ` (weight: ${priority.weight})`}
                {priority.hardRequirement && (
                    <>
                        {' '}
                        <span
                            ref={hardRef}
                            onMouseEnter={() => setShowTooltip(true)}
                            onMouseLeave={() => setShowTooltip(false)}
                            className="text-amber-400 cursor-help"
                        >
                            — Hard Requirement 2
                        </span>
                        <Tooltip
                            isVisible={showTooltip}
                            targetElement={hardRef.current}
                            className="bg-dark border border-dark-lighter p-2"
                        >
                            <p className="text-xs">this time it&apos;s personal</p>
                        </Tooltip>
                    </>
                )}
            </span>
            <Button
                aria-label="Remove priority"
                variant="danger"
                size="sm"
                onClick={onRemove}
                className="ml-auto"
            >
                <CloseIcon />
            </Button>
        </div>
    );
};
```

Ensure `useState`, `useRef` are imported from React (already imported at the top). Import `Tooltip` if not already (check existing imports — it's already imported at the top of the file).

Replace the existing `.map` over `priorities` (around lines 405-425) with:

```tsx
{priorities.map((priority, index) => (
    <StatPriorityRow
        key={index}
        priority={priority}
        onRemove={() => onRemovePriority(index)}
    />
))}
```

- [ ] **Step 2: Manually verify in the browser**

Add a priority with `Hard Requirement 2` checked, confirm the amber suffix appears in the list below, and hover over it to see the tooltip.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat(autogear): show hard requirement indicator in priority list"
```

---

## Task 11: Wire `AutogearPage` to `AutogearResult` and filter soft warning

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Update imports and state types**

At the top of the file, extend the autogear-types import and add one for the new types:

```ts
import { GearSuggestion, StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { AutogearResult, HardRequirementViolation } from '../../utils/autogear/AutogearStrategy';
```

Locate the inline `shipResults` state declaration (currently at `AutogearPage.tsx:125-138`). It's an inline `useState<Record<string, { ... }>>`. Add three fields to the inner object literal:

```ts
const [shipResults, setShipResults] = useState<
    Record<
        string,
        {
            suggestions: GearSuggestion[];
            currentSimulation: SimulationSummary | null;
            suggestedSimulation: SimulationSummary | null;
            arenaSimulation: SimulationSummary | null;
            currentStats: StatBreakdown;
            suggestedStats: StatBreakdown;
            arenaModifiers: Record<string, number> | null;
            hardRequirementsMet: boolean;
            hardViolations?: HardRequirementViolation[];
            attempts: number;
        }
    >
>({});
```

Similarly update the inline `allResults` declaration (currently at `AutogearPage.tsx:343-354`) with the same three added fields, since `allResults` is the per-run accumulator that gets passed to `setShipResults`.

- [ ] **Step 2: Update the strategy call site to destructure `AutogearResult`**

Around line 518-533 (the `strategy.findOptimalGear` call), change:

```ts
const newSuggestions = await Promise.resolve(
    strategy.findOptimalGear(...)
);
```

to:

```ts
const strategyResult = await Promise.resolve(
    strategy.findOptimalGear(
        ship,
        shipConfig.statPriorities,
        filteredInventory,
        getGearForShip,
        getEngineeringStatsForShipType,
        shipConfig.shipRole || undefined,
        shipConfig.setPriorities,
        shipConfig.statBonuses,
        shipConfig.tryToCompleteSets,
        arenaModifiers
    )
);
const newSuggestions = strategyResult.suggestions;
```

- [ ] **Step 3: Persist feasibility metadata in per-ship results**

When building the per-ship result object (search for where `newSuggestions` gets assembled into the result), add the three fields:

```ts
// Inside the per-ship result construction:
shipResults[ship.id] = {
    // ...existing fields,
    suggestions: newSuggestions,
    hardRequirementsMet: strategyResult.hardRequirementsMet,
    hardViolations: strategyResult.violations,
    attempts: strategyResult.attempts,
};
```

- [ ] **Step 4: Filter existing `getUnmetPriorities` to exclude hard-flagged priorities**

Around line 732-759, update `getUnmetPriorities`:

```ts
const getUnmetPriorities = (stats: BaseStats, shipId?: string): UnmetPriority[] => {
    const unmet: UnmetPriority[] = [];
    const targetShipId = shipId || selectedShips[0]?.id || '';

    getShipConfig(targetShipId).statPriorities.forEach((priority) => {
        // Hard-flagged priorities are surfaced in the GearSuggestions banner, not here.
        if (priority.hardRequirement) return;

        const currentValue = stats[priority.stat] || 0;
        // ...rest unchanged
```

- [ ] **Step 5: Extend progress callback to carry attempt info**

Progress is funneled through an existing `teamProgressCallback` wrapper (`AutogearPage.tsx:357-369`) that adds ship context (`currentShip: { name, index }`) to every update. Do NOT replace this wrapper — thread the new fields through it.

Widen the `optimizationProgress` state shape (currently at `AutogearPage.tsx:140-148`) to include optional attempt fields:

```ts
const [optimizationProgress, setOptimizationProgress] = useState<{
    current: number;
    total: number;
    percentage: number;
    currentShip: {
        name: string;
        index: number;
    };
    attempt?: number;
    maxAttempts?: number;
} | null>(null);
```

Widen the `teamProgressCallback` parameter type and forward the new fields (currently at `AutogearPage.tsx:357-369`):

```ts
const teamProgressCallback = (
    progress: {
        current: number;
        total: number;
        percentage: number;
        attempt?: number;
        maxAttempts?: number;
    },
    shipName: string,
    index: number
) => {
    setOptimizationProgress({
        ...progress,
        currentShip: {
            name: shipName,
            index: index,
        },
    });
};
```

The spread of `...progress` already forwards `attempt`/`maxAttempts` to state when present, so no further changes are needed in the callback body.

Locate the `<ProgressBar>` usage (search for `<ProgressBar`). `ProgressBar` accepts a `label` string prop (see `src/components/ui/ProgressBar.tsx`). Use it to surface attempt info when a rerun is in progress. Find the existing prop list and add:

```tsx
<ProgressBar
    // ...existing props
    label={
        optimizationProgress?.attempt && optimizationProgress.maxAttempts && optimizationProgress.attempt > 1
            ? `Attempt ${optimizationProgress.attempt} of ${optimizationProgress.maxAttempts}`
            : undefined
    }
/>
```

If the existing progress UI already passes a label for ship name / percentage, merge both: `{shipLabel}${attemptLabel ? ` — ${attemptLabel}` : ''}`. Read the current usage and adapt.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): consume AutogearResult and filter soft-warning for hard priorities"
```

---

## Task 12: Add warning banner + attempts note to `GearSuggestions`

**Files:**
- Modify: `src/components/autogear/GearSuggestions.tsx`

- [ ] **Step 1: Extend the props**

At the top of `GearSuggestions.tsx`, update the props interface:

```ts
import { HardRequirementViolation } from '../../utils/autogear/AutogearStrategy';
import { STATS } from '../../constants/stats';

interface GearSuggestionsProps {
    suggestions: GearSuggestion[];
    // ...existing fields
    hardRequirementsMet?: boolean;
    hardViolations?: HardRequirementViolation[];
    attempts?: number;
}
```

Destructure in the component:

```tsx
export const GearSuggestions: React.FC<GearSuggestionsProps> = ({
    suggestions,
    // ...existing,
    hardRequirementsMet = true,
    hardViolations,
    attempts = 1,
}) => {
```

- [ ] **Step 2: Add the banner above the suggestions content**

Inside the component's JSX, just below the existing header/container, insert (before the slot grid):

```tsx
{!hardRequirementsMet && hardViolations && hardViolations.length > 0 && (
    <div className="p-4 bg-red-900/40 border border-red-700 mb-4">
        <h4 className="text-lg font-semibold text-red-200 mb-2">
            Could not meet all hard requirements after 5 attempts
        </h4>
        <p className="text-red-100 mb-2">
            Closest result shown. Consider relaxing your hard requirements or
            acquiring gear that better fits them.
        </p>
        <ul className="list-disc pl-4 space-y-1">
            {hardViolations.map((v, i) => (
                <li key={i} className="text-red-100 text-sm">
                    {STATS[v.stat].label}: needed {v.kind} {v.limit.toLocaleString()},
                    got {v.actual.toFixed(1)}
                </li>
            ))}
        </ul>
    </div>
)}

{hardRequirementsMet && attempts > 1 && (
    <p className="text-xs text-theme-text-secondary mb-2">
        Found after {attempts} attempt{attempts === 1 ? '' : 's'}.
    </p>
)}
```

- [ ] **Step 3: Pass the new props from `AutogearPage`**

In `AutogearPage.tsx`, locate the `<GearSuggestions ... />` usage (search for `GearSuggestions` JSX). Add the three new props:

```tsx
<GearSuggestions
    // ...existing props
    hardRequirementsMet={results.hardRequirementsMet}
    hardViolations={results.hardViolations}
    attempts={results.attempts}
/>
```

- [ ] **Step 4: Manually verify the two states in the browser**

Set up two scenarios:

1. **Feasible reruns:** priorities with a hard requirement that *is* satisfiable but borderline (e.g. speed min 150 for a ship that naturally hits ~160 with optimal gear). Run autogear. If the first attempt fails occasionally, the "Found after N attempts" line should appear.
2. **Infeasible:** set a hard requirement that's impossible (e.g. attack min 1_000_000). Run autogear. Red banner with needed-vs-got list should appear.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/GearSuggestions.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat(autogear): warning banner and attempts note in GearSuggestions"
```

---

## Task 13: Add documentation paragraph

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Locate the autogear section**

Open `src/pages/DocumentationPage.tsx` and search for the autogear-related section (likely a sub-heading "Autogear" or "Gear Optimization").

- [ ] **Step 2: Add a paragraph on hard requirements**

Insert a subsection near the existing priorities/limits documentation:

```tsx
<h4>Hard Requirements</h4>
<p>
    Any min/max limit on a stat priority can be flagged as a{' '}
    <strong>Hard Requirement</strong> via the checkbox in the priority form.
    Soft limits work by penalizing the score when they're missed; the
    optimizer can still choose to miss them if the trade-off is worthwhile.
    Hard requirements are different — the optimizer is instructed to{' '}
    <em>never</em> pick a combo that violates them, if any feasible combo
    exists in your inventory.
</p>
<p>
    When the algorithm can't find a combo that meets every hard requirement
    on the first try, it retries up to five times with fresh random starting
    points. If no attempt produces a feasible combo, the closest-to-feasible
    result is shown along with a list of which requirements were missed and
    by how much — so you can adjust your limits to something your inventory
    can actually hit.
</p>
```

Adjust heading level / component markup to match the surrounding documentation style.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: document autogear hard requirements feature"
```

---

## Task 14: Full test suite + manual end-to-end check

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no regressions in existing suites.

- [ ] **Step 2: Run the lint check**

Run: `npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Start the dev server and exercise the feature end-to-end**

Run: `npm start`

In the browser (dev server is already running on hot reload):

1. Go to Autogear.
2. Pick a ship with existing gear in inventory.
3. Add a stat priority with a reasonable min value and tick "Hard Requirement 2" — verify the tooltip says "this time it's personal".
4. In the priority list below the form, verify the amber "— Hard Requirement 2" suffix appears next to the priority, and its tooltip also shows the easter egg.
5. Run Autogear. If the hard requirement is easily met, verify no banner appears and results are normal.
6. Add an impossible hard requirement (e.g. speed min 9999). Run Autogear. Verify:
    - Progress bar shows "Attempt N of 5" for attempts 2+.
    - Red "Could not meet all hard requirements after 5 attempts" banner appears above suggestions.
    - Banner lists each missed stat with needed-vs-got.
    - The original "Unmet Stat Priorities" (yellow) warning below does NOT list the hard-flagged stat.
7. Set a borderline-achievable hard requirement that might need a rerun. Run Autogear. If multiple attempts were needed but one succeeded, verify "Found after N attempts" line appears.
8. Add a soft-only min limit and run — verify existing yellow "Unmet Stat Priorities" warning still works for the soft limit.
9. Save a config with a hard requirement, reload the page, verify the flag persists (tests the JSONB round-trip).

- [ ] **Step 4: Final commit if any fixes were needed**

If manual testing surfaced fixes, commit them with appropriate messages. Otherwise skip this step.

---

## Summary of commits (expected sequence)

1. `feat(autogear): add hardRequirement field to StatPriority type`
2. `feat(autogear): add calculateHardViolation helper with tests`
3. `feat(autogear): add feasibility-ranked individual comparator with tests`
4. `refactor(autogear): introduce AutogearResult return shape`
5. `refactor(autogear): adapt non-Genetic strategies to AutogearResult shape`
6. `refactor(autogear): thread feasibility comparator through GeneticStrategy`
7. `feat(autogear): rerun GA up to 5 attempts when hard requirements unmet`
8. `test(autogear): integration tests for GeneticStrategy hard requirements`
9. `feat(autogear): add hard requirement checkbox to stat priority form`
10. `feat(autogear): show hard requirement indicator in priority list`
11. `feat(autogear): consume AutogearResult and filter soft-warning for hard priorities`
12. `feat(autogear): warning banner and attempts note in GearSuggestions`
13. `docs: document autogear hard requirements feature`
