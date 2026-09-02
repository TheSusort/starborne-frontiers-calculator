# Hacking / Security — Debuff Landing Probability

**Date:** 2026-05-26  
**Status:** Approved

## Overview

Add hacking (attacker) and security (defender) stats to the DPS calculator so that debuff landing probability is modelled. The formula is:

```
debuffLandingChance = clamp(hacking − enemySecurity, 0, 100) / 100
```

Defaults: ship hacking = 200, enemy security = 100 → 100% landing (all debuffs always land, matching current behaviour).

## Simulation Model

The calculator uses Monte Carlo averaging (N = 200 runs). Per run, per round, every enemy debuff that is active in the buff timeline receives an independent `Math.random() < debuffLandingChance` roll. If the roll fails, that debuff contributes nothing for that round (no defense reduction, no incoming-damage modifier, no incoming-DoT modifier). Numeric `RoundData` fields are summed across all 200 runs then divided; non-numeric fields are taken from the last run (they are deterministic).

**Subject to rolling (enemy debuffs):**
- `defense` — enemy defense reduction
- `incomingDamage` — enemy incoming direct damage modifier
- `incomingDotDamage` — enemy incoming DoT damage modifier (currently pre-computed once; moved to per-round)

**Not subject to rolling (self buffs):**
- `attack`, `crit`, `critDamage`, `outgoingDamage`, `defensePenetration`, `dotDamage` — the ship's own buffs

## Data Model

### `DPSShipConfig` (`types/calculator.ts`)
Add:
```ts
hacking?: number; // default 200
```

Extend the existing `autoFilledFields` Set union to include `'hacking'`:
```ts
autoFilledFields?: Set<'activeMultiplier' | 'chargedMultiplier' | 'hacking'>;
```

Add `'hacking'` to `DPSShipConfigUpdateableField`.

### `DPSSimulationInput` (`utils/calculators/dpsSimulator.ts`)
Add:
```ts
hacking?: number;       // default 200
enemySecurity?: number; // default 100
```

(Note: `DPSSimulationInput` is defined in `dpsSimulator.ts`, not `calculator.ts`.)

## Simulator Refactor (`utils/calculators/dpsSimulator.ts`)

1. Extract current inner round loop into `runSinglePass(input, timeline, debuffLandingChance, ...)` returning `{ rounds: RoundData[], totals }`.
2. `simulateDPS` computes `debuffLandingChance = clamp(hacking − enemySecurity, 0, 100) / 100` from the input defaults (`hacking ?? 200`, `enemySecurity ?? 100`). When `debuffLandingChance === 1.0` (the default), `Math.random() < 1.0` always passes — no special-case fast path is needed.
3. Outer loop runs `runSinglePass` N = 200 times, accumulating numeric fields (`directDamage`, `corrosionDamage`, `infernoDamage`, `bombDamage`, `totalRoundDamage`) into per-round accumulators. `cumulativeDamage` is **recomputed as a prefix sum of averaged `totalRoundDamage`** after all runs, rather than averaged directly, to avoid floating-point accumulation drift.
4. **Split `toDotAndPenModifiers`** (in `dpsBuffHelpers.ts`) so that the attacker-side portion (self `defensePenetrationBuff` + self `dotDamage` modifier) is computed once before the round loop, and the enemy-side portion (`incomingDotDamage` modifier from enemy debuffs) is computed per-round from the set of landed enemy debuffs. The two halves are combined each round: `dotMult = 1 + (selfDotMod + enemyDotMod) / 100`.
5. Average accumulators → final `RoundData[]`. Non-numeric fields (`action`, `charges`, `activeSelfBuffs`, `activeEnemyDebuffs`, `appliedDoTs`, `activeDoTStates`) taken from the last run — they are deterministic (buff timeline does not depend on random rolls).
6. Summary: `totalDamage` = last round's averaged `cumulativeDamage`; `avgDamagePerRound` = `totalDamage / numRounds`; damage-type totals summed from averaged per-round fields.

## UI Changes

### CombatSettingsPanel (`components/calculator/CombatSettingsPanel.tsx`)
- Add `enemySecurity: number` and `onEnemySecurityChange: (v: number) => void` props.
- Add `Input` for "Enemy Security" (default 100, `type="number"`, `min="0"`) to the existing enemy inputs grid alongside Defense, HP, Rounds, Affinity.

### ShipConfigCard (`components/calculator/ShipConfigCard.tsx`)
- Add `enemySecurity: number` prop (needed to compute the landing-chance display label).
- In the advanced section, add a "Hacking" `Input` (`type="number"`, `min="0"`):
  - `helpLabel="auto-filled"` when `config.autoFilledFields?.has('hacking')` is true (consistent with `activeMultiplier`/`chargedMultiplier` pattern).
  - Additional computed note displayed beneath or inline: `"Landing: X% vs enemy"` where X = `clamp(hacking − enemySecurity, 0, 100)`.
  - Editing the field calls `onUpdate('hacking', value)` — `updateConfig` in the page will remove `'hacking'` from `autoFilledFields` (same mechanism as the multiplier fields).
- Placement: above the Affinity selector.

### DPSCalculatorPage (`pages/calculators/DPSCalculatorPage.tsx`)
- Add `enemySecurity` state (default 100).
- Default configs: add `hacking: 200`.
- `getInitialConfig` (URL load): autofill `hacking: Math.round(final.hacking ?? 200)`, add `'hacking'` to `autoFilledFields`.
- `selectShipForConfig`: autofill `hacking: Math.round(final.hacking ?? 200)`, add `'hacking'` to `autoFilledFields` (alongside existing `activeMultiplier`/`chargedMultiplier` auto-fill logic).
- `updateConfig`: when `field === 'hacking'`, remove `'hacking'` from the `autoFilledFields` Set (same mechanism as multiplier fields).
- `addConfig`: include `hacking: 200` (no auto-fill flag; blank config has no ship).
- `removeConfig` reset: include `hacking: 200`.
- Pass `enemySecurity` and `onEnemySecurityChange={setEnemySecurity}` to `CombatSettingsPanel`.
- Pass `enemySecurity` to each `ShipConfigCard`.
- Pass `hacking: config.hacking ?? 200` and `enemySecurity` to `simulateDPS`.

### Documentation ("About the Simulation" section, `DPSCalculatorPage.tsx`)
Replace the existing "Hacking is not modelled" paragraph with:

> Debuff landing is modelled via hacking and security stats. Each round, every active enemy debuff is rolled independently: `clamp(hacking − enemySecurity, 0, 100)%` chance to land. At the defaults (hacking 200, security 100) debuffs always land. Because each roll is random, damage numbers are computed as a 200-run Monte Carlo average so comparisons between ships remain stable.

## Changelog
Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:

> Hacking and security stats added to the DPS calculator. Set your ship's hacking (auto-filled from ship data) and the enemy's security (Combat Settings) to model the probability of debuffs landing. Defaults keep current behaviour (always land). Damage numbers with partial landing rates are averaged over 200 simulated combats.

## File Checklist

| File | Change |
|---|---|
| `src/types/calculator.ts` | Add `hacking?` to `DPSShipConfig`; extend `autoFilledFields` Set union to include `'hacking'`; add `'hacking'` to `DPSShipConfigUpdateableField` |
| `src/utils/calculators/dpsBuffHelpers.ts` | Split `toDotAndPenModifiers` — add separate helper for attacker-side and enemy-side DoT modifiers |
| `src/utils/calculators/dpsSimulator.ts` | Add `hacking?`/`enemySecurity?` to `DPSSimulationInput`; extract single-pass function; Monte Carlo outer loop (N=200); per-round enemy debuff rolling; move `incomingDotDamage` to per-round via split helper |
| `src/components/calculator/CombatSettingsPanel.tsx` | Add `enemySecurity` input |
| `src/components/calculator/ShipConfigCard.tsx` | Add `hacking` input + landing-chance display; add `enemySecurity` prop |
| `src/pages/calculators/DPSCalculatorPage.tsx` | State, autofill, pass-through, docs update |
| `src/constants/changelog.ts` | Changelog entry |
