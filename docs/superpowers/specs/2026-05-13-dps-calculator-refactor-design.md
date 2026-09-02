# DPS Calculator Page Refactor — Design Spec

**Date:** 2026-05-13  
**Status:** Approved

## Goal

Break `DPSCalculatorPage.tsx` (1355 lines) into focused, independently readable pieces. No behaviour changes — pure structural refactor.

## Types & Constants

**`src/types/calculator.ts`** — add `DPSShipConfig` interface (renamed from the page's local `ShipConfig` to avoid collision with the identically-named local interface in `DPSChart.tsx` and other calculator pages). The file already contains the related `Buff`, `DoTApplicationConfig`, `DoTApplicationEntry`, `DoTType`, `DEFAULT_DOT_CONFIG`, `SelectedGameBuff` types.

`DPSChart.tsx` has its own local `interface ShipConfig` with a different shape (`critRate`, `isBest` fields). That type is renamed to `DPSChartShipEntry` as part of this refactor to eliminate ambiguity.

**`DOT_TYPE_OPTIONS` / `TIER_OPTIONS_BY_TYPE`** — move into `DoTEditor.tsx`. Only that component uses them; no need for a separate constants file.

## Helper Functions

**`src/utils/calculators/dpsBuffHelpers.ts`** — new file exporting three pure functions currently inlined at the top of the page:

- `toSimBuffs(selected: SelectedGameBuff[]): Buff[]`
- `toEnemyModifiers(selected: SelectedGameBuff[]): { enemyDefenseModifier, incomingDamageModifier }`
- `toDotAndPenModifiers(attacker, enemy): { defensePenetrationBuff, dotDamageModifier }`

## New Components (`src/components/calculator/`)

### `CombatSettingsPanel.tsx`

The collapsible section with enemy stats and buff pickers. Stateless — all values flow in as props.

**Props:**
- `isOpen: boolean`, `onToggle: () => void`
- `enemyDefense: number`, `onEnemyDefenseChange: (v: number) => void`
- `enemyHp: number`, `onEnemyHpChange: (v: number) => void`
- `rounds: number`, `onRoundsChange: (v: number) => void`
- `attackerBuffs: SelectedGameBuff[]`, `onAttackerBuffsChange: (v: SelectedGameBuff[]) => void`
- `enemyBuffs: SelectedGameBuff[]`, `onEnemyBuffsChange: (v: SelectedGameBuff[]) => void`

The rounds clamping (`Math.max(1, Math.min(50, value))`) lives inside `CombatSettingsPanel` — it owns the input constraints and passes the already-clamped value to `onRoundsChange`.

### `DoTEditor.tsx`

Replaces ~200 lines of near-identical duplicated DoT markup used for both active and charged DoTs.

**Props:**
- `dots: DoTApplicationConfig`
- `label: string` — section heading text
- `labelClassName: string` — e.g. `"text-orange-400"` vs `"text-purple-400"`
- `onAdd: () => void`
- `onRemove: (dotId: string) => void`
- `onUpdate: (dotId: string, updates: Partial<DoTApplicationEntry>) => void`

### `ShipConfigSummary.tsx`

The stats readout at the bottom of each card: crit multiplier, avg damage/round, total damage, DoT breakdown grid, best/compare labels. Pure display — no callbacks.

**Props:**
- `config: DPSShipConfig`
- `simResult: DPSSimulationResult`
- `isBest: boolean`
- `rounds: number`
- `attackerBuffTotals: { attackBuff: number; critBuff: number; critDamageBuff: number }`
- `bestTotalDamage: number | undefined`
- `bestVsSecondPercentage: number | null`

Note: `bestConfig` is **not** a prop — the "Compared to best" percentage is computed from `bestTotalDamage` (already available) and `simResult.summary.totalDamage`.

### `ShipConfigCard.tsx`

The full ship card. Uses `DoTEditor` × 2 (active + charged DoTs) and `ShipConfigSummary` internally.

**Key simplification:** `openAdvanced` and `skillRefOpen` currently live as `Set<string>` in the page keyed by `configId`. Each card becoming its own component lets these become simple local `useState(false)` booleans, eliminating that complexity from the page entirely. The `setSkillRefOpen` cleanup call in `removeConfig` is also dropped — it no longer exists.

**`onUpdate` field type** is a tighter union of only the mutable text/number fields:
```ts
type UpdateableField = 'name' | 'attack' | 'crit' | 'critDamage' | 'defensePenetration' | 'activeMultiplier' | 'chargedMultiplier' | 'chargeCount'
```
`startCharged` is handled by the separate `onStartChargedChange` callback (it requires a boolean, not string | number).

**Props:**
- `config: DPSShipConfig`
- `isBest: boolean`
- `simResult: DPSSimulationResult | undefined`
- `bestTotalDamage: number | undefined`
- `bestVsSecondPercentage: number | null`
- `rounds: number`
- `attackerBuffTotals: { attackBuff: number; critBuff: number; critDamageBuff: number }`
- `onRemove: () => void`
- `onUpdate: (field: UpdateableField, value: string | number) => void`
- `onSelectShip: (ship: Ship) => void`
- `onStartChargedChange: (checked: boolean) => void`
- `onAddDoT: (dotField: 'activeDoTs' | 'chargedDoTs') => void`
- `onRemoveDoT: (dotField: 'activeDoTs' | 'chargedDoTs', dotId: string) => void`
- `onUpdateDoT: (dotField: 'activeDoTs' | 'chargedDoTs', dotId: string, updates: Partial<DoTApplicationEntry>) => void`

## Page File After Refactor

`DPSCalculatorPage.tsx` reduces to ~150 lines:

- URL param initialisation (`getInitialConfig`, `shipInitialized` ref)
- State declarations (`configs`, `nextId`, `enemyDefense`, `enemyHp`, `rounds`, `viewMode`, `attackerBuffs`, `enemyBuffs`, `combatSettingsOpen`)
- Derived memos (`attackerBuffTotals`, `simResults`, `bestConfig`, `secondBestConfig`, `bestVsSecondPercentage`)
- Handlers (`addConfig`, `removeConfig`, `updateConfig`, `selectShipForConfig`, `addDoTEntry`, `removeDoTEntry`, `updateDoTEntry`) — `removeConfig` no longer needs to clean up `skillRefOpen`
- Render: `CombatSettingsPanel`, ship cards grid (`ShipConfigCard` × n), DPS Comparison, Damage Over Time, Defense Penetration, About sections

## What Does NOT Change

- No logic changes — same simulation, same buff calculations, same UI behaviour
- Existing components (`DPSCalculatorTable`, `DPSChart`, `DPSRoundChart`, `DefensePenetrationChart`, `GameBuffPicker`) are untouched
- No new abstractions beyond the four components above
