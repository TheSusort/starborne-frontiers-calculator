# Autogear → Gear Upgrade Analysis Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-ship "Find Gear Upgrades" button to autogear results that navigates to the Gear Upgrade Analysis tab with the ship, role, and stat priorities pre-filled and auto-starts the analysis.

**Architecture:** URL-param handoff from AutogearPage → GearPage → GearUpgradeAnalysis. AutogearPage builds `/gear?tab=analysis&shipId=X&role=Y&stats=a,b,c` and navigates. GearPage reads the new params and passes them as initial props to GearUpgradeAnalysis. GearUpgradeAnalysis initializes state from the props and auto-starts on mount.

**Tech Stack:** React 18, TypeScript, React Router v6, Vitest + React Testing Library

---

## File Map

| File | Change |
|------|--------|
| `src/pages/manager/AutogearPage.tsx` | Add `useNavigate`, add URL builder helper, add "Find Gear Upgrades" button per-ship in results |
| `src/pages/manager/GearPage.tsx` | Read `role` + `stats` URL params, add `initialRole` / `initialStats` state, pass to GearUpgradeAnalysis |
| `src/components/gear/GearUpgradeAnalysis.tsx` | Add `initialShipId`, `initialRole`, `initialStats` props; initialize state from props; add auto-start effect with ref guard |
| `src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx` | New — test auto-start fires once when `initialStats` is non-empty, does not fire when absent |

---

## Task 1: "Find Gear Upgrades" button in AutogearPage

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Add `useNavigate` to the react-router-dom import**

  File: `src/pages/manager/AutogearPage.tsx`, line 2.

  Change:
  ```tsx
  import { useSearchParams } from 'react-router-dom';
  ```
  To:
  ```tsx
  import { useSearchParams, useNavigate } from 'react-router-dom';
  ```

- [ ] **Step 2: Call `useNavigate` inside the component**

  Add after line 95 (`const [searchParams] = useSearchParams();`):
  ```tsx
  const navigate = useNavigate();
  ```

- [ ] **Step 3: Add the URL-builder helper**

  Add this function inside the component body, after the `updateShipConfig` helper (around line 237):
  ```tsx
  const handleFindGearUpgrades = (shipId: string) => {
      const ship = getShipById(shipId);
      if (!ship) return;
      const config = getShipConfig(shipId);
      const role = config.shipRole ?? ship.type;
      const statNames = config.statPriorities.map((p) => p.stat);
      const params = new URLSearchParams({ tab: 'analysis', shipId, role });
      if (statNames.length > 0) {
          params.set('stats', statNames.join(','));
      }
      navigate(`/gear?${params.toString()}`);
  };
  ```

- [ ] **Step 4: Add the button in the per-ship results loop**

  In the render section, find the per-ship results loop (around line 904). Each iteration renders a `<div key={shipId} className="space-y-4">` containing a `.gear-suggestions` div and optionally an "Unmet Stat Priorities" block. Add the button after the `.gear-suggestions` div, before the unmet priorities block:

  ```tsx
  {/* Find Gear Upgrades shortcut */}
  <div className="flex justify-end">
      <Button
          variant="secondary"
          size="sm"
          onClick={() => handleFindGearUpgrades(shipId)}
      >
          Find Gear Upgrades
      </Button>
  </div>
  ```

  The full updated block looks like:
  ```tsx
  return (
      <div key={shipId} className="space-y-4">
          <div className="gear-suggestions">
              <GearSuggestions ... />
          </div>

          {/* Find Gear Upgrades shortcut */}
          <div className="flex justify-end">
              <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleFindGearUpgrades(shipId)}
              >
                  Find Gear Upgrades
              </Button>
          </div>

          {/* Show unmet priorities warning */}
          {getUnmetPriorities(...).length > 0 && ( ... )}
      </div>
  );
  ```

- [ ] **Step 5: Run lint to check for TypeScript errors**

  ```bash
  npm run lint
  ```
  Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/manager/AutogearPage.tsx
  git commit -m "feat(autogear): add 'Find Gear Upgrades' button per ship in results"
  ```

---

## Task 2: Extend GearPage URL param reading

**Files:**
- Modify: `src/pages/manager/GearPage.tsx`

- [ ] **Step 1: Add missing imports**

  `SHIP_TYPES` is already imported. Add `ALL_STAT_NAMES` and the `ShipTypeName` type to the constants import, and add `StatName` from types:

  Change line 12:
  ```tsx
  import { SHIP_TYPES } from '../../constants';
  ```
  To:
  ```tsx
  import { SHIP_TYPES, ALL_STAT_NAMES } from '../../constants';
  import { ShipTypeName } from '../../constants/shipTypes';
  import { StatName } from '../../types/stats';
  ```

  > **Note:** Check the exact path for `ShipTypeName`. Run `grep -r "export.*ShipTypeName" src/constants/` to find it. If it re-exports from the barrel (`src/constants/index.tsx`), import from `'../../constants'` instead.

- [ ] **Step 2: Add `initialRole` and `initialStats` state**

  After line 35 (`const [initialSubTab, ...`), add:
  ```tsx
  const [initialRole, setInitialRole] = useState<ShipTypeName | null>(null);
  const [initialStats, setInitialStats] = useState<StatName[] | undefined>(undefined);
  ```

- [ ] **Step 3: Extend the URL-param useEffect to read `role` and `stats`**

  The existing effect (lines 44–66) reads `tab`, `subTab`, and `shipId`. Extend it to also read `role` and `stats` before the `replaceState` call:

  ```tsx
  useEffect(() => {
      const tab = searchParams.get('tab');
      const subTab = searchParams.get('subTab');
      const shipId = searchParams.get('shipId');
      const role = searchParams.get('role');
      const stats = searchParams.get('stats');

      if (tab && tabs.some((t) => t.id === tab)) {
          setActiveTab(tab);
      }

      if (subTab === 'candidates' || subTab === 'ship') {
          setInitialSubTab(subTab);
      }

      if (shipId) {
          setInitialShipId(shipId);
      }

      if (role && (Object.keys(SHIP_TYPES) as string[]).includes(role)) {
          setInitialRole(role as ShipTypeName);
      }

      if (stats) {
          const validStats = stats
              .split(',')
              .filter((s): s is StatName => (ALL_STAT_NAMES as string[]).includes(s));
          if (validStats.length > 0) {
              setInitialStats(validStats);
          }
      }

      // Clear URL params after reading
      if (tab || subTab || shipId || role || stats) {
          window.history.replaceState({}, '', window.location.pathname);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  ```

- [ ] **Step 4: Pass `initialShipId`, `initialRole`, `initialStats` to GearUpgradeAnalysis**

  Update the `activeTab === 'analysis'` block (around line 192):
  ```tsx
  {activeTab === 'analysis' && (
      <GearUpgradeAnalysis
          inventory={inventory}
          shipRoles={Object.keys(SHIP_TYPES)}
          mode="analysis"
          onEdit={handleEditPiece}
          initialShipId={initialShipId ?? undefined}
          initialRole={initialRole ?? undefined}
          initialStats={initialStats}
      />
  )}
  ```

  > **Note:** `initialShipId` is `string | null` — pass `initialShipId ?? undefined` so the prop receives `string | undefined`, not `string | null`.

- [ ] **Step 5: Run lint**

  ```bash
  npm run lint
  ```
  Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

  ```bash
  git add src/pages/manager/GearPage.tsx
  git commit -m "feat(gear-page): read role and stats URL params, pass as initial props to GearUpgradeAnalysis"
  ```

---

## Task 3: GearUpgradeAnalysis initial props + auto-start

**Files:**
- Modify: `src/components/gear/GearUpgradeAnalysis.tsx`
- Create: `src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx`

- [ ] **Step 1: Write the failing test**

  Create `src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { GearUpgradeAnalysis } from '../GearUpgradeAnalysis';

  // Mock all context hooks and the analysis utility
  vi.mock('../../../utils/gear/potentialCalculator', () => ({
      analyzePotentialUpgrades: vi.fn().mockReturnValue([]),
      baselineStatsCache: { clear: vi.fn() },
      baselineBreakdownCache: { clear: vi.fn() },
      simulateUpgrade: vi.fn(),
  }));

  vi.mock('../../../hooks/useGearUpgrades', () => ({
      useGearUpgrades: () => ({ simulateUpgrades: vi.fn(), clearUpgrades: vi.fn() }),
  }));

  vi.mock('../../../hooks/useNotification', () => ({
      useNotification: () => ({ addNotification: vi.fn() }),
  }));

  vi.mock('../../../contexts/ShipsContext', () => ({
      useShips: () => ({ ships: [] }),
  }));

  vi.mock('../../../hooks/useEngineeringStats', () => ({
      useEngineeringStats: () => ({ engineeringStats: { stats: [] } }),
  }));

  vi.mock('../../../hooks/useTutorialTrigger', () => ({
      useTutorialTrigger: vi.fn(),
  }));

  describe('GearUpgradeAnalysis auto-start', () => {
      beforeEach(() => {
          vi.useFakeTimers();
      });

      afterEach(() => {
          vi.useRealTimers();
          vi.clearAllMocks();
      });

      it('auto-starts analysis when initialStats is non-empty', () => {
          render(
              <GearUpgradeAnalysis
                  inventory={[]}
                  shipRoles={['ATTACKER'] as any}
                  mode="analysis"
                  initialStats={['security'] as any}
              />
          );
          // Auto-start fires on mount — button should show loading state
          expect(screen.getByRole('button', { name: /analyzing/i })).toBeInTheDocument();
      });

      it('does not auto-start when initialStats is absent', () => {
          render(
              <GearUpgradeAnalysis
                  inventory={[]}
                  shipRoles={['ATTACKER'] as any}
                  mode="analysis"
              />
          );
          // No auto-start — button shows default text
          expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
      });

      it('does not auto-start when initialStats is empty', () => {
          render(
              <GearUpgradeAnalysis
                  inventory={[]}
                  shipRoles={['ATTACKER'] as any}
                  mode="analysis"
                  initialStats={[]}
              />
          );
          expect(screen.getByRole('button', { name: /analyze gear/i })).toBeInTheDocument();
      });
  });
  ```

- [ ] **Step 2: Run the test to confirm it fails**

  ```bash
  npm test -- --run src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx
  ```
  Expected: FAIL — TypeScript error: `initialStats` does not exist on `Props` (or similar). The tests about auto-start behavior will also fail since the feature doesn't exist yet.

- [ ] **Step 3: Add `initialShipId`, `initialRole`, `initialStats` props to `GearUpgradeAnalysis`**

  File: `src/components/gear/GearUpgradeAnalysis.tsx`

  Update the `Props` interface (around line 25):
  ```tsx
  interface Props {
      inventory: GearPiece[];
      shipRoles: ShipTypeName[];
      mode: 'analysis' | 'simulation';
      onEdit?: (piece: GearPiece) => void;
      initialShipId?: string;
      initialRole?: ShipTypeName;
      initialStats?: StatName[];
  }
  ```

  Update the component signature (line 45):
  ```tsx
  export const GearUpgradeAnalysis: React.FC<Props> = ({
      inventory,
      shipRoles,
      mode,
      onEdit,
      initialShipId,
      initialRole,
      initialStats,
  }) => {
  ```

- [ ] **Step 4: Initialize state from the new props**

  Update these four `useState` calls to use the initial props as their initializers. Find each in the component and replace:

  ```tsx
  // Before:
  const [selectedRarity, setSelectedRarity] = useState<'rare' | 'epic' | 'legendary'>('rare');
  const [selectedRole, setSelectedRole] = useState<ShipTypeName | 'all'>('all');
  const [selectedStats, setSelectedStats] = useState<StatName[]>([]);
  const [statFilterMode, setStatFilterMode] = useState<'AND' | 'OR'>('AND');
  const [selectedShipId, setSelectedShipId] = useState<string | 'none'>('none');

  // After:
  const [selectedRarity, setSelectedRarity] = useState<'rare' | 'epic' | 'legendary'>('rare');
  const [selectedRole, setSelectedRole] = useState<ShipTypeName | 'all'>(initialRole ?? 'all');
  const [selectedStats, setSelectedStats] = useState<StatName[]>(initialStats ?? []);
  const [statFilterMode, setStatFilterMode] = useState<'AND' | 'OR'>(
      initialStats?.length ? 'OR' : 'AND'
  );
  const [selectedShipId, setSelectedShipId] = useState<string | 'none'>(initialShipId ?? 'none');
  ```

- [ ] **Step 5: Add `useRef` to the React import**

  File: `src/components/gear/GearUpgradeAnalysis.tsx`, line 1.

  Change:
  ```tsx
  import React, { useState, useEffect, useMemo } from 'react';
  ```
  To:
  ```tsx
  import React, { useState, useEffect, useMemo, useRef } from 'react';
  ```

- [ ] **Step 6: Add the ref guard and auto-start effect**

  Add the ref declaration near the top of the component body (after the state declarations):
  ```tsx
  const hasAutoStarted = useRef(false);
  ```

  Add the effect **after** the `handleAnalyze` function definition:
  ```tsx
  useEffect(() => {
      if (!initialStats?.length || hasAutoStarted.current) return;
      hasAutoStarted.current = true;
      void handleAnalyze();
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  ```

  > **Why the ref:** React 18 Strict Mode double-mounts components in development. Without the ref, the effect fires twice: first mount calls `handleAnalyze`, cleanup runs (but does nothing since the effect has no cleanup), then the second mount calls it again. The ref ensures it runs at most once regardless of mount count.

- [ ] **Step 7: Run the test to confirm it passes**

  ```bash
  npm test -- --run src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx
  ```
  Expected: All 3 tests PASS.

- [ ] **Step 8: Run full lint check**

  ```bash
  npm run lint
  ```
  Expected: 0 errors, 0 warnings.

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/gear/GearUpgradeAnalysis.tsx \
          src/components/gear/__tests__/GearUpgradeAnalysis.autostart.test.tsx
  git commit -m "feat(gear-upgrade): add initial props and auto-start from autogear handoff"
  ```

---

## Final Verification

- [ ] **Step 1: Run the full test suite**

  ```bash
  npm test -- --run
  ```
  Expected: All tests pass, no regressions.

- [ ] **Step 2: Start the dev server and test the full flow manually**

  ```bash
  npm start
  ```

  Test:
  1. Go to Autogear, select a ship, configure stat priorities (e.g. add Security and Speed), run autogear.
  2. After results appear, click "Find Gear Upgrades" next to the ship.
  3. Verify: Gear page opens on the "Upgrade Analysis" tab, the ship is pre-selected, the role filter matches the autogear role, Security and Speed are shown as active stat filters, and the analysis starts automatically.
  4. Go back to Autogear, run with a ship that has **no stat priorities**, click "Find Gear Upgrades".
  5. Verify: Gear page opens on Upgrade Analysis, ship and role are pre-filled, but no stat filters are active, and the analysis does **not** auto-start (user must click "Analyze Gear").
