# DPS Calculator — Team Ships

**Date:** 2026-05-26  
**Status:** Approved

## Overview

Add a Team section to Combat Settings where users configure up to 4 support ships. These ships don't deal damage, but their skills are parsed for team buffs and enemy debuffs that contribute to the global shared pool — affecting all damage-dealer comparisons equally.

---

## Data Model

Add `TeamShipConfig` to `src/types/calculator.ts`:

```typescript
export interface TeamShipConfig {
    id: string;
    shipId?: string;
    buffs: SelectedGameBuff[];        // parsed self/team buffs → merge into global attackerBuffs
    enemyDebuffs: SelectedGameBuff[]; // parsed enemy debuffs  → merge into global enemyBuffs
    startCharged: boolean;            // auto-filled via detectFullyCharged; user-editable
}
```

`startCharged` is the only charge-related field needed — `chargeCount` is read directly from `ship.chargeSkillCharge` during auto-fill and baked into each debuff's `sourceChargeCount`. `startCharged` is stored on `TeamShipConfig` and applied at simulation time (see Simulation Merge below).

---

## Auto-Fill

Whenever the user selects (or re-selects) a ship for a team slot, call the existing `buildSkillBuffAutoFill(ship)`:
- `selfBuffs` → `teamShip.buffs` (via `mergeAutoFill`)
- `enemyDebuffs` → `teamShip.enemyDebuffs` (via `mergeAutoFill`)
- `detectFullyCharged([...ship skill texts])` → `teamShip.startCharged` (always overwritten, even on re-selection)

`buildSkillBuffAutoFill` already calls `detectFullyCharged` internally and stores the result as `sourceStartCharged` on each debuff entry. Calling it again explicitly for `startCharged` is intentional — it keeps the UI toggle value as a distinct, independently-readable field rather than requiring the implementer to reach into `enemyDebuffs[0].sourceStartCharged`. Because the user can toggle `startCharged` after auto-fill, `sourceStartCharged` on the individual debuffs is **overridden at simulation merge time** rather than kept in sync on every toggle.

---

## Simulation Merge

In `DPSCalculatorPage`, before passing to `simulateDPS`, merge team ship contributions into the global pools:

```typescript
// Override sourceStartCharged on team debuffs to reflect current UI toggle state
const teamEnemyDebuffs = teamShips.flatMap(t =>
    t.enemyDebuffs.map(d => ({ ...d, sourceStartCharged: t.startCharged }))
);
const teamAttackerBuffs = teamShips.flatMap(t => t.buffs);

// Per-ship simulation call:
selfBuffs:   [...attackerBuffs, ...teamAttackerBuffs, ...config.buffs]
enemyDebuffs: [...enemyBuffs,   ...teamEnemyDebuffs,  ...config.enemyDebuffs]
```

The override approach keeps `TeamShipConfig.startCharged` as the single source of truth, avoiding drift between the toggle and the baked-in debuff values.

### Display summary (`mergedAttackerBuffTotals`)

The existing `mergedAttackerBuffTotals` memo in `DPSCalculatorPage` feeds the stat summary shown in each `ShipConfigCard` footer. It currently combines `globalAttackerBuffTotals` (from `attackerBuffs`) with each config's own `buffs`. Team attacker buffs must also be included so the displayed effective stats match what is actually used in the simulation.

Update the `globalAttackerBuffTotals` memo to also sum over `teamAttackerBuffs`:

```typescript
const globalAttackerBuffTotals = useMemo(() => {
    const allGlobal = [...attackerBuffs, ...teamAttackerBuffs];
    return {
        attackBuff:     allGlobal.reduce((s, b) => s + (b.parsedEffects.attack     ?? 0) * b.stacks, 0),
        critBuff:       allGlobal.reduce((s, b) => s + (b.parsedEffects.crit       ?? 0) * b.stacks, 0),
        critDamageBuff: allGlobal.reduce((s, b) => s + (b.parsedEffects.critDamage ?? 0) * b.stacks, 0),
    };
}, [attackerBuffs, teamAttackerBuffs]);
```

`teamAttackerBuffs` should be derived as a stable memo (`useMemo`) over `teamShips` so this doesn't cause unnecessary recalculation.

---

## UI

### CombatSettingsPanel changes

Add a Team section at the bottom of the existing `CombatSettingsPanel` collapsible body (after the Attacker Buffs picker). Pass new props:

```typescript
teamShips: TeamShipConfig[];
onTeamShipsChange: (ships: TeamShipConfig[]) => void;
```

Render up to 4 `TeamShipRow` components followed by an "+ Add team ship" button (hidden when 4 are present).

---

### New component: `TeamShipRow`

Located at `src/components/calculator/TeamShipRow.tsx`.

**Collapsed state (header row):**
- `ShipSelector` (compact variant) for ship selection
- Expand/collapse chevron toggle
- Remove (×) button

**Expanded state (collapsible body, same `CollapsibleForm` pattern):**

Matches the Advanced section layout of `ShipConfigCard`:

1. **Skill Reference** — collapsible using `ShipSkillList`, only shown when a ship is selected. Same "Skill Reference" button pattern as `ShipConfigCard`.

2. **Start Charged** — `Checkbox` component. Auto-filled from `detectFullyCharged` on ship select. Toggling updates `teamShip.startCharged`; the simulation merge re-applies it to debuff schedule at compute time.

3. **Ship Buffs** — `GameBuffPicker` with `relevantStats` matching the per-ship Ship Buffs picker:
   ```
   ['attack', 'crit', 'critDamage', 'outgoingDamage', 'defensePenetration', 'dotDamage']
   ```
   Auto-filled entries show their `skillSource` badge (Active / Charged / Passive · duration) exactly as in `ShipConfigCard`.

4. **Applied Enemy Debuffs** — `GameBuffPicker` with `relevantStats`:
   ```
   ['defense', 'incomingDamage', 'incomingDotDamage']
   ```

No attack stat inputs, no DoT editors, no affinity selector — team ships don't deal damage.

---

## State Management (`DPSCalculatorPage`)

```typescript
const [teamShips, setTeamShips] = useState<TeamShipConfig[]>([]);
```

CRUD helpers follow the same pattern as `configs`:
- `addTeamShip()` — appends a blank `TeamShipConfig` (max 4)
- `removeTeamShip(id)` — filters out by id
- `selectShipForTeamSlot(id, ship)` — auto-fills buffs, debuffs, startCharged using existing helpers
- `updateTeamShip(id, updates)` — generic patch for individual field changes

`teamShips` is not persisted to URL state (URL already only carries `shipId` for the primary attacker). It persists within the session only.

---

## Verb Detection (no new parsing needed)

The user's described wording rules ("grants" → team buff, "applies/inflicts" → enemy debuff, "gains" → self buff) are already implemented in `skillTextParser.ts` via verb detection. No changes to the parser are needed — the existing `buildSkillBuffAutoFill` already routes effects to `selfBuffs` vs `enemyDebuffs` based on this logic.

---

## Files Changed

| File | Change |
|------|--------|
| `src/types/calculator.ts` | Add `TeamShipConfig` interface |
| `src/components/calculator/TeamShipRow.tsx` | New component |
| `src/components/calculator/CombatSettingsPanel.tsx` | Add Team section + new props |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Add `teamShips` state, CRUD helpers, simulation merge |

No changes to: `buffTimeline.ts`, `skillTextParser.ts`, `skillBuffAutoFill.ts`, `buffParser.ts`, `dpsSimulator.ts`.

---

## Changelog Entry

> Add team support ships to DPS Calculator — select up to 4 ships in Combat Settings to contribute their skill buffs and enemy debuffs to all attacker comparisons.

---

## Out of Scope

- Persisting team ships to URL or localStorage (session-only is sufficient for now)
- Team ship affinity (team ships don't deal damage, so affinity has no effect)
- DoT editors for team ships (team ships' DoTs don't contribute to the simulation)
