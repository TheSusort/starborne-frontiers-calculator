# Healing Calculator: Autofill Heal Modifier + Outgoing Repair Buffs

**Date:** 2026-05-14  
**Status:** Approved

---

## Problem

Two gaps in the healing calculator:

1. **Heal modifier is never auto-filled.** When a ship is selected, `hp`, `crit`, and `critDamage` are populated from the ship's computed stats, but `healModifier` stays at 0. The actual value is available in `calculateTotalStats().final.healModifier` (accumulated from gear, gear sets, refits — confirmed: `healModifier` is a `PERCENTAGE_ONLY_STAT` so `addStatModifier` adds values directly). The control is also a `<Select>` with discrete steps (0–60% in 10% increments), which can't represent arbitrary stat values.

2. **Outgoing repair buffs are inert.** "Out. Repair Down II" (−50% Outgoing Repair) exists in `buffs.ts` but `buffParser.ts` has no pattern for "Outgoing Repair". `HealingBuffTotals` has no corresponding field. These buffs appear in the picker but are silently ignored in the calculation.

---

## Part 1 — Autofill Heal Modifier

### Behaviour

When a ship is selected (on initial load via `?shipId=` or via `selectShipForConfig`), read `Math.round(final.healModifier ?? 0)` from the computed stats and store it alongside a `healModifierAutoFilled: boolean` flag on `HealerConfig`. When the user manually edits the field, clear the flag (matching the existing `healPercentAutoFilled` / `chargedHealPercentAutoFilled` pattern in `updateConfig`).

**Units:** `final.healModifier` is an integer percentage (e.g. `20` = 20%). It is a `PERCENTAGE_ONLY_STAT`, so `addStatModifier` accumulates it additively from base stats + gear + gear set bonuses. For ships with no relevant gear, `BaseStats.healModifier` is `undefined`, so `final.healModifier ?? 0` correctly defaults to `0` — no NaN risk.

### UI

Replace the `<Select>` in `HealerConfigCard` with `<Input type="number" min="0">`. Show `helpLabel="auto-filled"` when `healModifierAutoFilled` is true. No change to `DEFAULT_CONFIG.healModifier: 20` — the default for manually-added healers without a ship is intentional.

### HealingComparisonChart axis range

`HealingComparisonChart` hard-codes `healModifier: [0, 20, 40, 60]` for the comparison chart ticks. Update this to `[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]` to cover the full range of values that can now be auto-filled.

### Files changed — Part 1

| File | Change |
|------|--------|
| `src/types/calculator.ts` | Add `healModifierAutoFilled?: boolean` to `HealerConfig` |
| `src/pages/calculators/HealingCalculatorPage.tsx` | Set `healModifier: Math.round(final.healModifier ?? 0)` + `healModifierAutoFilled: true` in both `getInitialConfig` (ship path) and `selectShipForConfig`; clear flag in `updateConfig` when `field === 'healModifier'` |
| `src/components/calculator/HealerConfigCard.tsx` | Replace `<Select>` with `<Input type="number" min="0">` for heal modifier; show `helpLabel="auto-filled"` when `healModifierAutoFilled` is true |
| `src/components/calculator/HealingComparisonChart.tsx` | Extend `healModifier` axis ticks to `[0, 10, 20, ..., 100]` |

---

## Part 2 — Outgoing Repair Buffs as Separate Multiplier

### Formula

```
Effective Heal = HP × Heal% × CritMultiplier × (1 + HealMod%) × (1 + OutgoingRepairBuff%)
```

`OutgoingRepairBuff%` is the **sum** of all selected outgoing-repair buff values (additive across buffs, e.g. two −50% buffs = −100%), then applied as a separate multiplicative factor (`(1 + sum/100)`). This mirrors how `outgoingDamage` works in the DPS simulator. A −50% value yields a `0.5×` multiplier, halving output — correct for "Repair Down" debuffs.

Both `calculateHealing` (used for the stat display) and `simulateHealing` (used for the round-by-round charts) must apply the multiplier, or the numbers will diverge.

### Files changed — Part 2

| File | Change |
|------|--------|
| `src/types/calculator.ts` | Add `outgoingHeal?: number` to `ParsedBuffEffects`; add `outgoingHealBuff: number` to `HealingBuffTotals` |
| `src/utils/calculators/buffParser.ts` | Add pattern `/([+-]\d+(?:\.\d+)?)%\s*Outgoing\s*Repair/` → `effects.outgoingHeal` |
| `src/components/calculator/GameBuffPicker.tsx` | Add `outgoingHeal: 'Out.Repair'` to `STAT_LABELS` |
| `src/utils/calculators/healingCalculator.ts` | Apply `× (1 + (buffs?.outgoingHealBuff ?? 0) / 100)` after `healModMult` |
| `src/utils/calculators/healingSimulator.ts` | Apply same `× (1 + (buffs?.outgoingHealBuff ?? 0) / 100)` after `healModMult` on both `activeHealing` and `chargedHealing` |
| `src/pages/calculators/HealingCalculatorPage.tsx` | Sum `outgoingHeal` effects into **both** `globalBuffTotals` and `mergedBuffTotals`; add `'outgoingHeal'` to `relevantStats` on per-ship `GameBuffPicker`; update in-page formula text to: `Effective Heal = HP × Heal% × CritMultiplier × (1 + HealMod%) × (1 + OutgoingRepairBuff%)` |
| `src/components/calculator/HealingSettingsPanel.tsx` | Add `'outgoingHeal'` to `relevantStats` on the global `GameBuffPicker` |

### Buff data coverage

Currently one buff matches the new pattern:
- `Out. Repair Down II` → `−50% Outgoing Repair`

Any future "Out. Repair Up" buffs added to `buffs.ts` will be parsed automatically.

---

## Out of scope

- "Incoming Repair" buffs (e.g. "Everliving Regeneration", "Inc. Repair Up/Down") — these affect the *target* receiving heals, not the healer's output. Not relevant to this calculator.
- Changing the heal modifier formula from additive-to-base to anything else — the existing `(1 + healModifier/100)` factor is correct.
