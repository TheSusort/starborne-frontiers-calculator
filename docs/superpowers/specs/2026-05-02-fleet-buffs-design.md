# Fleet Buffs — Design Spec

**Date:** 2026-05-02  
**Status:** Approved

## Overview

Allow users to specify external stat buffs per ship in the autogear optimisation. A buff represents a commander or fleet ability that boosts the ship's stats during combat (e.g. Volk's +30% crit rate). The autogear scorer should account for these buffs so gear recommendations reflect the ship's true in-combat performance.

## Background

The existing `statBonuses` tweak modifies the *scoring formula* (additive or multiplier on the role score). Fleet buffs are a different concept — they inflate the *stat values* before the scorer sees them, the same mechanism as arena modifiers. The two systems must remain separate.

Arena modifiers apply uniformly across all ships via a global season and use purely multiplicative math. Fleet buffs are per-ship, user-defined, and use different math depending on stat type.

## Data Model

### New type

```typescript
// src/types/autogear.ts
export interface FleetBuff {
    stat: StatName;
    percentage: number; // e.g. 30 for +30%
}
```

### SavedAutogearConfig

Add one field:

```typescript
fleetBuffs?: FleetBuff[];
```

**Default value `[]` must appear in four places in `AutogearPage.tsx`:**
1. The inline `shipConfigs` state type (`fleetBuffs: FleetBuff[]`)
2. The `getShipConfig` default object (`fleetBuffs: []`)
3. The `onResetConfig` handler's explicit reset object (`fleetBuffs: []`)
4. The `config` object literal inside `handleAutogear` (`fleetBuffs: shipConfig.fleetBuffs`)

**Legacy config fallback:** When loading a saved config via `getConfig` (the URL-params / storage load path in `AutogearPage.tsx`), use `savedConfig.fleetBuffs ?? []` to handle configs persisted before this field existed.

## Scoring Pipeline

### New utility: `src/utils/autogear/fleetBuffs.ts`

Single exported function:

```typescript
export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats
```

**Classification:** Use `PERCENTAGE_ONLY_STATS` from `src/types/stats.ts` (the existing exported constant) to determine stat category — do not derive it from `STATS[stat].allowedTypes`.

**Math rules:**

| Stat category | Example | Formula |
|---|---|---|
| In `PERCENTAGE_ONLY_STATS` | crit, critDamage, defensePenetration | `stat + percentage / 100` |
| Not in `PERCENTAGE_ONLY_STATS` | attack, hp, defence, speed | `stat × (1 + percentage / 100)` |

**Why additive for percentage-only stats:** These stats are stored as decimal fractions in `BaseStats` (e.g. 70% crit = `0.70`). Fleet buffs for these stats work as flat additions to the percentage value: Volk's +30% crit takes 70% to 100%. In decimal: `0.70 + 0.30 = 1.00`. The multiplicative formula gives the wrong result: `0.70 × 1.30 = 0.91`. At a 20% base: additive → 0.50 (correct), multiplicative → 0.26 (wrong).

**Guard:** If `buff.stat` is not a key in `stats`, skip the buff silently. This handles any stat that might appear in `FleetBuff` but is absent from the `BaseStats` object.

### `scoring.ts` — `calculateTotalScore`

Add `fleetBuffs?: FleetBuff[]` as a new parameter. Apply after arena modifiers, before passing stats to `calculatePriorityScore`:

```
totalStats → applyArenaModifiers (if enabled) → applyFleetBuffs (if any) → calculatePriorityScore
```

**Cache key:** Append a `fleetBuffsKey` segment after the existing `arenaKey` segment, using `|` as delimiter (consistent with the existing key format at line 201 of `scoring.ts`):

```
`${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}|${fleetBuffsKey}`
```

where `fleetBuffsKey = fleetBuffs?.length ? fleetBuffs.map(b => `${b.stat}:${b.percentage}`).join(',') : ''`.

Fleet buff order is user-defined and meaningful (they are reorderable in the UI), so no sorting is needed — different orderings should be treated as distinct configurations.

**Module-level cache note:** `scoreCache` in `scoring.ts` is module-level but is explicitly cleared by `clearScoreCache()` at the start of each `GeneticStrategy` run. Cross-run stale entries are not a concern.

### Propagation through `GeneticStrategy`

`arenaModifiers` threads through six methods in `GeneticStrategy`. `fleetBuffs` must be added to all six:

1. **`findOptimalGear`** — add `fleetBuffs?: FleetBuff[]` to the signature; pass to `computeViolations`, `runSingleGAPass`, `evaluatePopulation`, and the fast-scoring context builder
2. **`runSingleGAPass`** — add `fleetBuffs?: FleetBuff[]` to the signature; forward to `calculateFitness`
3. **`evaluatePopulation`** — add `fleetBuffs?: FleetBuff[]` to the signature; forward to `calculateFitness`
4. **`computeViolations`** — add `fleetBuffs?: FleetBuff[]` to the signature; apply `applyFleetBuffs` to stats after `applyArenaModifiers` (same position as arena modifier application at lines 343–345) before checking hard violations. Violations must be evaluated against the same inflated stats used for scoring — this matches the slow path in `calculateFitness` where fleet buffs are applied before `calculateTotalScore`.
5. **`calculateFitness`** — add `fleetBuffs?: FleetBuff[]` to the signature; pass to `verifyAgainstSlowPath` (fast path); pass to `calculateTotalScore` (slow path at line ~518); pass to context via `buildFastScoringContext`. Two locations within this method need `applyFleetBuffs` applied after `applyArenaModifiers`:
   - The fast path: `finalStats` returned by `fastScore` already reflects fleet-buff inflation (via the context) — no extra call needed here.
   - The slow-path violation block (`hasHardReqs` branch after the `calculateTotalScore` call, lines ~524–539): this block applies `applyArenaModifiers` independently before calling `calculateHardViolation`. `applyFleetBuffs` must also be applied here (after `applyArenaModifiers`) so hard-requirement violation detection during GA iterations uses the same inflated stats as scoring.
6. **`verifyAgainstSlowPath`** — add `fleetBuffs?: FleetBuff[]` to the signature; pass to the single `calculateTotalScore` call site within this method

**VERIFY_FAST_SCORING parity:** `verifyAgainstSlowPath` compares the fast path result against the slow path (`calculateTotalScore`). Both paths must receive the same `fleetBuffs` to produce comparable results. The above wiring ensures this.

### `AutogearStrategy.ts` interface

Add `fleetBuffs?: FleetBuff[]` to the `findOptimalGear` interface signature (same position as `arenaModifiers`). Non-Genetic strategies (`TwoPassStrategy`, `SetFirstStrategy`, `BeamSearchStrategy`) do not need to use the parameter — matching the existing pattern where those strategies accept but ignore `arenaModifiers`.

### Fast scoring

**`src/utils/autogear/fastScoring/context.ts`** — three changes in this file:
1. Add `readonly fleetBuffs: readonly FleetBuff[] | undefined` to `FastScoringContext`
2. Add `fleetBuffs?: readonly FleetBuff[]` to `BuildContextInput` (alongside `arenaModifiers`)
3. Wire `fleetBuffs: input.fleetBuffs` inside `buildFastScoringContext`

**`src/utils/autogear/fastScoring/fastScore.ts`** — apply `applyFleetBuffs(stats, context.fleetBuffs)` after `applyArenaModifiers` and before the priority scorer call, using the same guard pattern as arena modifiers.

**Fast-score inner cache note:** `context.cache` is a `FastCache` allocated inside `buildFastScoringContext`, scoped to one run. A new context is built per `GeneticStrategy` invocation, so `fleetBuffs` from a previous run cannot produce stale hits. No changes to the fast-score inner cache key are needed.

## UI

### New component: `src/components/autogear/FleetBuffForm.tsx`

Form with:
- **Stat** — `Select` using `ALL_STAT_NAMES` (same options as `StatBonusForm`)
- **Percentage** — numeric `Input` (positive integers, no upper cap enforced)
- **Hint** — one line below the stat picker: `"Added directly to stat value"` for stats in `PERCENTAGE_ONLY_STATS`, `"Applied as a multiplier to the final stat"` for others
- **Add / Save / Cancel** buttons — same pattern as `StatBonusForm`

No mode toggle — the application method is determined entirely by stat type.

### `AutogearSettings.tsx`

**`TweakView` type** (line 25–28) — extend the `type` union to include `'fleetBuff'`:
```typescript
| { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff'; editIndex: number | null }
```

**`openForm` helper** (line ~207) — the `type` parameter of the `openForm` helper function has the same literal union and must be widened to include `'fleetBuff'` in the same edit.

**Tweak count badge** (line ~278) — add `+ fleetBuffs.length` to the existing count expression.

**Tweaks list** — add fleet buffs as a fourth item type in the picker and list, following the existing pattern for stat bonuses.

**Props additions:**
```typescript
fleetBuffs: FleetBuff[];
onAddFleetBuff: (buff: FleetBuff) => void;
onUpdateFleetBuff: (index: number, buff: FleetBuff) => void;
onRemoveFleetBuff: (index: number) => void;
onMoveFleetBuff: (from: number, to: number) => void;
```

Note: the reorder handler is named `onMoveFleetBuff` (not `onReorderFleetBuff`) to match the `onMove*` convention used by all other reorder handlers in the file (`onMovePriority`, `onMoveSetPriority`, `onMoveStatBonus`).

### `AutogearSettingsModal.tsx`

Add the same five fleet buff props to `AutogearSettingsModalProps` and pass them through to `<AutogearSettings />`.

### `AutogearConfigList.tsx`

Add a fleet buffs summary row in the saved config display, following the same style as the existing `statBonuses` display.

### `AutogearPage.tsx`

- Add `fleetBuffs: FleetBuff[]` to inline `shipConfigs` state type
- Add `fleetBuffs: []` to `getShipConfig` default object
- Add `fleetBuffs: []` to `onResetConfig` handler's explicit reset object
- Add `fleetBuffs: shipConfig.fleetBuffs` to `config` object inside `handleAutogear`
- Add `fleetBuffs ?? []` fallback when reading from `getConfig` (legacy config load)
- Add five handlers: `onAddFleetBuff`, `onUpdateFleetBuff`, `onRemoveFleetBuff`, `onMoveFleetBuff` (all matching the shape of existing `statBonuses` handlers), and pass all five plus `fleetBuffs` to the `<AutogearSettingsModal />` JSX call site
- Pass `fleetBuffs: shipConfig.fleetBuffs` to the strategy call alongside `arenaModifiers`

## Documentation

Update `src/pages/DocumentationPage.tsx` to describe fleet buffs in the autogear section.

## Out of Scope

- Fleet-wide buffs (shared across all ships in a run) — per-ship is sufficient for v1
- Named presets / buff templates (e.g. "Volk loadout") — future enhancement
- Negative buffs / debuffs — not needed yet

## Testing

Unit tests for `applyFleetBuffs`:
- Additive math for a percentage-only stat (e.g. crit 0.70 + 30% → 1.00)
- Multiplicative math for a flat stat (e.g. attack 10000 + 45% → 14500)
- Empty array returns stats unchanged
- Stat key absent from `BaseStats` is skipped silently (no crash, no mutation of unrelated keys)
- Multiple buffs apply in sequence correctly

Existing autogear scoring tests must continue to pass unchanged (fleet buffs default to `[]`).
