# Gear Edit Mode — Design Spec

**Date:** 2026-04-27  
**Status:** Approved

## Problem

The gear editing form (`GearPieceForm`) currently renders all fields (slot, stars, rarity, set bonus, main stat name/type, level, substats) in both add and edit modes. In the game, once a gear piece is acquired most of its properties are fixed — you can only upgrade its level (which costs resources) or adjust substats at milestone levels. The current form lets users accidentally change slot, rarity, stars, or set bonus when they only meant to log an upgrade.

Additionally, the main stat value does not auto-update when level changes in edit mode — a `!editingPiece` guard blocks the recalculation, forcing users to manually update the value.

## Goal

When editing an existing gear piece:
1. Lock all fields that cannot change in the game (slot, stars, rarity, set bonus, main stat name/type)
2. Auto-update the main stat value when level or stars change
3. Gate the "Add substat" control behind the level + rarity unlock rules from the upgrade simulator
4. Keep the form compact — show only what the user can actually change

Add mode is unchanged.

## Design

### Layout — Edit Mode

The form renders in two visual zones when `editingPiece` is present:

**Zone 1 — Read-only summary strip**  
Displays locked fields as static text/badges (no inputs):
- Slot label
- Stars (⭐ count)
- Rarity badge
- Set bonus name
- Main stat name and type (the type selector shown for sensor/software/thrusters in add mode is suppressed in edit mode — type is part of the locked summary)

**Zone 2 — Editable fields**  
- Level input (0–16) — changing this recalculates the main stat value live
- Main stat value — disabled input, auto-calculated from `calculateMainStatValue(name, type, stars, level)`; not manually editable in edit mode
- Substats — existing substat values are editable; "Add substat" row is shown only when `subStats.length < getMaxSubstatsForLevel(rarity, level)`

**Save button** remains at the bottom.

After `onSubmit`, the parent unmounts the form in edit mode, so the post-save state reset is a no-op and requires no change.

### Layout — Add Mode

No changes. All existing fields remain fully editable.

---

## Auto-Update Fix

### Problem

The value-calculation `useEffect` (currently lines 70–85 of `GearPieceForm.tsx`) is gated by `!editingPiece`, so user-triggered level changes never recalculate the main stat in edit mode. There are also two existing guards (`isInitialMount` ref and the `!editingPiece` check) that each carry React 18 Strict Mode hazards.

### Solution

Drop both guards (`isInitialMount` and `!editingPiece`) from the value-calculation effect. Instead, treat the table value as the source of truth: whenever level, stars, name, or type change, always recalculate.

The `editingPiece` sync effect sets `mainStat`, `level`, and `stars` from the stored piece. The calculation effect then runs with those values and produces `calculateMainStatValue(name, type, stars, level)`. If the stored `mainStat.value` already matches the table (which it will for properly imported gear), the `calculatedValue !== mainStat.value` guard short-circuits and no update happens. If it differs (manually entered value), the table value wins — this is the desired behavior, since main stat values are game-determined.

The `isInitialMount` effect and ref are removed entirely. The `!editingPiece` guard is removed. `editingPiece` is removed from the calculation effect's dependency array — the re-fire when switching between pieces is covered by the `stars`, `level`, `mainStat.name`, and `mainStat.type` deps (the sync effect updates all of these, which triggers the calculation effect naturally).

The slot-change effect (lines 60–67) retains its `!editingPiece` guard — this is intentional, as slot is locked in edit mode and the mainStat reset it performs must not fire.

```
value-calculation effect (simplified):
  deps: [stars, level, mainStat.name, mainStat.type, mainStat.value]

  calculatedValue = calculateMainStatValue(mainStat.name, mainStat.type, stars, level)
  if (calculatedValue !== mainStat.value):
    setMainStat(prev => ({...prev, value: calculatedValue}))
```

**Strict Mode note:** Removing `isInitialMount` eliminates the cleanup hazard documented in project MEMORY.md. On the first render in add mode the effect runs immediately, setting the main stat to the table value for level 0 / 1 star (`calculateMainStatValue('attack', 'flat', 1, 0)` = 10) — this replaces the previous behaviour of showing `0` until the user changed a field, and is correct.

---

## Substat Slot Gating

### Utility Function

Export a new `getMaxSubstatsForLevel(rarity, level)` function from `potentialCalculator.ts`, reading the existing `UPGRADE_LEVELS` config (which must also be exported).

`RarityName` resolves to `string` (not a literal union) because `RARITIES` is a `Record<string, ...>`. Do **not** use `Partial<Record<RarityName, ...>>` as the export type — this becomes `Partial<Record<string, ...>>` and loses all type safety. Instead, keep the inferred literal-key type from the object literal by simply adding `export`:

```typescript
export const UPGRADE_LEVELS = {
    rare: { increases: [...], additions: [...], initialSubstats: 2 },
    epic: { increases: [...], additions: [...], initialSubstats: 3 },
    legendary: { increases: [...], additions: [...], initialSubstats: 4 },
};

export function getMaxSubstatsForLevel(rarity: string, level: number): number {
    const config = UPGRADE_LEVELS[rarity as keyof typeof UPGRADE_LEVELS];
    if (!config) return 4; // common/uncommon: approximate fallback, not game-verified
    return config.initialSubstats + config.additions.filter((l) => l <= level).length;
}
```

The `as keyof typeof UPGRADE_LEVELS` cast matches the pattern already used in `simulateUpgrade` (line 151) and preserves the existing access pattern.

Examples:
| Rarity    | Level | Max substats |
|-----------|-------|-------------|
| Rare      | 0–11  | 2           |
| Rare      | 12–15 | 3           |
| Rare      | 16    | 4           |
| Epic      | 0–15  | 3           |
| Epic      | 16    | 4           |
| Legendary | any   | 4           |
| Common / Uncommon | any | 4 (approximation) |

### Rendering Rule

Pass `getMaxSubstatsForLevel(rarity, level)` as the `maxStats` prop to `StatModifierInput` in edit mode; pass the existing hardcoded `4` in add mode. The existing `!maxStats || stats.length < maxStats` guard inside `StatModifierInput` already hides the "Add stat" row when the limit is reached — no changes needed to that component.

```
// edit mode
<StatModifierInput maxStats={getMaxSubstatsForLevel(rarity, level)} ... />

// add mode (unchanged)
<StatModifierInput maxStats={4} ... />
```

Existing substat values remain always editable regardless of level. If a piece already has more substats than `getMaxSubstatsForLevel` would allow (e.g., data imported before this restriction was added), all existing substats stay visible and editable — the gate only blocks adding new ones.

---

## Files Affected

| File | Change |
|------|--------|
| `src/components/gear/GearPieceForm.tsx` | Add edit-mode compact layout; remove `isInitialMount` ref and `!editingPiece` guard from calc effect; pass dynamic `maxStats` in edit mode |
| `src/utils/gear/potentialCalculator.ts` | Export `UPGRADE_LEVELS` (inferred literal-key type, no explicit annotation) and new `getMaxSubstatsForLevel` function |

No changes needed to `StatModifierInput`, types, or other constants.

---

## Out of Scope

- Calibration flow (separate concern)
- Sell / discard action
- Common / uncommon rarity-specific substat rules (fallback returns 4 as a safe approximation)
- Enforcing that level can only increase (edit form trusts the user)
- Animating stat value changes
