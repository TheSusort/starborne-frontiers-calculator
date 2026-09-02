# Affinity System — DPS Calculator

**Date:** 2026-05-15
**Status:** Approved

## Overview

Add the in-game affinity matchup system to the DPS Calculator so players can model how elemental advantage and disadvantage affect their damage output.

## Background

Ships have one of four affinities: thermal, chemical, electric, or antimatter. Affinities interact in a cycle:

```
thermal → chemical → electric → thermal
```

Where "→" means "has advantage against". Antimatter sits outside the cycle and is never affected.

| Matchup | Damage | Crit effect |
|---|---|---|
| Attacker or enemy is antimatter | no change | no change |
| Attacker affinity is `undefined` | no change | no change |
| Attacker has advantage (e.g. thermal vs chemical) | +25% to all damage | no change |
| Attacker has disadvantage (e.g. thermal vs electric) | −25% to all damage | −25 pp additive penalty on crit rate, then hard-capped at 75% |
| Same affinity | no change | no change |

**Crit formula under disadvantage:**
```
effectiveCrit = min(75, max(0, (crit + critBuffs) − 25))
```
This is computed before `calculateCritMultiplier` receives it, so the internal 100-cap inside that function is never reached. The penalty is meaningful at all crit values (e.g. 60% crit → 35%), not just at high values.

The damage modifier applies to **all damage types** (direct, corrosion, inferno, bomb).

## Data Placement

### Attacker affinity — per ship card

- Stored as `affinity?: AffinityName` on `DPSShipConfig`. Optional; `undefined` is treated as neutral (no modifier).
- Auto-filled from the selected ship's `.affinity` field in `selectShipForConfig`.
- Ships added via `addConfig` or the deep-link path (`getInitialConfig`) leave `affinity` as `undefined`, which is neutral — no side-effects on existing simulations.
- Rendered on `ShipConfigCard` as a compact `Select` (thermal / chemical / electric / antimatter), always visible (not inside Advanced).

### Enemy affinity — global combat setting

- Stored as `enemyAffinity: AffinityName` in `DPSCalculatorPage` state.
- **Default: `'antimatter'`** — ensures existing simulations are unaffected until the user explicitly changes it.
- Rendered as a `Select` inside `CombatSettingsPanel`, in the enemy settings row alongside Defense and HP.

## Components and Files

### New file: `src/utils/calculators/affinityUtils.ts`

Pure utility. Exports:

```ts
export type AffinityMatchup = 'advantage' | 'disadvantage' | 'neutral';

export function getAffinityMatchup(
  attacker: AffinityName | undefined,
  enemy: AffinityName | undefined
): AffinityMatchup;
// Returns 'neutral' if either is undefined or antimatter, or if same affinity.

export function computeAffinityModifiers(
  attacker: AffinityName | undefined,
  enemy: AffinityName | undefined
): { damageModifier: number; critCap: number; critPenalty: number };
// damageModifier: percentage additive (25, -25, or 0)
// critCap: hard ceiling on effective crit rate (75 or 100)
// critPenalty: additive pp reduction (25 or 0); applied before critCap
```

The advantage map is a plain lookup object (`ADVANTAGE_OVER: Record<AffinityName, AffinityName | null>`); no switch/if chains.

### Modified: `src/types/calculator.ts`

- Add `affinity?: AffinityName` to `DPSShipConfig`.
- Add `'affinity'` to `DPSShipConfigUpdateableField` so `updateConfig` can handle affinity changes via the existing `onUpdate` prop on `ShipConfigCard`.

### Modified: `src/utils/calculators/dpsSimulator.ts`

Add three optional fields to `DPSSimulationInput`:

```ts
affinityDamageModifier?: number;  // percentage additive (25, -25, or 0); default 0
affinityCritCap?: number;          // hard ceiling on effective crit rate (75 or 100); default 100
affinityCritPenalty?: number;      // pp reduction applied before cap (25 or 0); default 0
```

Replace the current effective-crit line:

```ts
// Before:
const effectiveCrit = Math.min(100, crit + critBuff);

// After:
const effectiveCrit = Math.min(
  affinityCritCap ?? 100,
  Math.max(0, crit + critBuff - (affinityCritPenalty ?? 0))
);
```

`effectiveCrit` is then passed as the `crit` field when building the `BaseStats` object for `calculateCritMultiplier`, exactly as it is today — the internal 100-cap inside `calculateCritMultiplier` is harmless because our cap has already bounded the value.

Apply `affinityDamageModifier` as a final multiplier on all damage outputs:

```ts
const affinityMult = 1 + (affinityDamageModifier ?? 0) / 100;
directDamage    *= affinityMult;
corrosionDamage *= affinityMult;
infernoDamage   *= affinityMult;
bombDamage      *= affinityMult;
```

### Modified: `src/pages/calculators/DPSCalculatorPage.tsx`

- Add `enemyAffinity` state (default `'antimatter'`).
- In `simResults` memo: call `computeAffinityModifiers(config.affinity, enemyAffinity)` per config and pass all three affinity fields (`affinityDamageModifier`, `affinityCritCap`, `affinityCritPenalty`) into `simulateDPS`.
- Pass `enemyAffinity` and `onEnemyAffinityChange` to `CombatSettingsPanel`.
- Pass `enemyAffinity` to each `ShipConfigCard` as a new prop (needed for the advantage/disadvantage badge).
- In `selectShipForConfig`: set `affinity: ship.affinity` on the updated config.

### Modified: `src/components/calculator/CombatSettingsPanel.tsx`

- Add props: `enemyAffinity: AffinityName`, `onEnemyAffinityChange: (v: AffinityName) => void`.
- Render a `Select` for enemy affinity in the enemy settings row (alongside Defense and HP).

### Modified: `src/components/calculator/ShipConfigCard.tsx`

- Add props: `enemyAffinity: AffinityName` (for badge computation).
- Render a `Select` for attacker affinity (calls `onUpdate('affinity', value)`) always visible above the stat inputs.
- Show a small inline badge next to the affinity selector: **Advantage** (green) or **Disadvantage** (red), derived from `getAffinityMatchup(config.affinity, enemyAffinity)`. Hidden when neutral.

### Modified: `src/constants/changelog.ts`

Add entry to `UNRELEASED_CHANGES`:
> Affinity matchup support in DPS Calculator — set attacker and enemy affinity to apply advantage (+25% damage) or disadvantage (−25% damage, crit rate penalised and capped at 75%) modifiers to the simulation.

## Testing

### New file: `src/utils/calculators/__tests__/affinityUtils.test.ts`

- `getAffinityMatchup`: all 12 directional matchups, same-affinity cases, antimatter both sides, `undefined` attacker.
- `computeAffinityModifiers`: returns correct `{ damageModifier, critCap, critPenalty }` for advantage, disadvantage, neutral, and antimatter.

### Modified: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- Add a case with `affinityDamageModifier: 25` verifying total damage is ×1.25 vs baseline.
- Add a case with `affinityDamageModifier: -25`, `affinityCritCap: 75`, `affinityCritPenalty: 25` verifying damage reduction and crit cap are applied correctly.

## Non-goals

- No affinity display on the Damage Over Time chart (affinity modifiers are already baked into the simulated damage values).
- No auto-inference of enemy affinity from opponent ship type — enemy affinity is always a manual selection.
- No affinity for the Chrono Reaver or Healing calculators in this iteration.
