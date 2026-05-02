# Fleet Buffs — Design Spec

**Date:** 2026-05-02  
**Status:** Approved

## Overview

Allow users to specify external stat buffs per ship in the autogear optimisation. A buff represents a commander or fleet ability that boosts the ship's stats during combat (e.g. Volk's +30% crit rate). The autogear scorer should account for these buffs so the gear recommendations reflect the ship's true in-combat performance.

## Background

The existing `statBonuses` tweak modifies the *scoring formula* (additive or multiplier on the role score). Fleet buffs are a different concept — they inflate the *stat values* before the scorer sees them, similar to how arena modifiers work. The two systems must remain separate.

Arena modifiers apply uniformly across all ships via a global season and use purely multiplicative math. Fleet buffs are per-ship, user-defined, and use different math depending on stat type (see Scoring section).

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

Default value in `AutogearPage.tsx` initial config: `[]`.

Persisted automatically via `useStorage` since it is part of `SavedAutogearConfig`.

## Scoring Pipeline

### New utility: `src/utils/autogear/fleetBuffs.ts`

Single exported function:

```typescript
export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats
```

**Math rules (both derived from `STATS[stat].allowedTypes`):**

| Stat category | Example | Formula |
|---|---|---|
| Percentage-only (`allowedTypes` has no `'flat'`) | crit, critDamage, defensePenetration | `stat + percentage / 100` |
| Flat/flexible (`allowedTypes` includes `'flat'`) | attack, hp, defence, speed | `stat × (1 + percentage / 100)` |

Examples:
- Volk +30% crit: crit `0.70 + 0.30 = 1.00`
- +45% attack: attack `10000 × 1.45 = 14500`

### `scoring.ts` — `calculateTotalScore`

Add `fleetBuffs?: FleetBuff[]` parameter. Apply after arena modifiers, before passing stats to `calculatePriorityScore`:

```
totalStats → applyArenaModifiers (if enabled) → applyFleetBuffs (if any) → calculatePriorityScore
```

Update cache key to include fleet buffs: `fleetBuffs.map(b => `${b.stat}:${b.percentage}`).join(',')`.

### Propagation

`fleetBuffs` follows the exact same path as `statBonuses` and `arenaModifiers` through:

- `src/utils/autogear/AutogearStrategy.ts` (interface)
- `src/utils/autogear/BaseStrategy.ts`
- All strategy implementations: `TwoPassStrategy`, `GeneticStrategy`, `BeamSearchStrategy`, `SetFirstStrategy`
- `src/utils/autogear/fastScoring/context.ts` — add `fleetBuffs` to `ScoringContext`
- `src/utils/autogear/fastScoring/fastScore.ts` — apply via `applyFleetBuffs` before priority scoring
- `src/pages/manager/AutogearPage.tsx` — read from `shipConfig.fleetBuffs`, pass to strategy

## UI

### New component: `src/components/autogear/FleetBuffForm.tsx`

Form with:
- **Stat** — `Select` using `ALL_STAT_NAMES` (same options as `StatBonusForm`)
- **Percentage** — numeric `Input` (positive integers, no upper cap enforced)
- **Hint** — one line below the stat picker explaining the math for the selected stat: `"Added directly to stat value"` (percentage-only) or `"Applied as a multiplier to the final stat"` (flat)
- **Add / Save / Cancel** buttons — same pattern as `StatBonusForm`

No mode toggle — the application method is determined entirely by stat type.

### `AutogearSettings.tsx`

Add `fleetBuffs` as a fourth tweak type in the Tweaks picker alongside stat priorities, set priorities, and stat bonuses. The existing picker/list/form sub-flow pattern applies unchanged. Fleet buffs are listed, reorderable, editable, and removable.

Props additions:
```typescript
fleetBuffs: FleetBuff[];
onAddFleetBuff: (buff: FleetBuff) => void;
onUpdateFleetBuff: (index: number, buff: FleetBuff) => void;
onRemoveFleetBuff: (index: number) => void;
onReorderFleetBuff: (from: number, to: number) => void;
```

### `AutogearConfigList.tsx`

Add a fleet buffs summary row in the saved config display, following the same style as the existing `statBonuses` display.

### `AutogearPage.tsx`

Add four handlers for fleet buff CRUD/reorder, identical in shape to the existing `statBonuses` handlers:

- `onAddFleetBuff`
- `onUpdateFleetBuff`
- `onRemoveFleetBuff`
- `onReorderFleetBuff`

## Documentation

Update `src/pages/DocumentationPage.tsx` to describe fleet buffs in the autogear section.

## Out of Scope

- Fleet-wide buffs (shared across all ships in a run) — per-ship is sufficient for v1
- Named presets / buff templates (e.g. "Volk loadout") — future enhancement
- Negative buffs / debuffs — not needed yet

## Testing

- Unit tests for `applyFleetBuffs`: verify additive math for percentage stats, multiplicative math for flat stats, empty array no-op, unknown stat key safe skip
- Existing autogear scoring tests should continue to pass unchanged (fleet buffs default to `[]`)
