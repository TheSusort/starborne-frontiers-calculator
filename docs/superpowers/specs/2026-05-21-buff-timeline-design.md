# Buff Timeline & Per-Round Simulation Design

**Date:** 2026-05-21
**Status:** Approved

## Problem

The DPS calculator currently applies all buffs and debuffs as flat multipliers for the entire fight — it does not model when each buff becomes active or how long it lasts. This means:

1. A charged-skill buff that only fires every N rounds is incorrectly treated as always active.
2. Users have no way to see which buffs/debuffs are actually affecting damage on any given round.

## Goal

1. Make the simulation per-round accurate: buffs only contribute to damage during the rounds they are actually active.
2. Show a side panel in the round chart that displays the active buffs and enemy debuffs for any hovered round, with turns remaining.

## Game Mechanics (confirmed with user)

### Round structure

Each round has exactly one action: either active or charged — not both.

Order of operations per round (applies to the buff state machine; existing DoT application/tick ordering in `simulateDPS` is unchanged):
1. Decrement all active buff durations by 1; remove entries that reach 0.
2. Determine which skill fires: charged if this is a charge round, otherwise active.
3. Apply buffs/debuffs from the fired skill at their full duration (overwriting the same entry if it was already tracking).
4. Calculate damage using all currently active buffs — including any buff just applied in step 3. A buff applied this round is active for this round's damage.

### Charge schedule

Mirrors the existing `simulateDPS` counter logic exactly:

```
charges = startCharged ? chargeCount : 0

for r = 1..N:
  if charges >= chargeCount:
    // charged fires this round
    charges = 0
  else:
    // active fires this round
    charges += 1
```

- `startCharged = false, chargeCount = 2` → charged fires on rounds 3, 6, 9, …
- `startCharged = true, chargeCount = 2` → charged fires on rounds 1, 4, 7, … (starts at full charge; period = chargeCount + 1 = 3)

### Buff source mapping

| `skillSource` | Fires on | Effect |
|---|---|---|
| `'passive1/2/3'` | Always | Active every round from round 1; not tracked in state machine |
| `'active'` | Every non-charge round | Applied/refreshed each active round |
| `'charge'` | Charge rounds only | Applied at full duration on each charge round |
| `undefined` / `skillDuration: null` | — | Treated as always active (conservative fallback, preserves existing manually-entered buff behaviour) |
| `skillDuration: 'recurring'` | — | Always active; not tracked in state machine |

### Buff tier overwrite

Buffs sharing the same family name (e.g. "Attack Up") but different tier (I/II/III) compete:
- Applying a buff when a **higher or equal tier** of the same family is already active → **no-op** (skip).
- Applying a buff when a **lower tier** of the same family is already active → **replace**: overwrite with the higher-tier buff at its full duration.

Family key is derived by stripping the trailing Roman-numeral suffix (`" I"`, `" II"`, `" III"`, `" IV"`, `" V"`). Tier is the corresponding integer (I=1, II=2, III=3, IV=4, V=5). Buffs with no suffix get family key = full name and tier = 0. Two buffs share a family if their stripped names are identical — e.g. `"Attack Up I"` (family `"Attack Up"`, tier 1) and `"Attack Up III"` (family `"Attack Up"`, tier 3) compete; `"Overload"` (family `"Overload"`, tier 0) never competes because no other buff strips to `"Overload"`.

## Architecture

### New: `src/utils/calculators/buffTimeline.ts`

Pure utility — no React, no side effects.

```ts
export interface ActiveBuff {
    buffName: string;
    turnsRemaining: number | 'recurring';
}

export interface BuffTimelineEntry {
    round: number;                          // 1-based
    activeSelfBuffs: ActiveBuff[];
    activeEnemyDebuffs: ActiveBuff[];
}

/** Returns which rounds (1-based) the charged skill fires. */
export function computeChargeSchedule(
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
): number[]

/** Runs the buff state machine and returns one entry per round. */
export function computeBuffTimeline(
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[],
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
): BuffTimelineEntry[]
```

**State machine internals:**

The machine maintains `Map<familyKey, { buffName, turnsRemaining, tier }>` separately for self-buffs and enemy debuffs. **The map starts empty at round 1.** Always-active buffs (passive, recurring, null duration, no source) are never placed into this map — they bypass the state machine and are appended directly to every `BuffTimelineEntry` snapshot (see step 4 below). Each round:

1. Decrement all `turnsRemaining`; delete entries ≤ 0.
2. Determine skill fired (`'charge'` if round ∈ charge schedule, else `'active'`).
3. For each buff in the input list whose `skillSource` matches the fired skill (and has a finite `skillDuration`):
   - Derive `familyKey` and `tier`.
   - If family already present with tier ≥ incoming → skip.
   - Otherwise → upsert at full duration.
4. Snapshot: combine the current map state with the always-active buffs (passives, recurring, null-duration, no-source) to form `activeSelfBuffs` / `activeEnemyDebuffs` for this round's `BuffTimelineEntry`. Always-active buffs are injected with `turnsRemaining: 'recurring'`.

### Modified: `src/utils/calculators/dpsSimulator.ts`

**`DPSSimulationInput` interface changes:**

Remove: `buffs: Buff[]`, `enemyDefenseModifier?: number`, `incomingDamageModifier?: number`, `defensePenetrationBuff?: number`, `dotDamageModifier?: number`.

Add:
```ts
selfBuffs: SelectedGameBuff[];   // merged attacker buffs: [...globalAttackerBuffs, ...config.buffs]
enemyDebuffs: SelectedGameBuff[]; // global enemy debuffs
```

`defensePenetrationBuff` and `dotDamageModifier` are derived inside the simulator from `selfBuffs` and `enemyDebuffs` via `toDotAndPenModifiers(selfBuffs, enemyDebuffs)` — they remain always-active scalars (per-round modeling of pen/DoT modifiers is out of scope).

**`DPSCalculatorPage` change:** Remove the `toSimBuffs`, `toEnemyModifiers`, and `toDotAndPenModifiers` calls at the page level. Pass `selfBuffs: [...attackerBuffs, ...config.buffs]` and `enemyDebuffs: enemyBuffs` directly. The `mergedAttackerBuffTotals` memoisation (used for `ShipConfigCard` display, not simulation) is unaffected and should be left in place.

**`RoundData`** gains two new fields:
```ts
activeSelfBuffs: ActiveBuff[];
activeEnemyDebuffs: ActiveBuff[];
```

**`simulateDPS` change — before the loop:**
```ts
// Pre-compute always-active scalars (pen/DoT remain always-active)
const { defensePenetrationBuff, dotDamageModifier } = toDotAndPenModifiers(selfBuffs, enemyDebuffs);

// Pre-compute per-round timeline
const timeline = computeBuffTimeline(selfBuffs, enemyDebuffs, chargeCount, startCharged, numRounds);

// Build lookup: buffName → SelectedGameBuff[] (array handles the rare case of
// duplicate buffName entries with different stacks counts)
const buffLookup = new Map<string, SelectedGameBuff[]>();
for (const b of [...selfBuffs, ...enemyDebuffs]) {
    const existing = buffLookup.get(b.buffName) ?? [];
    buffLookup.set(b.buffName, [...existing, b]);
}
```

**Inside the loop, per round `r`:**
```ts
const entry = timeline[r - 1];

const roundSelfBuffs = entry.activeSelfBuffs.flatMap(ab => buffLookup.get(ab.buffName) ?? []);
const { attackBuff, critBuff, critDamageBuff, outgoingDamageBuff } =
    calculateBuffTotals(toSimBuffs(roundSelfBuffs));

const roundEnemyDebuffs = entry.activeEnemyDebuffs.flatMap(ab => buffLookup.get(ab.buffName) ?? []);
const { enemyDefenseModifier, incomingDamageModifier } = toEnemyModifiers(roundEnemyDebuffs);
```

`RoundData` records `entry.activeSelfBuffs` and `entry.activeEnemyDebuffs` for the UI.

The `?? []` fallbacks are defensive — the state machine only inserts buff names that came from the input arrays, so `buffLookup.get` will never miss for a well-formed timeline.

### New: `src/components/calculator/DPSBuffPanel.tsx`

Props:
```ts
interface DPSBuffPanelProps {
    ships: Array<{
        name: string;
        roundData: RoundData | null;  // null = no round hovered
    }>;
}
```

Renders:
- Header: `"ROUND N OF M"` (or `"Hover a round"` when no round is hovered).
- One section per ship (ship name as subheader).
- Each section: **Your Buffs** list + **Enemy Debuffs** list.
- Each row: coloured dot (blue for self-buff, red for enemy debuff), buff name, turns remaining (`"2t"`, `"1t"`, `"∞"`).
- Empty section state: `"None active"` in muted text.

### Modified: `src/components/calculator/DPSRoundChart.tsx`

- Layout: the current component returns `<> BaseChart + ChartLegend </>`. Wrap both in a `<div className="flex gap-4">` with a new `<DPSBuffPanel>` sibling. The chart side is `<div className="flex-1 min-w-0">` containing `BaseChart` + `ChartLegend` unchanged. The panel is `<DPSBuffPanel className="w-48 shrink-0">`. The panel sits **outside** `BaseChart` / `ResponsiveContainer` so it does not affect the chart's available width.
- Track `hoveredRound: number | null` in local state.
- On Recharts `onMouseMove`: resolve the nearest round from the active payload, set `hoveredRound`.
- On `onMouseLeave`: clear `hoveredRound`.
- Derive per-ship panel data and pass to `DPSBuffPanel`:
  ```ts
  ships.map(s => ({
      name: s.name,
      roundData: hoveredRound != null ? s.result.rounds[hoveredRound - 1] ?? null : null,
  }))
  ```

### `DPSCalculatorPage.tsx`

No layout changes needed — `DPSRoundChart` handles its own internal layout. The page passes per-ship `RoundData[]` arrays to the chart as it does today (they are extended with the new `activeSelfBuffs` / `activeEnemyDebuffs` fields transparently).

## Data flow summary

```
DPSShipConfig (buffs, chargeCount, startCharged)
  → computeBuffTimeline()          [buffTimeline.ts]
  → RoundData[] with activeSelfBuffs/activeEnemyDebuffs  [dpsSimulator.ts]
  → DPSRoundChart hover state
  → DPSBuffPanel (renders active buff list)
```

## Accuracy notes

- Buffs with `skillDuration: null` or no `skillSource` are always-active. Their contribution to damage is unchanged from the current behaviour.
- Stack-based buffs (`stacks > 1`) are not per-round modelled for stack count — they apply at whatever `stacks` value the user set, whenever the buff is active. Per-round stack accumulation is out of scope.
- The simulation models a single-target fight with no interruptions. Buff reapplication assumes the skill fires every applicable round without misses.

## Files touched

- `src/utils/calculators/buffTimeline.ts` — **new**
- `src/utils/calculators/__tests__/buffTimeline.test.ts` — **new**
- `src/utils/calculators/dpsSimulator.ts` — change `DPSSimulationInput` (raw buffs in, remove pre-converted scalars), extend `RoundData`, add per-round buff totals
- `src/pages/calculators/DPSCalculatorPage.tsx` — pass `selfBuffs`/`enemyDebuffs` raw instead of pre-converted scalars
- `src/components/calculator/DPSBuffPanel.tsx` — **new**
- `src/components/calculator/DPSRoundChart.tsx` — add panel layout + hover wiring
