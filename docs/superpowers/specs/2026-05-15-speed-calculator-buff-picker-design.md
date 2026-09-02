# Speed Calculator — Buff Picker Design

**Date:** 2026-05-15  
**Status:** Approved

## Overview

Replace the manual speed modifier rows in the Speed Calculator with the existing `GameBuffPicker` component. Both the Forward (base → final speed) and Reverse (target speed → required base) modes get independent buff selections. All manual modifier state and helper functions are removed.

## Scope

- Add `speed` as a recognised stat in the buff data layer
- Wire `GameBuffPicker` into `SpeedCalculatorPage` for both modes
- Remove all manual modifier UI and state

## Data Layer Changes

### `src/types/calculator.ts` + `src/components/calculator/GameBuffPicker.tsx` (atomic)

These two changes must be made together in one commit — `STAT_LABELS` in `GameBuffPicker.tsx` is typed as `Record<keyof ParsedBuffEffects, string>`, so adding `speed?` to `ParsedBuffEffects` without simultaneously adding the matching label will cause a TypeScript compile error.

**`src/types/calculator.ts`** — add `speed?: number` to `ParsedBuffEffects`. Semantics: percentage modifier, same sign convention as other stats (+30 = +30% speed, -15 = −15% speed).

```ts
export interface ParsedBuffEffects {
    // ... existing fields ...
    speed?: number; // additive percentage modifier on speed
}
```

**`src/components/calculator/GameBuffPicker.tsx`** — add `speed: 'Speed'` to `STAT_LABELS` so the effect summary line displays correctly in the picker dropdown and selected-buff chips. `speed` is a percentage stat and must NOT be added to `FLAT_STATS` — `buildEffectSummary` will automatically append `%`.

### `src/utils/calculators/buffParser.ts`

Add a regex to extract speed values. Existing buff descriptions use the form `+10% Speed`, `-30% Speed`, or combined `+20% Speed, +10% Attack`.

Pattern: `/([+-]\d+(?:\.\d+)?)%\s*Speed/`

## SpeedCalculatorPage Changes

### State

Remove:
- `modifiers: SpeedModifier[]`
- `nextModifierId: number`
- `reverseModifiers: SpeedModifier[]`
- `nextReverseModifierId: number`

Add:
- `forwardBuffs: SelectedGameBuff[]` — init `[]`
- `reverseBuffs: SelectedGameBuff[]` — init `[]`

### Helper functions removed

All of: `addModifier`, `removeModifier`, `updateModifier`, `updateModifierLabel`, `addReverseModifier`, `removeReverseModifier`, `updateReverseModifier`, `updateReverseModifierLabel`.

`getTotalModifier` becomes a pure inline expression: `buffs.reduce((sum, b) => sum + (b.parsedEffects.speed ?? 0) * b.stacks, 0)`.

### Calculation wiring

`calculateFinalSpeed` and `calculateBaseSpeedRange` accept a total modifier number; compute it from buffs before calling:

```ts
const totalModifier = forwardBuffs.reduce(
    (sum, b) => sum + (b.parsedEffects.speed ?? 0) * b.stacks,
    0
);
```

Refactor both `calculateFinalSpeed` and `calculateBaseSpeedRange` to accept `totalModifier: number` directly instead of `SpeedModifier[]`. Remove the internal `reduce` from each. Delete the `SpeedModifier` interface — it is only referenced in `SpeedCalculatorPage.tsx` and is safe to remove once the page no longer uses it.

### UI

**Forward mode "Speed Modifiers" card** — replace entirely with:

```tsx
<div className="card">
    <h3 className="text-lg font-bold mb-4">Speed Buffs</h3>
    <GameBuffPicker
        label="Speed Buffs"
        relevantStats={['speed']}
        value={forwardBuffs}
        onChange={setForwardBuffs}
    />
</div>
```

**Reverse mode "Speed Modifiers" card** — same replacement using `reverseBuffs` / `setReverseBuffs`.

**Result cards** — the "Total Modifier" row reads the buff-derived sum instead of manual state. No other changes to result card markup.

## What Does NOT Change

- The two-mode tab structure (forward / reverse)
- The Base Speed input and ShipSelector in forward mode
- The Target Speed Range inputs in reverse mode
- The Result card layout (Base Speed → Total Modifier → Final Speed / Required Base Speed Range)
- The Calculation Formula explanation cards

## Files Touched

| File | Change |
|------|--------|
| `src/types/calculator.ts` | Add `speed?` to `ParsedBuffEffects` (atomic with GameBuffPicker) |
| `src/components/calculator/GameBuffPicker.tsx` | Add `speed` to `STAT_LABELS` (atomic with calculator.ts) |
| `src/utils/calculators/buffParser.ts` | Add speed regex pattern |
| `src/pages/calculators/SpeedCalculatorPage.tsx` | Replace modifier state/UI with `GameBuffPicker`; refactor calculation functions; delete `SpeedModifier` interface |
| `src/pages/DocumentationPage.tsx` | Update Speed Calculator section — replace "Add multiple speed modifiers and label them for easy reference" with description of buff picker UX |
| `src/constants/changelog.ts` | Add entry to `UNRELEASED_CHANGES` for this user-facing feature |

## Out of Scope

- Global buffs (not needed — single-ship context)
- Per-buff stack support beyond what `GameBuffPicker` already handles
- Any changes to how speed is calculated in autogear or ship stat calculation
