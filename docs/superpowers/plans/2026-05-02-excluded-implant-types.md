# Excluded Implant Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Excluded implant type" tweak to the per-ship autogear config so users can prevent specific implant types (e.g. Bulwark) from being used in autogear runs.

**Architecture:** Add `excludedImplantTypes: string[]` to the autogear config data model and to the `shipConfigs` runtime state, wire a filter check into the inventory filter in `AutogearPage.tsx`, and extend the existing tweaks picker/form/list in `AutogearSettings.tsx` with a new `'excludedImplant'` tweak type. The feature is per-ship and only active when `optimizeImplants` is enabled.

**Tech Stack:** React 18, TypeScript, TailwindCSS, Vitest

**Spec:** `docs/superpowers/specs/2026-05-02-excluded-implant-types-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/types/autogear.ts` | Add `excludedImplantTypes?: string[]` to `SavedAutogearConfig` |
| `src/pages/manager/AutogearPage.tsx` | Update local state type, `getShipConfig` defaults, persistence literal, `onResetConfig`, add filter check, derive `availableImplantTypes` memo, add event handlers, pass new props to modal |
| `src/components/autogear/AutogearSettings.tsx` | Extend `TweakView`, widen `openForm`, add `ExcludedImplantForm`, add picker option, add list section, update tweak count/empty-state, add new props |
| `src/components/autogear/AutogearSettingsModal.tsx` | Add four new props to `AutogearSettingsModalProps` |
| `src/utils/autogear/__tests__/excludedImplantFilter.test.ts` | New test for the exclusion filter logic |

---

## Task 1: Data model — all type and defaults changes

This task covers every place the new field must be declared before any runtime code accesses it. All four locations are in two files and must be done together so that subsequent tasks compile cleanly.

**Files:**
- Modify: `src/types/autogear.ts`
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Add `excludedImplantTypes` to `SavedAutogearConfig`**

  Open `src/types/autogear.ts`. After `useArenaModifiers?: boolean;` (last field, line ~43), add:

  ```typescript
  excludedImplantTypes?: string[];
  ```

- [ ] **Step 2: Add `excludedImplantTypes` to the `shipConfigs` inline state type**

  Open `src/pages/manager/AutogearPage.tsx`. Find the `shipConfigs` useState (around line 111) — it has an inline Record type. After `useArenaModifiers: boolean;`, add:

  ```typescript
  excludedImplantTypes: string[];
  ```

- [ ] **Step 3: Add `excludedImplantTypes` to `getShipConfig` defaults**

  Find the defaults object returned by `getShipConfig` (around line 211). After `useArenaModifiers: false,`, add:

  ```typescript
  excludedImplantTypes: [],
  ```

- [ ] **Step 4: Run lint**

  Run: `npm run lint`
  Expected: passes (zero new errors)

- [ ] **Step 5: Commit**

  ```bash
  git add src/types/autogear.ts src/pages/manager/AutogearPage.tsx
  git commit -m "feat: add excludedImplantTypes to SavedAutogearConfig and shipConfigs state"
  ```

---

## Task 2: Filtering logic + test

**Files:**
- Create: `src/utils/autogear/__tests__/excludedImplantFilter.test.ts`
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Write the test**

  Create `src/utils/autogear/__tests__/excludedImplantFilter.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { GearPiece } from '../../../types/gear';

  // Inline the filter predicate to test it independently of the page component.
  function isExcludedByImplantType(
      gear: Pick<GearPiece, 'slot' | 'setBonus'>,
      excludedImplantTypes: string[]
  ): boolean {
      const isImplant = gear.slot.startsWith('implant_');
      return isImplant && excludedImplantTypes.includes(gear.setBonus ?? '');
  }

  const makeImplant = (setBonus: string | null): Pick<GearPiece, 'slot' | 'setBonus'> => ({
      slot: 'implant_major',
      setBonus,
  });

  const makeGear = (setBonus: string | null): Pick<GearPiece, 'slot' | 'setBonus'> => ({
      slot: 'weapon',
      setBonus,
  });

  describe('isExcludedByImplantType', () => {
      it('excludes an implant whose type is in the list', () => {
          expect(isExcludedByImplantType(makeImplant('BULWARK'), ['BULWARK'])).toBe(true);
      });

      it('does not exclude an implant whose type is not in the list', () => {
          expect(isExcludedByImplantType(makeImplant('STASIS'), ['BULWARK'])).toBe(false);
      });

      it('does not exclude a non-implant even if its setBonus matches', () => {
          expect(isExcludedByImplantType(makeGear('BULWARK'), ['BULWARK'])).toBe(false);
      });

      it('does not exclude an implant when the list is empty', () => {
          expect(isExcludedByImplantType(makeImplant('BULWARK'), [])).toBe(false);
      });

      it('does not exclude an implant with null setBonus', () => {
          expect(isExcludedByImplantType(makeImplant(null), ['BULWARK'])).toBe(false);
      });
  });
  ```

- [ ] **Step 2: Run the test**

  Run: `npm test -- excludedImplantFilter`
  Expected: 5 tests pass (the predicate is defined in the test file itself, so it passes immediately)

- [ ] **Step 3: Add the filter check to `AutogearPage.tsx`**

  Open `src/pages/manager/AutogearPage.tsx`. Find the block (around line 487–489):

  ```typescript
                      // If optimizeImplants is false, exclude all implants
                      if (isImplant && !shipConfig.optimizeImplants) {
                          return false;
                      }
  ```

  Insert immediately after its closing `}`, before the `usedGearIds.has(gear.id)` check:

  ```typescript
                      // Exclude implant types the user has blacklisted for this ship
                      if (isImplant && shipConfig.excludedImplantTypes?.includes(gear.setBonus ?? '')) {
                          return false;
                      }
  ```

- [ ] **Step 4: Run lint and all tests**

  Run: `npm run lint && npm test`
  Expected: all pass

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/manager/AutogearPage.tsx src/utils/autogear/__tests__/excludedImplantFilter.test.ts
  git commit -m "feat: filter excluded implant types from autogear inventory"
  ```

---

## Task 3: AutogearPage persistence and reset

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Add `excludedImplantTypes` to the persistence config literal**

  Find the `config` literal built before `void saveConfig(config)` (around line 445). After `useArenaModifiers: shipConfig.useArenaModifiers,`, add:

  ```typescript
  excludedImplantTypes: shipConfig.excludedImplantTypes ?? [],
  ```

  Without this, the field will be silently dropped when the config is saved to Supabase.

- [ ] **Step 2: Add `excludedImplantTypes` to the `onResetConfig` handler**

  Find the `onResetConfig` callback (around line 1368). After `useArenaModifiers: false,`, add:

  ```typescript
  excludedImplantTypes: [],
  ```

  Without this, clicking "Reset to role defaults" leaves the excluded types set from the previous config.

- [ ] **Step 3: Run lint**

  Run: `npm run lint`
  Expected: passes

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/manager/AutogearPage.tsx
  git commit -m "feat: persist and reset excludedImplantTypes in autogear config"
  ```

---

## Task 4: AutogearSettings UI

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

This task adds the full UI: extends `TweakView`, adds `ExcludedImplantForm`, adds the picker option, adds the list section, and updates the tweak count.

- [ ] **Step 1: Import `IMPLANTS` at the top of `AutogearSettings.tsx`**

  Open `src/components/autogear/AutogearSettings.tsx`. After the `GEAR_SETS` import (line ~18), add:

  ```typescript
  import { IMPLANTS } from '../../constants/implants';
  ```

- [ ] **Step 2: Extend `TweakView` and widen `openForm`**

  Find the `TweakView` type (line ~25):

  ```typescript
  type TweakView =
      | { mode: 'list' }
      | { mode: 'picker' }
      | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus'; editIndex: number | null };
  ```

  Replace with:

  ```typescript
  type TweakView =
      | { mode: 'list' }
      | { mode: 'picker' }
      | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant'; editIndex: number | null };
  ```

  Find the `openForm` arrow function (line ~206):

  ```typescript
  const openForm = (
      type: 'priority' | 'setPriority' | 'statBonus',
      editIndex: number | null = null
  ) => setTweakView({ mode: 'form', type, editIndex });
  ```

  Replace with:

  ```typescript
  const openForm = (
      type: 'priority' | 'setPriority' | 'statBonus' | 'excludedImplant',
      editIndex: number | null = null
  ) => setTweakView({ mode: 'form', type, editIndex });
  ```

- [ ] **Step 3: Add four new props to `AutogearSettingsProps`**

  Find the `AutogearSettingsProps` interface (line ~43). After `onIncludeCalibratedGearChange: (value: boolean) => void;`, add:

  ```typescript
  availableImplantTypes: { key: string; name: string }[];
  excludedImplantTypes: string[];
  onAddExcludedImplantType: (key: string) => void;
  onRemoveExcludedImplantType: (key: string) => void;
  ```

- [ ] **Step 4: Destructure the new props in the component function**

  Find the `AutogearSettings` function destructure (line ~165). After `onIncludeCalibratedGearChange,`, add:

  ```typescript
  availableImplantTypes,
  excludedImplantTypes,
  onAddExcludedImplantType,
  onRemoveExcludedImplantType,
  ```

- [ ] **Step 5: Add `ExcludedImplantForm` component**

  Between the closing `};` of `SetPriorityForm` (line ~163) and the start of `export const AutogearSettings` (line ~165), insert:

  ```typescript
  const ExcludedImplantForm: React.FC<{
      availableImplantTypes: { key: string; name: string }[];
      excludedImplantTypes: string[];
      onAdd: (key: string) => void;
      onCancel: () => void;
  }> = ({ availableImplantTypes, excludedImplantTypes, onAdd, onCancel }) => {
      const [selected, setSelected] = useState('');
      const options = availableImplantTypes
          .filter((t) => !excludedImplantTypes.includes(t.key))
          .map((t) => ({ value: t.key, label: t.name }));

      const handleSubmit = (e: React.FormEvent) => {
          e.preventDefault();
          if (!selected) return;
          onAdd(selected);
          setSelected('');
      };

      return (
          <form onSubmit={handleSubmit} className="space-y-3">
              <Select
                  label="Implant type"
                  options={options}
                  value={selected}
                  onChange={setSelected}
                  noDefaultSelection
                  helpLabel="Select an implant type to exclude from autogear for this ship."
              />
              <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={onCancel}>
                      Cancel
                  </Button>
                  <Button type="submit" disabled={!selected} variant="secondary">
                      Add
                  </Button>
              </div>
          </form>
      );
  };
  ```

- [ ] **Step 6: Update the tweak count badge and empty-state check**

  Find the tweak count expression in the "Your tweaks" heading (around line 277):

  ```typescript
  {priorities.length +
      setPriorities.length +
      statBonuses.length}
  ```

  Replace with:

  ```typescript
  {priorities.length +
      setPriorities.length +
      statBonuses.length +
      excludedImplantTypes.length}
  ```

  Find the empty-state condition (around line 293):

  ```typescript
  {priorities.length + setPriorities.length + statBonuses.length === 0 ? (
  ```

  Replace with:

  ```typescript
  {priorities.length + setPriorities.length + statBonuses.length + excludedImplantTypes.length === 0 ? (
  ```

- [ ] **Step 7: Add "Excluded implants" section to the list view**

  In the list view, find the "Order matters" paragraph (around line 380):

  ```typescript
                              <p className="text-xs text-theme-text-secondary italic">
                                  Order matters — higher tweaks weigh more.
                              </p>
  ```

  Insert the new section **after** this paragraph — the "Order matters" note applies to the ordered groups (stat priorities, set requirements, scales) and must stay above the unordered "Excluded implants" section:

  ```typescript
                              {excludedImplantTypes.length > 0 && (
                                  <div className="space-y-1">
                                      <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
                                          Excluded implants
                                      </h4>
                                      {excludedImplantTypes.map((key) => {
                                          const name = IMPLANTS[key]?.name ?? key;
                                          return (
                                              <div
                                                  key={key}
                                                  className="flex items-center justify-between gap-2 p-2 bg-dark border border-dark-border rounded text-sm"
                                              >
                                                  <span>{name}</span>
                                                  <Button
                                                      variant="danger"
                                                      size="xs"
                                                      onClick={() => onRemoveExcludedImplantType(key)}
                                                  >
                                                      Remove
                                                  </Button>
                                              </div>
                                          );
                                      })}
                                  </div>
                              )}
  ```

- [ ] **Step 8: Add "Excluded implant type" option to the picker**

  Find the picker view. After the closing `</button>` of the "Scale" picker option (around line 441), add:

  ```typescript
                              {optimizeImplants && availableImplantTypes.length > 0 && (
                                  <button
                                      type="button"
                                      className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
                                      onClick={() => openForm('excludedImplant')}
                                  >
                                      <div className="font-semibold">Excluded implant type</div>
                                      <div className="text-xs text-theme-text-secondary">
                                          Prevent a specific implant type from being used in
                                          autogear (e.g. Bulwark).
                                      </div>
                                  </button>
                              )}
  ```

- [ ] **Step 9: Add `ExcludedImplantForm` to the form view and update the breadcrumb**

  Find the form view breadcrumb label (around line 460):

  ```typescript
  {tweakView.type === 'priority'
      ? 'limits'
      : tweakView.type === 'setPriority'
        ? 'set requirement'
        : 'scale'}
  ```

  Replace with:

  ```typescript
  {tweakView.type === 'priority'
      ? 'limits'
      : tweakView.type === 'setPriority'
        ? 'set requirement'
        : tweakView.type === 'statBonus'
          ? 'scale'
          : 'excluded implant type'}
  ```

  After the `statBonus` form block (ending around line 530), add:

  ```typescript
                          {tweakView.type === 'excludedImplant' && (
                              <ExcludedImplantForm
                                  availableImplantTypes={availableImplantTypes}
                                  excludedImplantTypes={excludedImplantTypes}
                                  onAdd={(key) => {
                                      onAddExcludedImplantType(key);
                                      backToList();
                                  }}
                                  onCancel={backToList}
                              />
                          )}
  ```

- [ ] **Step 10: Run lint**

  Run: `npm run lint`
  Expected: passes

- [ ] **Step 11: Commit**

  ```bash
  git add src/components/autogear/AutogearSettings.tsx
  git commit -m "feat: add excluded implant type tweak to autogear settings UI"
  ```

---

## Task 5: AutogearSettingsModal props + AutogearPage wiring

**Files:**
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx`

- [ ] **Step 1: Add four new props to `AutogearSettingsModalProps`**

  Open `src/components/autogear/AutogearSettingsModal.tsx`. Find the `AutogearSettingsModalProps` interface (line ~10). After `onUseArenaModifiersChange?: (value: boolean) => void;`, add:

  ```typescript
  availableImplantTypes: { key: string; name: string }[];
  excludedImplantTypes: string[];
  onAddExcludedImplantType: (key: string) => void;
  onRemoveExcludedImplantType: (key: string) => void;
  ```

  The modal already spreads `...settingsProps` directly into `<AutogearSettings>`, so no further changes are needed in this file.

- [ ] **Step 2: Add `IMPLANTS` import to `AutogearPage.tsx`**

  Open `src/pages/manager/AutogearPage.tsx`. After the line importing from `../../constants` (around line 20), add:

  ```typescript
  import { IMPLANTS } from '../../constants/implants';
  ```

- [ ] **Step 3: Add the `availableImplantTypes` memo**

  Add the following memo near the other derived inventory values (e.g. near the `gearToShipMap` useMemo):

  ```typescript
  const availableImplantTypes = useMemo(() => {
      const seen = new Set<string>();
      const result: { key: string; name: string }[] = [];
      for (const gear of inventory) {
          if (!gear.slot.startsWith('implant_') || !gear.setBonus) continue;
          const key = gear.setBonus as string;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ key, name: IMPLANTS[key]?.name ?? key });
      }
      return result;
  }, [inventory]);
  ```

- [ ] **Step 4: Pass new props to `<AutogearSettingsModal>`**

  Find the `<AutogearSettingsModal>` usage (around line 1164). Add the four new props near the `optimizeImplants`-related props for readability:

  ```typescript
  availableImplantTypes={availableImplantTypes}
  excludedImplantTypes={
      shipSettings ? getShipConfig(shipSettings.id).excludedImplantTypes ?? [] : []
  }
  onAddExcludedImplantType={(key) => {
      if (shipSettings) {
          const config = getShipConfig(shipSettings.id);
          updateShipConfig(shipSettings.id, {
              excludedImplantTypes: [...(config.excludedImplantTypes ?? []), key],
          });
      }
  }}
  onRemoveExcludedImplantType={(key) => {
      if (shipSettings) {
          const config = getShipConfig(shipSettings.id);
          updateShipConfig(shipSettings.id, {
              excludedImplantTypes: (config.excludedImplantTypes ?? []).filter(
                  (k) => k !== key
              ),
          });
      }
  }}
  ```

- [ ] **Step 5: Run lint and all tests**

  Run: `npm run lint && npm test`
  Expected: all pass

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/autogear/AutogearSettingsModal.tsx src/pages/manager/AutogearPage.tsx
  git commit -m "feat: wire excluded implant types into autogear page and settings modal"
  ```

---

## Task 6: Manual smoke test

- [ ] **Step 1: Start the dev server**

  Run: `npm start`

- [ ] **Step 2: Test the happy path**

  1. Open the autogear page, select a ship.
  2. Enable "Optimize implants".
  3. Click "+ Add tweak" — confirm "Excluded implant type" appears in the picker.
  4. Select an implant type present in your inventory and click Add.
  5. Confirm the type appears under "Excluded implants" in the tweaks list.
  6. Run autogear — confirm that implant type is not suggested for any slot.
  7. Click Remove — confirm the entry disappears.

- [ ] **Step 3: Test edge cases**

  1. **Picker hidden when `optimizeImplants` is off:** Disable "Optimize implants", open picker — "Excluded implant type" must not appear.
  2. **Reset clears exclusions:** Add an excluded type, then click the reset (⟳) button — confirm excluded implant types are cleared to empty.
  3. **Tweak count badge:** Confirm the count in the "Your tweaks (N)" header increments when an excluded type is added.
  4. **Persistence:** Add an excluded type, run autogear (which saves the config), reload the page, reopen settings for the same ship — confirm the excluded type is still listed.

- [ ] **Step 4: Stop the dev server and commit any fixes found during testing**
