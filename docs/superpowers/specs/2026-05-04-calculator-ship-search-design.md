# Calculator Ship Search — Design Spec

**Date:** 2026-05-04
**Status:** Approved

## Problem

Calculators can be pre-populated from a ship card via `?shipId=` URL param, but there is no way to search for and load a ship from within a calculator itself. Users who navigate directly to a calculator must enter all stats manually.

## Goal

Add an in-calculator ship selector to each of the 5 ship-aware manual calculators so users can search their ship inventory and autofill calculator fields without leaving the page.

## Scope

### In scope

- **DPS Calculator** (`/damage`)
- **Defense Calculator** (`/defense`)
- **Healing Calculator** (`/healing`)
- **Speed Calculator** (`/speed`)
- **Damage Deconstruction** (`/damage-deconstruction`)

### Out of scope

- ChronoReaver Calculator — no player ship stats
- Recruitment Calculator — uses ship names from game data, not player inventory
- JsonDiff Calculator — not stat-based

## Behavior

### Autofill is a one-shot snapshot

Selecting a ship calls `calculateTotalStats()` and populates the relevant fields at that moment. Fields remain manually editable after autofill. There is no live sync between the calculator and the ship's current gear/stats.

### Multi-config calculators (DPS, Defense, Healing)

All three maintain a `configs` array and render per-card config windows. Each config window gets its own `ShipSelector` at the top. Selecting a ship autofills that window's stat fields and sets the config name to the ship's name. Adding a new config window initialises with no ship selected and empty fields — the selector is an optional shortcut.

The config interfaces for Defense (`ShipConfig`) and Healing (`HealerConfig`) gain an optional `shipId?: string` field, the same as DPS.

### Single-config calculators (Speed, Damage Deconstruction)

`ShipSelector` renders at the top of the calculator form. Selecting a ship replaces all autofillable fields with the ship's computed stats.

**Speed calculator:** `ShipSelector` appears only in the "Calculate Final Speed" tab (Mode 1). It does not appear in, or affect, the "Find Base Speed Range" (Mode 2) tab.

### Existing `?shipId=` URL param

Untouched. The `useEffect` on mount still fires, populates fields, and clears the param. The `ShipSelector` is independent state — no conflict.

## Component Design

### ShipSelector (existing — no changes)

`src/components/ship/ShipSelector.tsx` already provides:
- "Select a Ship" button → full-height modal with search input + ship grid
- `selected: Ship | null` + `onSelect: (ship: Ship) => void` props
- Handles empty inventory gracefully

Each calculator imports and renders `ShipSelector` directly — no new shared components or hooks.

### Stat mappings

| Calculator | `calculateTotalStats()` field | Form field |
|---|---|---|
| DPS | `attack`, `crit`, `critDamage`, `defensePenetration` | same; `ship.name` → config `name` |
| Defense | `hp`, `defence` | `hp`, `defense` (note spelling difference) |
| Healing | `hp`, `crit`, `critDamage` | same |
| Speed | `speed` | `baseSpeed` |
| Damage Deconstruction | `attack`, `critDamage`, `defensePenetration` | `shipAttack`, `critDamagePercent`, `defensePenetration` |

### Config state changes

All three multi-config calculators (DPS, Defense, Healing) add `shipId?: string` to their config interface:

```ts
// applies to ShipConfig (DPS & Defense) and HealerConfig (Healing)
interface ShipConfig {
  id: string;
  shipId?: string;   // new — links config to a selected player ship
  name: string;
  // ... unchanged fields
}
```

### Ship selection handler (multi-config calculators)

Selecting a ship in a config window requires atomically updating multiple fields — `shipId`, `name`, and all stat fields — in a single `setConfigs` call. Use a dedicated `selectShipForConfig(configId: string, ship: Ship)` handler rather than routing through the existing `updateConfig(id, field, value)` function (which handles only single-field updates). This matches the pattern already used by the `?shipId=` path.

The handler lives inside the component body and uses the same hooks already present for the `?shipId=` path: `getGearPiece` (from `useInventory`) and `getEngineeringStatsForShipType` (from `useEngineeringStats`).

`calculateTotalStats` returns a `statsBreakdown` object; the final computed stats are in `statsBreakdown.final`.

```ts
// DPS example — Defense and Healing follow the same atomic pattern with their own fields
const selectShipForConfig = (configId: string, ship: Ship) => {
    const engineeringStatsForShip = getEngineeringStatsForShipType(ship.type);
    const statsBreakdown = calculateTotalStats(
        ship.baseStats,
        ship.equipment || {},
        getGearPiece,
        ship.refits,
        ship.implants,
        engineeringStatsForShip,
        ship.id
    );
    const final = statsBreakdown.final;
    setConfigs(prev => prev.map(c =>
        c.id === configId
            ? {
                ...c,
                shipId: ship.id,
                name: ship.name,
                attack: Math.round(final.attack),
                crit: final.crit,
                critDamage: final.critDamage,
                defensePenetration: final.defensePenetration,
              }
            : c
    ));
};
```

**Note on Healing:** `healPercent` is a Healing-only field not derivable from `calculateTotalStats`. It is not autofilled — it stays at its default value (15). Only `hp`, `crit`, and `critDamage` are populated from the selected ship.

## Data Flow

1. User renders calculator (no ship selected)
2. `ShipSelector` shows "Select a Ship" button
3. User clicks → modal opens with search input and ship grid
4. User selects a ship → `onSelect(ship)` fires
5. Calculator calls `calculateTotalStats(ship, gearItems, engineeringStats)` — same utility used by `?shipId=` path
6. Calculator maps relevant stats into its existing state setters atomically
7. Modal closes, fields are populated and remain editable

## Edge Cases

| Case | Handling |
|---|---|
| No ships in inventory | `ShipSelector` shows "No ships available" (existing behaviour) |
| User edits field after autofill | Field stays editable, no re-sync |
| `?shipId=` URL param + ship selector on same load | URL param populates on mount; selector starts with `null` — independent, no conflict |
| New multi-config window | Initialises with `selectedShip: null`, empty fields — selector is optional |
| Speed calculator Mode 2 tab | No ship selector rendered; tab is unaffected |
