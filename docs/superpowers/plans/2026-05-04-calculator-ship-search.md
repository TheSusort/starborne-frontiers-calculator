# Calculator Ship Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-calculator `ShipSelector` to all 5 ship-aware calculators so users can search their ship inventory and autofill stats without leaving the page.

**Architecture:** Each calculator file gets a `ShipSelector` rendered at the top of every config window (multi-config: DPS, Defense, Healing) or at the top of the form (single-config: Speed in Mode 1 only, Damage Deconstruction). A dedicated handler calls `calculateTotalStats` and atomically updates config state — same pattern already used by the `?shipId=` URL param path. No new shared components or hooks.

**Tech Stack:** React 18, TypeScript, existing `ShipSelector` component at `src/components/ship/ShipSelector.tsx`, `calculateTotalStats` from `src/utils/ship/statsCalculator.ts`

---

## File Map

| File | Change |
|---|---|
| `src/pages/calculators/DPSCalculatorPage.tsx` | Add `shipId?` to `ShipConfig`, add `selectShipForConfig`, render `ShipSelector` per config card |
| `src/pages/calculators/DefenseCalculatorPage.tsx` | Add `shipId?` to `ShipConfig`, add `selectShipForConfig`, render `ShipSelector` per config card |
| `src/pages/calculators/HealingCalculatorPage.tsx` | Add `shipId?` to `HealerConfig`, add `selectShipForConfig`, render `ShipSelector` per config card |
| `src/pages/calculators/SpeedCalculatorPage.tsx` | Add `selectedShip` state, add `handleShipSelect`, render `ShipSelector` inside Mode 1 block |
| `src/pages/calculators/DamageDeconstructionPage.tsx` | Add `selectedShip` state, add `handleShipSelect`, render `ShipSelector` at top of form |

No new files are created.

---

## Task 1: DPS Calculator

**File:** `src/pages/calculators/DPSCalculatorPage.tsx`

- [ ] **Step 1: Add `Ship` import and `ShipSelector` import**

  At line 1, alongside the existing imports, add:
  ```tsx
  import { Ship } from '../../types/ship';
  import { ShipSelector } from '../../components/ship/ShipSelector';
  ```

- [ ] **Step 2: Add `shipId?` to the `ShipConfig` interface**

  Modify the `ShipConfig` interface (currently around line 30) to add the optional field:
  ```ts
  interface ShipConfig {
      id: string;
      shipId?: string;   // links config to a selected player ship
      name: string;
      attack: number;
      crit: number;
      critDamage: number;
      defensePenetration: number;
      activeMultiplier: number;
      chargedMultiplier: number;
      chargeCount: number;
      activeDoTs: DoTApplicationConfig;
      chargedDoTs: DoTApplicationConfig;
  }
  ```

- [ ] **Step 3: Add `selectShipForConfig` handler**

  Add this function inside the component body, after the existing `updateConfig` function (around line 225):
  ```ts
  const selectShipForConfig = (configId: string, ship: Ship) => {
      const engineeringStats = ship.type
          ? getEngineeringStatsForShipType(ship.type)
          : undefined;
      const statsBreakdown = calculateTotalStats(
          ship.baseStats,
          ship.equipment || {},
          getGearPiece,
          ship.refits,
          ship.implants,
          engineeringStats,
          ship.id
      );
      const final = statsBreakdown.final;
      setConfigs((prev) =>
          prev.map((c) =>
              c.id === configId
                  ? {
                        ...c,
                        shipId: ship.id,
                        name: ship.name,
                        attack: Math.round(final.attack),
                        crit: Math.round(final.crit),
                        critDamage: Math.round(final.critDamage),
                        defensePenetration: Math.round(final.defensePenetration || 0),
                    }
                  : c
          )
      );
  };
  ```

- [ ] **Step 4: Render `ShipSelector` at the top of each config card**

  Inside the `configs.map((config) => ...)` render block, add `ShipSelector` as the first child of the config card `<div>`, before the `<div className="flex justify-between items-center mb-4">` name/remove row (around line 444):

  ```tsx
  <div key={config.id} className={`p-4 bg-dark border ...`}>
      <div className="mb-4">
          <ShipSelector
              selected={config.shipId ? (getShipById(config.shipId) ?? null) : null}
              onSelect={(ship) => selectShipForConfig(config.id, ship)}
              variant="compact"
          />
      </div>
      <div className="flex justify-between items-center mb-4">
          {/* existing name input + remove button */}
      </div>
      {/* ... rest unchanged */}
  ```

- [ ] **Step 5: Run lint and type check**

  ```bash
  npm run lint && npx tsc --noEmit
  ```
  Expected: no errors or warnings.

- [ ] **Step 6: Start dev server and verify**

  ```bash
  npm start
  ```
  Open http://localhost:5173/damage. Verify:
  - Each config window shows a "Select a Ship" button at the top
  - Clicking opens the ship selector modal with search
  - Selecting a ship fills `name`, `attack`, `crit`, `critDamage`, `defensePenetration`
  - Fields remain editable after autofill
  - Adding a new config shows a fresh selector with no ship selected
  - `?shipId=` URL param still works (navigate from a ship card)

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/calculators/DPSCalculatorPage.tsx
  git commit -m "feat: add ship selector to DPS calculator config windows"
  ```

---

## Task 2: Defense Calculator

**File:** `src/pages/calculators/DefenseCalculatorPage.tsx`

- [ ] **Step 1: Add `Ship` import and `ShipSelector` import**

  Add alongside existing imports at the top of the file:
  ```tsx
  import { Ship } from '../../types/ship';
  import { ShipSelector } from '../../components/ship/ShipSelector';
  ```

- [ ] **Step 2: Add `shipId?` to `ShipConfig`**

  Modify the `ShipConfig` interface (around line 17):
  ```ts
  interface ShipConfig {
      id: string;
      shipId?: string;   // links config to a selected player ship
      name: string;
      hp: number;
      defense: number;
      effectiveHP?: number;
      damageReduction?: number;
  }
  ```

- [ ] **Step 3: Add `selectShipForConfig` handler**

  Add inside the component body after the existing `updateConfig` function (around line 161). Note: `defence` (stats object field) maps to `defense` (form field).

  ```ts
  const selectShipForConfig = (configId: string, ship: Ship) => {
      const engineeringStats = ship.type
          ? getEngineeringStatsForShipType(ship.type)
          : undefined;
      const statsBreakdown = calculateTotalStats(
          ship.baseStats,
          ship.equipment || {},
          getGearPiece,
          ship.refits,
          ship.implants,
          engineeringStats,
          ship.id
      );
      const final = statsBreakdown.final;
      const hp = Math.round(final.hp);
      const defense = Math.round(final.defence);
      setConfigs((prev) =>
          prev.map((c) =>
              c.id === configId
                  ? {
                        ...c,
                        shipId: ship.id,
                        name: ship.name,
                        hp,
                        defense,
                        damageReduction: calculateDamageReduction(defense),
                        effectiveHP: calculateEffectiveHP(hp, defense),
                    }
                  : c
          )
      );
  };
  ```

- [ ] **Step 4: Render `ShipSelector` at the top of each config card**

  Inside the `configs.map((config) => ...)` block, add `ShipSelector` as the first child of the card `<div>` (around line 192), before the `<div className="flex justify-between items-center mb-4">` row:

  ```tsx
  <div key={config.id} className={`card relative ${...}`}>
      <div className="mb-4">
          <ShipSelector
              selected={config.shipId ? (getShipById(config.shipId) ?? null) : null}
              onSelect={(ship) => selectShipForConfig(config.id, ship)}
              variant="compact"
          />
      </div>
      <div className="flex justify-between items-center mb-4">
          {/* existing name input + remove button */}
      </div>
      {/* ... rest unchanged */}
  ```

- [ ] **Step 5: Run lint and type check**

  ```bash
  npm run lint && npx tsc --noEmit
  ```
  Expected: no errors or warnings.

- [ ] **Step 6: Start dev server and verify**

  Open http://localhost:5173/defense. Verify:
  - Each config card shows a "Select a Ship" button at the top
  - Selecting a ship fills `name`, `hp`, `defense`
  - `effectiveHP` and `damageReduction` update immediately (derived from filled values)
  - Fields remain editable after autofill

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/calculators/DefenseCalculatorPage.tsx
  git commit -m "feat: add ship selector to Defense calculator config windows"
  ```

---

## Task 3: Healing Calculator

**File:** `src/pages/calculators/HealingCalculatorPage.tsx`

- [ ] **Step 1: Add `Ship` import and `ShipSelector` import**

  Add alongside existing imports:
  ```tsx
  import { Ship } from '../../types/ship';
  import { ShipSelector } from '../../components/ship/ShipSelector';
  ```

- [ ] **Step 2: Add `shipId?` to `HealerConfig`**

  Modify the `HealerConfig` interface (around line 28):
  ```ts
  interface HealerConfig {
      id: string;
      shipId?: string;   // links config to a selected player ship
      name: string;
      hp: number;
      healPercent: number;
      crit: number;
      critDamage: number;
      healModifier: number;
      healing?: number;
      healingWithCrit?: number;
      effectiveHealing?: number;
  }
  ```

- [ ] **Step 3: Add `selectShipForConfig` handler**

  Add inside the component body after the existing `updateConfig` function (around line 228). Note: `healPercent` is NOT populated from the ship — it stays at whatever value the config already has (default 15).

  ```ts
  const selectShipForConfig = (configId: string, ship: Ship) => {
      const engineeringStats = ship.type
          ? getEngineeringStatsForShipType(ship.type)
          : undefined;
      const statsBreakdown = calculateTotalStats(
          ship.baseStats,
          ship.equipment || {},
          getGearPiece,
          ship.refits,
          ship.implants,
          engineeringStats,
          ship.id
      );
      const final = statsBreakdown.final;
      setConfigs((prev) =>
          prev.map((c) => {
              if (c.id !== configId) return c;
              const updated = {
                  ...c,
                  shipId: ship.id,
                  name: ship.name,
                  hp: Math.round(final.hp),
                  crit: Math.round(final.crit),
                  critDamage: Math.round(final.critDamage),
              };
              const { baseHealing, critMultiplier, effectiveHealing } = calculateHealing(updated);
              return {
                  ...updated,
                  healing: baseHealing,
                  healingWithCrit: baseHealing * critMultiplier,
                  effectiveHealing,
              };
          })
      );
  };
  ```

- [ ] **Step 4: Render `ShipSelector` at the top of each config card**

  Inside the `configs.map((config) => ...)` block (around line 380), add `ShipSelector` as the first child of the card `<div>`, before the `<div className="flex justify-between items-center mb-4">` row:

  ```tsx
  <div key={config.id} className={`card relative ${...}`}>
      <div className="mb-4">
          <ShipSelector
              selected={config.shipId ? (getShipById(config.shipId) ?? null) : null}
              onSelect={(ship) => selectShipForConfig(config.id, ship)}
              variant="compact"
          />
      </div>
      <div className="flex justify-between items-center mb-4">
          {/* existing name input + remove button */}
      </div>
      {/* ... rest unchanged */}
  ```

- [ ] **Step 5: Run lint and type check**

  ```bash
  npm run lint && npx tsc --noEmit
  ```
  Expected: no errors or warnings.

- [ ] **Step 6: Start dev server and verify**

  Open http://localhost:5173/healing. Verify:
  - Each config card shows a "Select a Ship" button at the top
  - Selecting a ship fills `name`, `hp`, `crit`, `critDamage`
  - `healPercent` is NOT changed (stays at 15 or whatever the user set)
  - `effectiveHealing`, `healing`, `healingWithCrit` update immediately
  - Fields remain editable after autofill

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/calculators/HealingCalculatorPage.tsx
  git commit -m "feat: add ship selector to Healing calculator config windows"
  ```

---

## Task 4: Speed Calculator

**File:** `src/pages/calculators/SpeedCalculatorPage.tsx`

- [ ] **Step 1: Add `Ship` import and `ShipSelector` import**

  Add alongside existing imports:
  ```tsx
  import { Ship } from '../../types/ship';
  import { ShipSelector } from '../../components/ship/ShipSelector';
  ```

- [ ] **Step 2: Add `selectedShip` state**

  Add inside the component body, alongside the other Mode 1 state (around line 80):
  ```ts
  const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
  ```

- [ ] **Step 3: Add `handleShipSelect` handler**

  Add inside the component body, after the Mode 1 functions (around line 144):
  ```ts
  const handleShipSelect = (ship: Ship) => {
      const engineeringStats = ship.type
          ? getEngineeringStatsForShipType(ship.type)
          : undefined;
      const statsBreakdown = calculateTotalStats(
          ship.baseStats,
          ship.equipment || {},
          getGearPiece,
          ship.refits,
          ship.implants,
          engineeringStats,
          ship.id
      );
      setSelectedShip(ship);
      setBaseSpeed(Math.round(statsBreakdown.final.speed));
  };
  ```

- [ ] **Step 4: Render `ShipSelector` inside the Mode 1 block, before the "Base Speed" card**

  The Mode 1 block starts at `{activeMode === 'forward' && (` (around line 197). Add `ShipSelector` as the first element inside `<div className="space-y-6">`:

  ```tsx
  {activeMode === 'forward' && (
      <div className="space-y-6">
          <ShipSelector
              selected={selectedShip}
              onSelect={handleShipSelect}
              variant="compact"
          />

          <div className="card">
              <h3 className="text-lg font-bold mb-4">Base Speed</h3>
              <Input
                  label="Base Speed"
                  {/* ... unchanged */}
              />
          </div>
          {/* ... rest of Mode 1 unchanged */}
      </div>
  )}
  ```

- [ ] **Step 5: Run lint and type check**

  ```bash
  npm run lint && npx tsc --noEmit
  ```
  Expected: no errors or warnings.

- [ ] **Step 6: Start dev server and verify**

  Open http://localhost:5173/speed. Verify:
  - Mode 1 tab shows a "Select a Ship" button above the Base Speed card
  - Selecting a ship populates `baseSpeed` and the final speed recalculates
  - Mode 2 tab has NO ship selector
  - Switching between tabs does not reset the selected ship or base speed

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/calculators/SpeedCalculatorPage.tsx
  git commit -m "feat: add ship selector to Speed calculator (Mode 1 only)"
  ```

---

## Task 5: Damage Deconstruction Calculator

**File:** `src/pages/calculators/DamageDeconstructionPage.tsx`

- [ ] **Step 1: Add `Ship` import and `ShipSelector` import**

  Add alongside existing imports:
  ```tsx
  import { Ship } from '../../types/ship';
  import { ShipSelector } from '../../components/ship/ShipSelector';
  ```

- [ ] **Step 2: Add `selectedShip` state**

  Add inside the component body, alongside the existing `form` state (around line 87):
  ```ts
  const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
  ```

- [ ] **Step 3: Add `handleShipSelect` handler**

  Add inside the component body, after the `?shipId=` cleanup `useEffect` (around line 97):
  ```ts
  const handleShipSelect = (ship: Ship) => {
      const engineeringStats = ship.type
          ? getEngineeringStatsForShipType(ship.type)
          : undefined;
      const statsBreakdown = calculateTotalStats(
          ship.baseStats,
          ship.equipment || {},
          getGearPiece,
          ship.refits,
          ship.implants,
          engineeringStats,
          ship.id
      );
      const final = statsBreakdown.final;
      setSelectedShip(ship);
      setForm((prev) => ({
          ...prev,
          shipAttack: Math.round(final.attack),
          critDamagePercent: Math.round(final.critDamage),
          defensePenetration: Math.round(final.defensePenetration || 0),
      }));
  };
  ```

- [ ] **Step 4: Render `ShipSelector` at the top of the form**

  Find the return statement's `<PageLayout>` content. Add `ShipSelector` as the very first element inside the page content, before the first input/card (check the file around line 120+ for the JSX structure):

  ```tsx
  <PageLayout title="Hit Deconstruction" ...>
      <div className="space-y-6">  {/* or whatever wrapper exists */}
          <ShipSelector
              selected={selectedShip}
              onSelect={handleShipSelect}
              variant="compact"
          />
          {/* existing form inputs below, unchanged */}
      </div>
  </PageLayout>
  ```

- [ ] **Step 5: Run lint and type check**

  ```bash
  npm run lint && npx tsc --noEmit
  ```
  Expected: no errors or warnings.

- [ ] **Step 6: Start dev server and verify**

  Open http://localhost:5173/damage-deconstruction. Verify:
  - "Select a Ship" button appears at the top of the page
  - Selecting a ship fills `shipAttack`, `critDamagePercent`, `defensePenetration`
  - Other fields (`actualDamage`, `attackBuffs`, etc.) are unchanged
  - Fields remain editable after autofill

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/calculators/DamageDeconstructionPage.tsx
  git commit -m "feat: add ship selector to Damage Deconstruction calculator"
  ```

---

## Final Step: Smoke test all 5 calculators

- [ ] Run the dev server and visit all 5 calculator routes in order
- [ ] Confirm no regressions on existing calculator functionality (charts, table views, remove buttons, buff entries, etc.)
- [ ] Confirm `?shipId=` links from ship card dropdowns still work on all 5
- [ ] Run final lint check: `npm run lint`
