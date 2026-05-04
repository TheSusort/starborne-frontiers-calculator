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

### Single-config calculators (Defense, Healing, Speed, Damage Deconstruction)

`ShipSelector` renders at the top of the calculator form. Selecting a ship replaces all autofillable fields with the ship's computed stats.

### DPS Calculator (multi-config)

Each config "window" gets its own `ShipSelector` at the top. Selecting a ship autofills that window's stat fields and sets the config name to the ship's name. Adding a new config window initialises with no ship selected and empty fields — same as today, the selector is an optional shortcut.

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

| Calculator | `calculateTotalStats()` field → form field |
|---|---|
| DPS | `attack`, `crit`, `critDamage`, `defensePenetration`; `ship.name` → config `name` |
| Defense | `hp`, `defence` |
| Healing | `hp`, `crit`, `critDamage` |
| Speed | `speed` → `baseSpeed` |
| Damage Deconstruction | `attack` → `shipAttack`, `critDamage` → `critDamagePercent`, `defensePenetration` |

### DPS config state change

`ShipConfig` gains an optional `shipId?: string` field alongside existing fields. This allows `ShipSelector` to reflect the currently linked ship when a config already has one selected.

```ts
interface ShipConfig {
  id: string;
  shipId?: string;   // new — links config to a player ship
  name: string;
  attack: number;
  crit: number;
  critDamage: number;
  defensePenetration: number;
  // ... unchanged fields
}
```

## Data Flow

1. User renders calculator (no ship selected)
2. `ShipSelector` shows "Select a Ship" button
3. User clicks → modal opens with search input and ship grid
4. User selects a ship → `onSelect(ship)` fires
5. Calculator calls `calculateTotalStats(ship, gearItems, engineeringStats)` — same utility used by `?shipId=` path
6. Calculator maps relevant stats into its existing state setters
7. Modal closes, fields are populated and remain editable

## Edge Cases

| Case | Handling |
|---|---|
| No ships in inventory | `ShipSelector` shows "No ships available" (existing behaviour) |
| User edits field after autofill | Field stays editable, no re-sync |
| `?shipId=` URL param + ship selector on same load | URL param populates on mount; selector starts with `null` — independent, no conflict |
| New DPS config window | Initialises with `selectedShip: null`, empty fields — selector is optional |
