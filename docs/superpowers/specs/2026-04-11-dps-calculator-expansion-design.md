# DPS Calculator Expansion — Design Spec

## Overview

Expand the DPS calculator to support multi-round simulation with active/charged skill cycles, and damage-over-time (DoT) effects: corrosion, inferno, and bombs. This enables comparing burst-type ships against ramping/DoT ships over configurable combat durations.

## Approach

Extend the existing `DPSCalculatorPage` in-place. Extract the round-by-round simulation engine into a dedicated utility file (`dpsSimulator.ts`), following the pattern established by `chronoReaver.ts`. The existing heatmap, table, and defense penetration visualizations remain unchanged.

## Simulation Engine

**File:** `src/utils/calculators/dpsSimulator.ts`

### Input Types

```typescript
interface DoTApplicationConfig {
  corrosionStacks: number;        // stacks applied per use (0 = none)
  corrosionTier: 0 | 3 | 6 | 9;  // % of target HP per stack per turn
  infernoStacks: number;
  infernoTier: 0 | 15 | 30 | 45;  // % of attacker's attack per stack per turn
  bombStacks: number;
  bombTier: 0 | 100 | 200 | 300;  // % of attacker's attack on detonation
  bombCountdown: number;           // rounds before detonation (default 2)
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
  chargeCount: number;            // rounds of active attacks before charged fires

  // DoT config per skill type
  activeDoTs: DoTApplicationConfig;
  chargedDoTs: DoTApplicationConfig;

  // Shared inputs
  enemyDefense: number;
  enemyHp: number;
  rounds: number;
  buffs: Buff[];                  // existing Buff type from the page
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

1. **Determine action:** If `charges >= chargeCount` and `chargedMultiplier > 0` → charged attack (reset charges to 0). Otherwise → active attack (charges += 1).
2. **Calculate direct hit damage:** Use existing `calculateCritMultiplier` and `calculateDamageReduction` with the appropriate multiplier (active or charged). Apply buffs (attack, crit, critDamage, outgoingDamage) the same way as today.
3. **Apply new DoT stacks** based on action type (activeDoTs or chargedDoTs config).
4. **Tick corrosion:** All active corrosion stacks deal `stacks × (tier / 100) × enemyHp`.
5. **Tick inferno:** All active inferno stacks deal `stacks × (tier / 100) × effectiveAttack` (after attack buffs).
6. **Check bomb timers:** Any bomb with countdown reaching 0 detonates for `stacks × (tier / 100) × effectiveAttack` and is removed. Remaining bombs decrement their countdown by 1.
7. **Sum all damage sources** for the round. Update cumulative total.

### Key Behaviors

- **DoTs tick on the turn they are applied.** New stacks contribute damage immediately.
- **Stacks are permanent.** Corrosion and inferno stacks accumulate indefinitely with no cap.
- **Bombs track individual countdowns.** Each application creates a new bomb entry with its own countdown timer.
- **When `chargedMultiplier` is 0:** Charge tracking is skipped. Every round uses active attack. This preserves backward compatibility with the current single-hit behavior.

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

**Advanced accordion** (collapsed by default):
Contains three flat sub-sections separated by labeled headers:

1. **Skills**
   - Active Multiplier (%) — renamed from "Skill Multiplier", default 100
   - Charged Multiplier (%) — default 0
   - Charge Count — default 0

2. **DoTs — Active Skill**
   - Corrosion: tier select (None / I 3% / II 6% / III 9%) + stacks per use
   - Inferno: tier select (None / I 15% / II 30% / III 45%) + stacks per use
   - Bomb: tier select (None / I 100% / II 200% / III 300%) + stacks per use + countdown (default 2)

3. **DoTs — Charged Skill**
   - Same structure as active DoTs

**Results area** (below inputs, always visible):
- Crit Multiplier (existing)
- Avg Damage / Round (new)
- Total Damage over N rounds (new)
- Damage breakdown row showing Direct / Corrosion / Inferno / Bomb totals — only visible when DoTs are configured

Uses the existing `CollapsibleForm` component for the Advanced accordion.

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
| `src/utils/calculators/dpsSimulator.ts` | New — simulation engine |
| `src/utils/calculators/__tests__/dpsSimulator.test.ts` | New — engine tests |
| `src/components/calculator/DPSRoundChart.tsx` | New — cumulative damage line chart |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Modified — new shared inputs, restructured ship cards, wire up simulation |

## Testing

Unit tests for `dpsSimulator.ts`:

- **Active-only ship** (no charged, no DoTs): same result as current `calculateDPSWithDefense`
- **Active + Charged cycle**: verify charge accumulation and correct multiplier per round
- **Corrosion stacking**: stacks accumulate, damage = stacks × tier% × enemyHp per round
- **Inferno stacking**: damage = stacks × tier% × effectiveAttack per round
- **Bomb countdown + detonation**: bombs tick down, explode at 0, removed after detonation
- **Mixed DoTs on active + charged**: correct DoT application based on action type
- **Buffs affect DoT damage**: attack buff increases inferno/bomb damage
- **Round 1 DoT ticking**: DoTs deal damage on the turn they're applied
