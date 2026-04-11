# DPS Calculator Expansion — Design Spec

## Overview

Expand the DPS calculator to support multi-round simulation with active/charged skill cycles, and damage-over-time (DoT) effects: corrosion, inferno, and bombs. This enables comparing burst-type ships against ramping/DoT ships over configurable combat durations.

## Approach

Extend the existing `DPSCalculatorPage` in-place. Extract the round-by-round simulation engine into a dedicated utility file (`dpsSimulator.ts`), following the pattern established by `chronoReaver.ts`. The existing heatmap, table, and defense penetration visualizations remain unchanged.

## Simulation Engine

**File:** `src/utils/calculators/dpsSimulator.ts`

### Shared Types

The `Buff` interface (currently local to `DPSCalculatorPage.tsx`) must be extracted to `src/types/calculator.ts` so both the page and the simulator can import it.

```typescript
// src/types/calculator.ts
export interface Buff {
  id: string;
  stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
  value: number;
}
```

### Input Types

```typescript
interface DoTApplicationConfig {
  corrosionStacks: number;        // stacks applied per use (0 = none)
  corrosionTier: 0 | 3 | 6 | 9;  // % of target HP per stack per turn
  infernoStacks: number;
  infernoTier: 0 | 15 | 30 | 45;  // % of attacker's attack per stack per turn
  bombStacks: number;
  bombTier: 0 | 100 | 200 | 300;  // % of attacker's attack on detonation
  bombCountdown: number;           // rounds before detonation, minimum 1 (default 2)
}

interface DPSSimulationInput {
  // Ship stats
  attack: number;
  crit: number;
  critDamage: number;
  defensePenetration: number;

  // Skill multipliers
  activeMultiplier: number;       // % (renamed from "skillMultiplier")
  chargedMultiplier: number;      // % (0 = no charged skill)
  chargeCount: number;            // rounds of active attacks before charged fires (0 = no charged skill)

  // DoT config per skill type
  activeDoTs: DoTApplicationConfig;
  chargedDoTs: DoTApplicationConfig;

  // Shared inputs
  enemyDefense: number;
  enemyHp: number;
  rounds: number;
  buffs: Buff[];
}
```

### Updated ShipConfig Interface

The page's `ShipConfig` interface expands to include all new fields:

```typescript
interface ShipConfig {
  id: string;
  name: string;
  attack: number;
  crit: number;
  critDamage: number;
  defensePenetration: number;
  activeMultiplier: number;       // renamed from skillMultiplier
  chargedMultiplier: number;
  chargeCount: number;
  activeDoTs: DoTApplicationConfig;
  chargedDoTs: DoTApplicationConfig;
}
```

### Output Types

```typescript
interface RoundData {
  round: number;
  action: 'active' | 'charged';
  charges: number;                // charges at end of round
  directDamage: number;           // hit damage this round
  corrosionDamage: number;        // corrosion tick total this round
  infernoDamage: number;          // inferno tick total this round
  bombDamage: number;             // bomb detonation damage this round
  totalRoundDamage: number;       // sum of all sources
  cumulativeDamage: number;       // running total across all rounds
  activeCorrosionStacks: number;  // total corrosion stacks ticking
  activeInfernoStacks: number;    // total inferno stacks ticking
  activeBombCount: number;        // pending (unexploded) bombs
}

interface DPSSimulationResult {
  rounds: RoundData[];
  summary: {
    totalDamage: number;
    avgDamagePerRound: number;
    totalDirectDamage: number;
    totalCorrosionDamage: number;
    totalInfernoDamage: number;
    totalBombDamage: number;
  };
}
```

### Simulation Loop (per round)

1. **Determine action:** If `chargedMultiplier > 0` and `chargeCount >= 1` and `charges >= chargeCount` → charged attack (reset charges to 0). Otherwise → active attack (charges += 1). When `chargedMultiplier <= 0` or `chargeCount <= 0`, charge tracking is skipped entirely — every round is an active attack.
2. **Calculate direct hit damage:** Use existing `calculateCritMultiplier` and `calculateDamageReduction` with the appropriate multiplier (active or charged). Apply buffs (attack, crit, critDamage, outgoingDamage) the same way as today. The `outgoingDamage` buff is a final multiplier on direct damage only.
3. **Apply new DoT stacks** based on action type (activeDoTs or chargedDoTs config).
4. **Tick corrosion:** All active corrosion stacks deal `stacks × (tier / 100) × enemyHp`. Not affected by defense, defense penetration, or outgoing damage buff.
5. **Tick inferno:** All active inferno stacks deal `stacks × (tier / 100) × effectiveAttack` (after attack buffs only). Not affected by defense, defense penetration, crit, or outgoing damage buff.
6. **Check bomb timers:** Any bomb with countdown reaching 0 detonates for `stacks × (tier / 100) × effectiveAttack` (after attack buffs only) and is removed. Not affected by defense, defense penetration, crit, or outgoing damage buff. Remaining bombs decrement their countdown by 1.
7. **Sum all damage sources** for the round. Update cumulative total.

### Key Behaviors

- **DoTs tick on the turn they are applied.** New stacks contribute damage immediately.
- **DoTs bypass all defense.** Corrosion, inferno, and bomb damage are not reduced by enemy defense, defense penetration, or the outgoing damage buff. Only the attack buff affects inferno and bomb base values (since they scale off the attacker's attack stat).
- **Stacks are permanent.** Corrosion and inferno stacks accumulate indefinitely with no cap.
- **Bombs track individual countdowns.** Each application creates a new bomb entry with its own countdown timer. `bombCountdown` must be >= 1 (enforced by UI input validation).
- **Charged skill guard:** When `chargedMultiplier <= 0` or `chargeCount <= 0`, charge tracking is skipped entirely. Every round uses active attack. This preserves backward compatibility with the current single-hit behavior.

## UI Changes

### Shared Inputs Section

The existing "Enemy Defense" card at the top of the page expands to include:

- **Enemy Defense** — existing, unchanged
- **Enemy HP** — new, needed for corrosion calculations
- **Rounds** — new, shared across all ships, default 20

### Ship Config Cards

**Always visible:**
- Name input + remove button
- Attack, Crit Rate (%), Crit Damage (%), Defense Penetration (%)

**Advanced accordion** (collapsed by default, uses existing `CollapsibleForm` component):
Contains three flat sub-sections separated by labeled headers:

1. **Skills**
   - Active Multiplier (%) — renamed from "Skill Multiplier", default 100
   - Charged Multiplier (%) — default 0
   - Charge Count — default 0

2. **DoTs — Active Skill**
   - Corrosion: tier select (None / I 3% / II 6% / III 9%) + stacks per use
   - Inferno: tier select (None / I 15% / II 30% / III 45%) + stacks per use
   - Bomb: tier select (None / I 100% / II 200% / III 300%) + stacks per use + countdown (default 2, min 1)

3. **DoTs — Charged Skill**
   - Same structure as active DoTs

**Results area** (below inputs, always visible):
- Crit Multiplier (existing)
- Avg Damage / Round (new)
- Total Damage over N rounds (new)
- Damage breakdown row showing Direct / Corrosion / Inferno / Bomb totals — only visible when DoTs are configured

### Best Config Highlighting

The "best ship configuration" badge uses **total damage over N rounds** from the simulation as the comparison metric (replacing the current single-hit DPS). This makes the comparison meaningful across burst and DoT builds.

### Round-by-Round Chart

**File:** `src/components/calculator/DPSRoundChart.tsx`

New section placed between ship config cards and the existing heatmap/table section.

- Recharts `LineChart`
- X-axis: Round number (1 to N)
- Y-axis: Cumulative damage
- One line per ship config, color-coded to match config card borders
- Tooltip showing per-round breakdown: direct damage + each DoT type

This chart is the primary tool for comparing burst vs ramping ships.

### Existing Visualizations

The heatmap, DPS comparison table, and defense penetration chart remain unchanged. They continue to show single-hit DPS analysis (attack × crit multiplier), which is still useful for gear optimization decisions.

## Backward Compatibility

**Defaults when Advanced is unused:**
- Active Multiplier: 100%
- Charged Multiplier: 0% (no charged skill)
- Charge Count: 0
- All DoT tiers: None, all stacks: 0

With these defaults, the simulation produces `rounds` identical active attacks. The per-round damage equals the current `calculateDPSWithDefense` result. Total damage = single-hit DPS × rounds.

**Ship loaded from URL param (`?shipId=`):** Populates base stats as today. Advanced section stays collapsed with defaults.

**`rounds = 1`:** Effectively single-hit mode. Total = average = that one hit.

## File Changes

| File | Change |
|------|--------|
| `src/types/calculator.ts` | New — shared `Buff` interface |
| `src/utils/calculators/dpsSimulator.ts` | New — simulation engine |
| `src/utils/calculators/__tests__/dpsSimulator.test.ts` | New — engine tests |
| `src/components/calculator/DPSRoundChart.tsx` | New — cumulative damage line chart |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Modified — new shared inputs, restructured ship cards, wire up simulation, import `Buff` from shared types |

## Testing

Unit tests for `dpsSimulator.ts`:

- **Active-only ship** (no charged, no DoTs): same result as current `calculateDPSWithDefense`
- **Active + Charged cycle**: verify charge accumulation and correct multiplier per round
- **Charged guard**: `chargedMultiplier = 0` or `chargeCount = 0` → every round is active
- **Corrosion stacking**: stacks accumulate, damage = stacks × tier% × enemyHp per round
- **Inferno stacking**: damage = stacks × tier% × effectiveAttack per round
- **Bomb countdown + detonation**: bombs tick down, explode at 0, removed after detonation
- **Mixed DoTs on active + charged**: correct DoT application based on action type
- **Attack buff affects inferno/bomb**: effectiveAttack includes attack buff
- **Outgoing damage buff does NOT affect DoTs**: only applies to direct damage
- **DoTs bypass defense**: DoT damage is unaffected by enemy defense/penetration
- **Round 1 DoT ticking**: DoTs deal damage on the turn they're applied
