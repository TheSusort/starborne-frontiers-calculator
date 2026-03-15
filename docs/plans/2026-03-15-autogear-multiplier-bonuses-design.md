# Autogear Stat Bonus Multiplier Mode

**Date:** 2026-03-15
**Status:** Draft

## Problem

The current stat bonus system in autogear is purely additive: `roleScore + (statValue * pct/100)`. This requires absurdly high percentages (e.g., 5000%) to have meaningful impact and is unintuitive. Users need a way to make stats scale proportionally with the role score.

## Solution

Add a per-bonus `mode` toggle: **Additive** (current behavior) or **Multiplier** (new).

- **Additive:** `statValue * pct/100` is added to the role score. Use for skills that scale off a specific stat (e.g., a skill dealing 80% of defense as damage → defense@80% additive).
- **Multiplier:** All multiplier bonuses are summed into a factor (`sum(statValue * pct/100)`), then the role score is multiplied by that factor. Use when a stat should scale proportionally with the role (e.g., hacking@50% on an attacker → `DPS * (hacking * 0.5)`).

## Type Changes

```typescript
// src/types/autogear.ts
export interface StatBonus {
    stat: string;
    percentage: number;
    mode?: 'additive' | 'multiplier';  // NEW — optional, defaults to 'additive' at consumption
}
```

The `mode` field is optional so existing saved configs (localStorage, Supabase, community recommendations) work without migration. All consumption sites treat `undefined` as `'additive'`.

## Scoring Logic

### Current (unchanged for additive)

```
additiveBonus = sum(statValue * pct/100) for all additive bonuses (mode === 'additive' or undefined)
```

### New multiplier calculation

```
multiplierFactor = sum(statValue * pct/100) for all multiplier bonuses (mode === 'multiplier')
```

### Combined formula

Each role-specific scoring function applies both:

```
baseScore = roleCalculation(stats)  // DPS, EHP, etc.
additiveBonus = sum of additive bonuses
hasMultipliers = any bonus has mode === 'multiplier'
multiplierFactor = hasMultipliers ? sum of multiplier bonuses : 1

finalScore = (baseScore + additiveBonus) * multiplierFactor
```

**Zero handling:** When multiplier bonuses are configured but the stat values sum to 0, the multiplierFactor is 0 and the score is 0. This is correct — if the user wants hacking to matter and the gear gives 0 hacking, the score should be 0. The check is whether multiplier bonuses *exist in the config*, not whether the factor is positive.

**Note on absolute values:** The multiplierFactor can be large (e.g., 2560), which produces large absolute scores. This is fine — scores are only compared between gear loadouts for the same ship with the same config. Relative ordering is preserved.

### Multiple multiplier bonuses

Multiple multiplier bonuses are **summed then applied once** (not chained):

```
hacking@50% + speed@20% on attacker (DPS=10000, hacking=5000, speed=300):
multiplierFactor = (5000 * 0.5) + (300 * 0.2) = 2560
finalScore = DPS * 2560 = 25,600,000
```

### Defender edge case

`calculateDefenderScore` can produce `Number.MAX_SAFE_INTEGER` for infinite survival. The multiplier must be applied *before* capping to `MAX_SAFE_INTEGER` to avoid overflow to `Infinity`.

## Files to Change

### Types
- `src/types/autogear.ts` — Add optional `mode` field to `StatBonus`

### Scoring
- `src/utils/autogear/scoring.ts` — Split `applystatBonuses()` into two functions (additive returns a number, multiplier returns a factor); update all role-specific score functions to apply `(baseScore + additive) * multiplier`

### UI
- `src/components/autogear/StatBonusForm.tsx` — Add mode toggle (Additive/Multiplier) to the form; default to Additive
- `src/components/autogear/AutogearSettings.tsx` — Display mode label in bonus rows
- `src/components/autogear/AutogearConfigList.tsx` — Show mode in bonus summary display (e.g., "×50%" vs "+50%")

### State management
- `src/pages/manager/AutogearPage.tsx` — Include `mode` when creating `StatBonus` objects on add

### Help Text
Replace current confusing percentage range guidance with:
- **Additive:** "Adds stat × % directly to score. Use for skills that scale off a stat (e.g., defense@80% for a skill dealing 80% of defense as damage)."
- **Multiplier:** "Multiplies role score by stat × %. Use when a stat should scale proportionally with the role (e.g., hacking@50% makes DPS scale with hacking)."

### Documentation
- `src/pages/DocumentationPage.tsx` — Update autogear documentation to describe both bonus modes

## Backwards Compatibility

- `mode` is optional in the `StatBonus` interface — existing objects without it compile and work
- All consumption sites treat `mode === undefined` as `'additive'`
- No migration needed for localStorage, Supabase, or community recommendations
- Existing configs produce identical scores (additive-only path unchanged, multiplier defaults to factor of 1 when no multiplier bonuses exist)

## Testing

- Unit tests for additive bonus calculation (existing behavior preserved)
- Unit tests for multiplier bonus calculation
- Test mixed additive + multiplier bonuses produce correct combined score
- Test backwards compatibility: configs without `mode` field behave as additive
- Test edge case: multiplier bonuses configured but stat value is 0 → score is 0
- Test edge case: no multiplier bonuses → factor is 1, no change to score
- Test defender MAX_SAFE_INTEGER is not exceeded when multiplier is applied
