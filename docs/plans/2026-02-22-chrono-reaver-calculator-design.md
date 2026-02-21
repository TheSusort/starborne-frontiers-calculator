# Chrono Reaver Calculator Design

## Purpose

Help players understand and compare the efficiency of the Chrono Reaver (CR) ultimate implant across different ships and rarities. The calculator answers three questions:

1. **Is CR worth it for my ship?** — Compare output with CR vs without
2. **Epic vs Legendary?** — Quantify the upgrade difference
3. **Which ship benefits most?** — Compare CR efficiency across ships with different charge requirements

## Game Mechanics

### Chrono Reaver

- **Ultimate implant** that adds +1 charge to a ship's charged skill on proc turns
- **Legendary:** procs every other turn (turns 2, 4, 6, 8...)
- **Epic:** procs every 3rd turn (turns 3, 6, 9...)

### Charge System

- Ships need 2-4 charges to fire their charged attack
- Each turn using the active attack grants +1 charge
- When charges reach the required amount, the next turn fires the charged attack
- Charged attack **resets charges to 0**
- Charges **cannot exceed** the max required amount

### Turn Sequence

Each round follows this order:

1. If charges == max → fire **charged attack**, reset to 0
2. Else → fire **active attack**, gain +1 charge
3. CR procs (if applicable) → +1 charge, **capped at max**

### Wasted Procs

Because CR procs **after** the active charge gain, a proc is wasted when the active attack naturally fills the last charge on a CR proc turn. The ship is already at max, so the extra charge has nowhere to go.

## Inputs

Per ship config card:

- **Charges Required** — number input, range 2-4, default 4
- **CR Rarity** — select: None / Epic / Legendary
- **Active Skill %** — number input (e.g. 150)
- **Charged Skill %** — number input (e.g. 350)
- **Rounds to Simulate** — number input, default 20

Multi-ship comparison via "Add Ship" button (card-based, same pattern as Defense/DPS calculators).

## Turn Timeline Table

Each ship config displays a round-by-round table:

| Round | Charges | Action | CR | End Charges | Damage | Total |
|-------|---------|--------|----|-------------|--------|-------|
| 1 | 0 | Active | - | 1 | 150% | 150% |
| 2 | 1 | Active | +1 | 3 | 150% | 300% |
| 3 | 3 | Active | - | 4 | 150% | 450% |
| 4 | 4 | Charged | +1 | 1 | 350% | 800% |

- **Charged attack rows** highlighted with primary/green color
- **Wasted CR procs** marked with warning indicator (red/orange)
- Running total column for cumulative damage output

## Summary Metrics

Stat cards below each timeline:

- **Avg Damage % per Round** — total damage / rounds simulated
- **Charged Attack Frequency** — "every X rounds"
- **Wasted CR Procs** — count out of total procs (e.g. "1/10")
- **DPS Increase vs No CR** — percentage gain vs the same ship without CR

## Page Structure

- **Route:** `/chrono-reaver`
- **Page file:** `src/pages/calculators/ChronoReaverCalculatorPage.tsx`
- **Utility:** `src/utils/calculators/chronoReaver.ts` — pure calculation logic
- **Sidebar:** Under "Calculators" dropdown
- **Layout:** PageLayout header → "Add Ship" button → config cards grid (inputs + timeline + metrics)

## Technical Notes

- Purely client-side, no database or persistence
- Calculation utility is a pure function: inputs → round data + summary metrics
- Follows existing calculator patterns (PageLayout, card grid, stat cards)
