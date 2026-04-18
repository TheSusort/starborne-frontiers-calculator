# Autogear Hard Requirements — Design

**Date:** 2026-04-18
**Status:** Approved, ready for implementation planning
**Scope:** `src/utils/autogear/strategies/GeneticStrategy.ts`, `src/utils/autogear/priorityScore.ts`, `src/components/stats/StatPriorityForm.tsx`, `src/components/autogear/AutogearSettings.tsx`, `src/components/autogear/GearSuggestions.tsx`, `src/pages/manager/AutogearPage.tsx`, `src/types/autogear.ts`, `src/pages/DocumentationPage.tsx`

## Context

Autogear's stat priorities support `minLimit` and `maxLimit` fields, which today apply as *soft* penalties: `calculatePriorityScore` reduces the final score proportional to how far the stat is below/above the limit. Users can push the optimizer toward a target but not guarantee it.

A hard-requirement option existed previously and was removed in commit `883c4bc`. The old implementation returned `0` from `calculatePriorityScore` whenever any hard requirement was unmet — making the requirement an absolute gate at every score comparison. This broke the Genetic algorithm: generation 0 is hundreds of random combos, nearly none of which satisfy user-set hard requirements, so every fitness collapsed to 0. With no gradient to climb, the GA could not evolve toward feasible combos, and results were worse than soft limits.

We want to reintroduce hard requirements — a must-meet limit that's honored by the optimizer — without reintroducing the gradient collapse.

## Goals

- Users can mark any stat priority's `minLimit`/`maxLimit` as a hard requirement via a single checkbox.
- The optimizer *must* return a combo that satisfies every hard requirement if one exists in the user's inventory.
- When no feasible combo exists, the optimizer returns the closest-to-feasible result with a clear indication of which requirements were missed and by how much.
- The optimization quality for feasible combos is at least as good as today's soft-limit behavior.

## Non-goals

- Hard requirements on `setPriorities` (out of scope — discussed and deferred).
- Hard requirements for anything other than the `Genetic` strategy. The other strategies (`BeamSearch`, `TwoPass`, `SetFirst`) have been removed from the UI; `Genetic` is the only user-facing option.
- Whole-ship constraints beyond stat min/max (e.g. "must equip specific gear piece", "must preserve currently-equipped slot").

## Why the old approach failed

```text
calculatePriorityScore({ speed: 150, ... }, [{ stat: 'speed', minLimit: 200, hardRequirement: true }])
  → returns 0  (speed < minLimit)
```

Applied to a GA where every individual in generation 0 is a random gear combination:

- ~99% of gen-0 combos miss any meaningful hard requirement.
- All score 0. Tournament selection, crossover weighting, elite selection all collapse — there's no signal.
- Even combos that are "closer" to meeting the requirement look identical to combos that are nowhere near.

Result: the GA wanders randomly for all 40–120 generations and produces no better a result than a blind dice roll.

## Approach: Deb's feasibility rule (constraint-handling GA)

Instead of forcing feasibility into the fitness score, we track it as a second dimension and use a lexicographic comparator throughout the GA:

> Feasible always beats infeasible. Among feasible, higher fitness wins. Among infeasible, *lower violation* wins (fitness is only a tiebreaker).

This preserves a gradient in every state of the algorithm: before any feasible combo appears, the GA climbs the violation gradient toward feasibility; as soon as one does, it dominates elite slots and feasible-vs-feasible competition proceeds on raw fitness.

Existing soft-limit penalty logic in `calculatePriorityScore` is unchanged. A hard-flagged limit contributes to both the violation score (for feasibility ranking) and the soft penalty (for fitness) — two gradients pushing the same direction, intentional reinforcement.

---

## Design

### 1. Data model

`src/types/autogear.ts`:

```ts
export interface StatPriority {
    stat: StatName;
    weight?: number;
    minLimit?: number;
    maxLimit?: number;
    hardRequirement?: boolean;  // NEW
}
```

- Applies to whichever of `minLimit`/`maxLimit` is set. If both are set, both are hard.
- If neither is set, the flag is a no-op (no violation possible).
- Absent field on existing saved configs = `false` = current soft behavior. No DB migration needed — `statPriorities` is persisted as JSONB on `autogear_configs`.

`SavedAutogearConfig` picks up the new field automatically via its `statPriorities: StatPriority[]` field.

### 2. Algorithm changes — `GeneticStrategy`

**Individual** (file: `src/utils/autogear/strategies/GeneticStrategy.ts`):

```ts
interface Individual {
    equipment: Partial<Record<GearSlotName, string>>;
    fitness: number;
    violation: number;  // NEW — 0 = feasible
}
```

**Violation helper** (new, exported from `priorityScore.ts` so it can be unit-tested independently):

```ts
// Returns 0 if all hard reqs are met, else sum of normalized violations
// per hard-flagged limit. Computed on the same post-modifier stats
// (arena, engineering, refits, implants) used by calculatePriorityScore.
export function calculateHardViolation(
    stats: BaseStats,
    priorities: StatPriority[]
): number {
    let violation = 0;
    for (const p of priorities) {
        if (!p.hardRequirement) continue;
        const v = stats[p.stat] || 0;
        if (p.minLimit && v < p.minLimit) {
            violation += (p.minLimit - v) / p.minLimit;
        }
        if (p.maxLimit && v > p.maxLimit) {
            violation += (v - p.maxLimit) / p.maxLimit;
        }
    }
    return violation;
}
```

Normalization by the limit itself keeps violations comparable across stats of wildly different magnitudes (speed ~200 vs hp ~500k).

**Comparator**:

```ts
// Deb's feasibility rule. Returns negative if a should rank before b.
function compareIndividuals(a: Individual, b: Individual): number {
    const aFeasible = a.violation === 0;
    const bFeasible = b.violation === 0;
    if (aFeasible && !bFeasible) return -1;
    if (!aFeasible && bFeasible) return 1;
    if (aFeasible && bFeasible) return b.fitness - a.fitness;
    // Both infeasible
    if (a.violation !== b.violation) return a.violation - b.violation;
    return b.fitness - a.fitness;
}
```

**Integration points inside `GeneticStrategy`:**

| Location | Current | Change |
|---|---|---|
| `evaluatePopulation` | sort by `b.fitness - a.fitness` | also compute `violation`; sort by `compareIndividuals` |
| `selectParent` (tournament) | `current.fitness > best.fitness` | `compareIndividuals(current, best) < 0` |
| `crossover` parent weighting | `parent1.fitness / (p1 + p2)` | `compareIndividuals(p1, p2) < 0 ? 0.7 : 0.3` |
| Early-termination check | `currentBestFitness > bestFitness` | `compareIndividuals(currentBest, overallBest) < 0` |

The fitness calculation in `calculateFitness` / `calculateTotalScore` / `calculatePriorityScore` is untouched. The soft-limit penalty math continues to apply for *all* limits (hard and soft alike).

### 3. Rerun & fallback

Strategy return shape changes from `Promise<GearSuggestion[]>` to `Promise<AutogearResult>`:

```ts
// src/utils/autogear/AutogearStrategy.ts
export interface AutogearResult {
    suggestions: GearSuggestion[];
    hardRequirementsMet: boolean;
    violations?: Array<{
        stat: StatName;
        kind: 'min' | 'max';
        limit: number;
        actual: number;
    }>;
    attempts: number;  // 1..5
}
```

The interface method signature becomes `findOptimalGear(...): Promise<AutogearResult>`. Call sites (`AutogearPage.tsx`) destructure `.suggestions` for existing downstream code.

**Dead strategies (`BeamSearchStrategy`, `TwoPassStrategy`, `SetFirstStrategy`):** these were removed from the UI but are still registered in `getStrategy.ts` and still implement the old `findOptimalGear: Promise<GearSuggestion[]>` contract. Update them to match the new interface by wrapping their existing return in `{ suggestions, hardRequirementsMet: true, attempts: 1 }` — they don't implement hard-requirement logic, they just report "feasibility not evaluated; treat as met" so the shape compiles and the existing wrapping code keeps working. No user-visible change since they're not selectable. If a future cleanup deletes them outright, that is a separate task and out of scope here.

**Rerun loop** lives inside `GeneticStrategy.findOptimalGear`:

```text
overallBest = null
attempts = 0
while attempts < 5:
    attempts += 1
    run one full GA pass (fresh randomized initializePopulation each time)
    bestOfThisRun = population[0]  // already sorted by compareIndividuals
    if overallBest is null or compareIndividuals(bestOfThisRun, overallBest) < 0:
        overallBest = bestOfThisRun
    if overallBest.violation === 0:
        break  // feasible — done, don't burn remaining attempts
build AutogearResult from overallBest:
    hardRequirementsMet = overallBest.violation === 0
    violations = (if not met) recomputed per-stat from the final combo's stats
    attempts = attempts
    suggestions = overallBest.equipment → GearSuggestion[]
```

Key properties:
- Fresh random init each attempt — no seeding from prior runs. The point is to escape local infeasibility pockets.
- First-attempt success is the common case and has identical runtime to today.
- Worst case (infeasible inventory): 5× current runtime. Acceptable given (a) only happens on user-misconfigured requirements, (b) provides actionable feedback.
- Returns the best across *all* attempts, not just the last — guaranteed closest-to-feasible fallback.
- `clearScoreCache()` stays at the top of `findOptimalGear` (once per call), *not* per attempt. Same ship, same inventory, same priorities — cached scores are valid across all 5 attempts and provide meaningful speedup on reruns (many combos will be re-generated).

### 4. UI

**`StatPriorityForm.tsx`** — add a checkbox below the Min/Max inputs, rendered only when at least one of Min/Max is filled. Uses the shared `Checkbox` component:

```text
[ Stat ]  [ Weight ]
[ Min  ]  [ Max    ]
☐ Hard Requirement 2     [tooltip: "this time it's personal"]
[ Add ]
```

Disabled state when neither Min nor Max is filled. On submit, passes `hardRequirement: true/false` to `onAdd`. Respects existing `hideMinLimit`/`hideMaxLimit` props — if both are hidden, checkbox does not render.

**`AutogearSettings.tsx`** — the "Stat Priority List" display (around `StatPriorityForm.tsx`'s render of existing priorities) appends a text suffix for hard-flagged priorities:

```text
Speed (min: 200) — Hard Requirement 2
HP (max: 500000) — Hard Requirement 2
Crit (min: 70)                            ← soft, no suffix
```

Hover on the `— Hard Requirement 2` text shows a `Tooltip` with "this time it's personal".

> **Note to the implementer:** "Hard Requirement 2" is deliberate — a cheeky reference to the original feature being reintroduced. Keep the literal label, including the `2`, and the tooltip copy verbatim.

**Interaction with existing soft-limit warning:** `AutogearPage.tsx` already renders an "Unmet Stat Priorities" block (around lines 885–921 pre-change) for soft-limit misses via `getUnmetPriorities`. To avoid double-warning the user about the same stat:

- The existing soft-limit warning continues to render for soft limits only — filter `getUnmetPriorities` to exclude priorities where `hardRequirement === true`.
- Hard-requirement misses are displayed solely via the new banner in `GearSuggestions.tsx`.
- A single priority that has both a min and a max, with only one flagged hard, is a non-issue in practice — the hard side is either met (no warning) or missed (hard banner); the soft side continues to contribute to the existing warning.

**`GearSuggestions.tsx`** — adds two new UI states driven by `AutogearResult`:

- `hardRequirementsMet === false`: warning banner above the suggestions using the existing warning-card pattern (amber/yellow `card` variant):

  ```text
  ⚠ Could not meet all hard requirements after 5 attempts.
  Closest result shown. Missed:
    • Speed: needed min 200, got 178
    • HP:    needed max 500000, got 523400
  ```

  The suggestions themselves still render as normal — the banner is informational, not blocking.

- `hardRequirementsMet === true && attempts > 1`: a quieter info line above/below the result: `Found after N attempts.`

**`AutogearPage.tsx`** — consumes the new `AutogearResult`; holds `hardRequirementsMet`, `violations`, `attempts` in page state; passes them to `GearSuggestions`. Progress bar resets per attempt and displays `Attempt N of 5` as a label only when `attempts > 1`. First-attempt UX identical to today.

**`DocumentationPage.tsx`** — new paragraph in the autogear section explaining hard vs soft semantics and the closest-miss fallback.

### 5. Testing

New tests in `src/utils/autogear/__tests__/`:

- **`priorityScore.test.ts` (extend):** regression guard — `calculatePriorityScore` returns identical scores to today when `hardRequirement: false`. The math did not change; this proves it.

- **`hardRequirement.test.ts` (new):** table-driven tests for `calculateHardViolation` and `compareIndividuals`:
  - violation is 0 when all hard reqs are met
  - violation is 0 when no hard-flagged priorities exist
  - violation is 0 when hard-flagged priority has neither minLimit nor maxLimit set (no-op)
  - violation sums correctly across multiple hard priorities
  - violation handles both-min-and-max on one priority
  - comparator: feasible < infeasible regardless of fitness
  - comparator: among feasible, higher fitness wins
  - comparator: among infeasible, lower violation wins; fitness tiebreaks ties

- **`GeneticStrategy.test.ts` (new):** end-to-end with small synthetic inventories:
  - achievable hard requirement → `hardRequirementsMet === true`, `attempts >= 1`
  - impossible hard requirement → `attempts === 5`, `hardRequirementsMet === false`, `violations` populated with correct `needed` vs `got`
  - no hard-flagged priorities → behavior equivalent to today (soft-only path)
  - mix of achievable hard + soft priorities → feasible combo wins even if a higher-fitness combo exists that violates the hard req

GA tests will use small enough inventories that a correctly-functioning algorithm finds feasible combos reliably in one attempt, avoiding flakiness from `Math.random`. If this proves insufficient, we seed `Math.random` at test scope.

## Open questions

None at design time. Visual styling details (exact badge vs text for hard indicator, color of warning banner) will be decided at implementation and match existing UI primitives.

## Out of scope / future work

- Hard requirements on `setPriorities`.
- Hard requirements across a team optimization (current work is per-ship).
- Exposing the rerun cap (5) as a user setting.
- Telemetry on how often requirements are unmet (would indicate when users are setting impossible targets).
