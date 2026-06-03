# Effective HP as an Autogear Stat Limit — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Branch:** `feat/effective-hp-limit`

## Problem

Autogear lets users set per-stat min/max limits (`StatPriority`) for stats like
`hp`, `defence`, and `speed`. When a build needs to meet a **survivability**
target, neither an `hp` limit nor a `defence` limit expresses it well —
survivability is the combination of both (plus the `damageReduction` stat).
Users want to set a minimum **effective HP** directly instead of guessing hp/def
values that approximate it.

Effective HP is already computed in the codebase via `calculateEffectiveHP(hp,
defence, damageReductionPercent)` in `src/utils/autogear/priorityScore.ts`, and
surfaced in simulation results. It is a *derived* value, not a base stat.

## Goal

Add **Effective HP** as a selectable entry in the existing autogear "Limits"
dropdown, behaving exactly like other limits:

- Supports `minLimit`, `maxLimit`, and the **Hard Requirement** toggle.
- Participates in soft-penalty scoring and the hard-requirement retry/violation
  flow identically to `hp`/`defence`/`speed`.
- Shows up in the "Unmet Stat Priorities" and hard-requirement violation UI with
  a proper label.

## Non-Goals (YAGNI)

- Other derived limits (DPS, survival rounds, etc.). The type design below makes
  adding more derived limits trivial later, but only `effectiveHp` is added now.
- Influencing implant filtering. `effectiveHp` does not correspond to any gear
  stat name, so implant filtering (`implantFilter.ts`, which matches
  `priority.stat` against gear stat names) simply ignores it. Acceptable —
  effective HP limits are still enforced through scoring penalties and the hard
  requirement path.

## Core Design Decision: keep `StatName` clean

`StatPriority.stat` is currently typed `StatName`. But `StatName` is also the
type for **gear stat rolls**, the import attribute mapping, and stat display
across the app. Adding `'effectiveHp'` to `StatName` would leak a non-gear,
derived value into all those places.

Instead, introduce a wider type used **only for limits**:

```ts
// src/types/stats.ts
export type DerivedStatName = 'effectiveHp';
export type LimitableStat = StatName | DerivedStatName;
```

`StatName` stays exactly as-is (gear, imports, display unaffected).

## Components & Changes

### 1. Types

| File | Change |
|------|--------|
| `src/types/stats.ts` | Add `DerivedStatName` and `LimitableStat`. |
| `src/types/autogear.ts` | `StatPriority.stat: StatName` → `LimitableStat`. |
| `src/utils/autogear/AutogearStrategy.ts` | `HardRequirementViolation.stat: StatName` → `LimitableStat`. |

`UnmetPriority.stat` (in `AutogearPage.tsx`) is already typed `string` — no change.

### 2. Value resolution (`src/utils/autogear/priorityScore.ts`)

New exported pure helper:

```ts
export function resolveLimitStatValue(stats: BaseStats, stat: LimitableStat): number {
    if (stat === 'effectiveHp') {
        return calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0);
    }
    return stats[stat] || 0;
}
```

Route every site that currently reads `stats[priority.stat]` for a limit through
this helper:

| Site | Function |
|------|----------|
| `priorityScore.ts` ~:340 | `calculateDefaultScore` (weighted manual-mode score) |
| `priorityScore.ts` ~:358 | `calculateHardViolation` |
| `priorityScore.ts` ~:384 | `calculatePriorityScore` (soft min/max penalties) |
| `strategies/GeneticStrategy.ts` ~:364 | hard-requirement violation builder |
| `pages/manager/AutogearPage.tsx` ~:900 | `getUnmetPriorities` |

Behaviour is unchanged for every existing stat (the helper returns
`stats[stat] || 0` for them); only `'effectiveHp'` gains derived resolution.

### 3. Scoring normalizer (`src/constants/stats.ts`)

`STAT_NORMALIZERS` (a `Record<string, number>`) is used by `calculateDefaultScore`
in manual mode. Add:

```ts
effectiveHp: 30000, // effectiveHP runs ~1.3-5x raw hp; normalize above hp's 10k
```

Without this it would default to `1` and dominate the weighted sum. This only
affects manual-mode (no-role) weighted scoring; the limit-penalty and
hard-requirement paths are normalizer-independent.

### 4. Labels (`src/constants/stats.ts` + render sites)

`STATS` is keyed by `StatName` and will not contain `effectiveHp`. Add a small
derived-label map plus a resolver:

```ts
const DERIVED_STAT_LABELS: Record<DerivedStatName, { label: string; shortLabel: string }> = {
    effectiveHp: { label: 'Effective HP', shortLabel: 'EHP' },
};

export function getLimitStatLabel(stat: LimitableStat): string {
    return STATS[stat as StatName]?.label ?? DERIVED_STAT_LABELS[stat as DerivedStatName]?.label ?? stat;
}
```

Use `getLimitStatLabel` at the label render sites so a derived stat renders
correctly (and never crashes on `STATS[stat].label` being undefined):

| File | Site |
|------|------|
| `components/stats/StatPriorityForm.tsx` | dropdown option labels |
| `components/autogear/StatPriorityRow.tsx` ~:73 | `STATS[priority.stat].label` (currently unsafe) |
| `components/autogear/GearSuggestions.tsx` ~:86 | `STATS[v.stat].label` (currently unsafe) |
| `components/autogear/AutogearConfigList.tsx` ~:83 | `STATS[priority.stat]?.label \|\| priority.stat` (works, but show clean label) |

### 5. UI (`components/stats/StatPriorityForm.tsx`)

- `AVAILABLE_STATS: LimitableStat[]`, append `'effectiveHp'`.
- `selectedStat` state typed `LimitableStat`.
- Option label via `getLimitStatLabel`.
- Min/max inputs and the Hard Requirement checkbox already work generically — no
  other changes.

## Data Flow

```
User picks "Effective HP" + min in StatPriorityForm
  → StatPriority { stat: 'effectiveHp', minLimit, hardRequirement? } saved to config
  → autogear scoring:
      resolveLimitStatValue(stats, 'effectiveHp') = calculateEffectiveHP(hp, def, dmgReduction)
      → soft penalty (calculatePriorityScore) and/or
      → hard violation (calculateHardViolation → GeneticStrategy retry)
  → unmet/violation UI renders via getLimitStatLabel('effectiveHp') = "Effective HP"
```

## Error Handling / Edge Cases

- `damageReduction` may be `undefined` on `BaseStats` → coalesce to `0` (matches
  existing `calculateEffectiveHP` default param).
- `defence` of `0` → `calculateDamageReduction(0)` uses `Math.log10(0) = -Infinity`,
  producing reduction ≈ 0, so effective HP ≈ hp. No divide-by-zero
  (`100 - reduction` stays near 100). Confirm in tests.
- Existing stats are unaffected: helper returns `stats[stat] || 0` for them.

## Testing

Add unit tests (Vitest) in the autogear test area:

1. `resolveLimitStatValue(stats, 'effectiveHp')` equals
   `calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction)`.
2. `resolveLimitStatValue(stats, 'hp')` equals `stats.hp` (passthrough).
3. `calculateHardViolation` reports a violation when effectiveHp is below an
   `effectiveHp` minLimit hard requirement, and 0 when met.
4. `calculatePriorityScore` applies a soft penalty for an unmet `effectiveHp`
   minLimit and none when met.
5. Edge: `defence: 0` does not produce `NaN`/`Infinity`.

## Documentation & Changelog

- Add an `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` (user-facing:
  "Autogear can now target a minimum Effective HP directly as a stat limit").
- Update `src/pages/DocumentationPage.tsx` if it enumerates autogear limit stats.

## Files Touched (summary)

- `src/types/stats.ts`
- `src/types/autogear.ts`
- `src/utils/autogear/AutogearStrategy.ts`
- `src/utils/autogear/priorityScore.ts`
- `src/constants/stats.ts`
- `src/components/stats/StatPriorityForm.tsx`
- `src/components/autogear/StatPriorityRow.tsx`
- `src/components/autogear/GearSuggestions.tsx`
- `src/components/autogear/AutogearConfigList.tsx`
- `src/pages/manager/AutogearPage.tsx`
- `src/constants/changelog.ts`
- `src/pages/DocumentationPage.tsx` (if applicable)
- Test file(s) for `priorityScore` / limit resolution
