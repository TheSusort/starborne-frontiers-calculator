# Fleet Buffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-ship fleet buff tweaks to autogear — stat boosts like Volk's +30% crit that inflate stat values before scoring, so gear is optimised for the ship's true in-combat stats.

**Architecture:** New `FleetBuff` type stored in `SavedAutogearConfig`. A new `applyFleetBuffs()` utility applies buffs to final stats (additive for percentage-only stats, multiplicative for flat stats) immediately after arena modifiers in both the slow and fast scoring paths. The UI is a fourth tweak type in the existing Tweaks picker.

**Tech Stack:** React 18, TypeScript, Vite, Vitest

**Spec:** `docs/superpowers/specs/2026-05-02-fleet-buffs-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/utils/autogear/fleetBuffs.ts` | `applyFleetBuffs` pure function |
| Create | `src/utils/autogear/__tests__/fleetBuffs.test.ts` | Unit tests for `applyFleetBuffs` |
| Create | `src/components/autogear/FleetBuffForm.tsx` | Add/edit fleet buff form |
| Create | `src/components/autogear/FleetBuffRow.tsx` | Row display in tweak list |
| Modify | `src/types/autogear.ts` | `FleetBuff` type, `fleetBuffs` field on `SavedAutogearConfig` |
| Modify | `src/utils/autogear/scoring.ts` | Add `fleetBuffs` param, apply after arena modifiers, update cache key |
| Modify | `src/utils/autogear/AutogearStrategy.ts` | Add `fleetBuffs` to interface |
| Modify | `src/utils/autogear/strategies/GeneticStrategy.ts` | Thread `fleetBuffs` through all 6 scoring methods |
| Modify | `src/utils/autogear/fastScoring/context.ts` | Add `fleetBuffs` to `FastScoringContext` and `BuildContextInput` |
| Modify | `src/utils/autogear/fastScoring/fastScore.ts` | Apply `applyFleetBuffs` after arena modifiers |
| Modify | `src/components/autogear/AutogearSettings.tsx` | Fourth tweak type, TweakView union, count badge, picker/list/form |
| Modify | `src/components/autogear/AutogearSettingsModal.tsx` | Add fleet buff props |
| Modify | `src/components/autogear/AutogearConfigList.tsx` | Display fleet buffs in config summary |
| Modify | `src/pages/manager/AutogearPage.tsx` | State, handlers, config object, strategy call, JSX wiring |
| Modify | `src/pages/DocumentationPage.tsx` | In-app docs |

---

## Task 1: Types

**Files:**
- Modify: `src/types/autogear.ts`

- [ ] **Add `FleetBuff` type and `fleetBuffs` field to `SavedAutogearConfig`**

In `src/types/autogear.ts`, add after the `StatBonus` interface:

```typescript
export interface FleetBuff {
    stat: StatName;
    percentage: number; // e.g. 30 for +30%
}
```

Then add to `SavedAutogearConfig`:

```typescript
fleetBuffs?: FleetBuff[];
```

- [ ] **Run the TypeScript compiler to confirm no errors**

```bash
npm run lint
```

Expected: no new errors.

- [ ] **Commit**

```bash
git add src/types/autogear.ts
git commit -m "feat: add FleetBuff type and fleetBuffs field to SavedAutogearConfig"
```

---

## Task 2: applyFleetBuffs utility (TDD)

**Files:**
- Create: `src/utils/autogear/__tests__/fleetBuffs.test.ts`
- Create: `src/utils/autogear/fleetBuffs.ts`

- [ ] **Write the failing tests**

Create `src/utils/autogear/__tests__/fleetBuffs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyFleetBuffs } from '../fleetBuffs';
import type { BaseStats } from '../../../types/stats';

const BASE: BaseStats = {
    hp: 10000,
    attack: 5000,
    defence: 3000,
    speed: 100,
    hacking: 50,
    security: 50,
    crit: 0.70,
    critDamage: 1.50,
    healModifier: 0.10,
    shield: 0,
    hpRegen: 0,
    defensePenetration: 0.10,
    shieldPenetration: 0,
    damageReduction: 0,
};

describe('applyFleetBuffs', () => {
    it('returns stats unchanged when buffs array is empty', () => {
        const result = applyFleetBuffs(BASE, []);
        expect(result).toEqual(BASE);
    });

    it('does not mutate the original stats object', () => {
        const snapshot = { ...BASE };
        applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(BASE).toEqual(snapshot);
    });

    it('adds buff directly to percentage-only stats (additive)', () => {
        // crit 70% + 30% = 100%
        const result = applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(result.crit).toBeCloseTo(1.00);
    });

    it('leaves unrelated stats unchanged when buffing a percentage stat', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'crit', percentage: 30 }]);
        expect(result.attack).toBe(5000);
        expect(result.hp).toBe(10000);
    });

    it('multiplies flat stats by (1 + pct/100)', () => {
        // attack 5000 + 45% = 7250
        const result = applyFleetBuffs(BASE, [{ stat: 'attack', percentage: 45 }]);
        expect(result.attack).toBeCloseTo(7250);
    });

    it('leaves unrelated stats unchanged when buffing a flat stat', () => {
        const result = applyFleetBuffs(BASE, [{ stat: 'attack', percentage: 45 }]);
        expect(result.crit).toBe(0.70);
        expect(result.hp).toBe(10000);
    });

    it('applies multiple buffs in sequence', () => {
        const result = applyFleetBuffs(BASE, [
            { stat: 'crit', percentage: 30 },
            { stat: 'attack', percentage: 10 },
            { stat: 'critDamage', percentage: 20 },
        ]);
        expect(result.crit).toBeCloseTo(1.00);
        expect(result.attack).toBeCloseTo(5500);
        expect(result.critDamage).toBeCloseTo(1.70);
    });

    it('skips silently when stat key is absent from BaseStats', () => {
        // 'nonexistent' is not a real StatName, but the guard should handle it safely
        expect(() =>
            applyFleetBuffs(BASE, [{ stat: 'nonexistent' as never, percentage: 50 }])
        ).not.toThrow();
        const result = applyFleetBuffs(BASE, [{ stat: 'nonexistent' as never, percentage: 50 }]);
        expect(result).toEqual(BASE);
    });

    it('handles optional stats that are zero', () => {
        // defensePenetration is a percentage-only optional stat present at 0.10
        const result = applyFleetBuffs(BASE, [{ stat: 'defensePenetration', percentage: 10 }]);
        expect(result.defensePenetration).toBeCloseTo(0.20);
    });
});
```

- [ ] **Run test to verify it fails**

```bash
npm test -- --run src/utils/autogear/__tests__/fleetBuffs.test.ts
```

Expected: all tests FAIL with "Cannot find module '../fleetBuffs'"

- [ ] **Implement `applyFleetBuffs`**

Create `src/utils/autogear/fleetBuffs.ts`:

```typescript
import { PERCENTAGE_ONLY_STATS, type BaseStats, type StatName } from '../../types/stats';
import type { FleetBuff } from '../../types/autogear';

export function applyFleetBuffs(stats: BaseStats, buffs: FleetBuff[]): BaseStats {
    if (buffs.length === 0) return stats;
    const modified = { ...stats } as unknown as Record<string, number>;
    for (const buff of buffs) {
        if (typeof modified[buff.stat] !== 'number') continue;
        if ((PERCENTAGE_ONLY_STATS as readonly StatName[]).includes(buff.stat)) {
            modified[buff.stat] += buff.percentage / 100;
        } else {
            modified[buff.stat] *= 1 + buff.percentage / 100;
        }
    }
    return modified as unknown as BaseStats;
}
```

- [ ] **Run tests to verify they pass**

```bash
npm test -- --run src/utils/autogear/__tests__/fleetBuffs.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Commit**

```bash
git add src/utils/autogear/fleetBuffs.ts src/utils/autogear/__tests__/fleetBuffs.test.ts
git commit -m "feat: add applyFleetBuffs utility with tests"
```

---

## Task 3: Integrate fleet buffs into scoring.ts

**Files:**
- Modify: `src/utils/autogear/scoring.ts`

- [ ] **Add the `fleetBuffs` import and parameter to `calculateTotalScore`**

At the top of `scoring.ts`, add to the existing imports from `'../autogear/fleetBuffs'`:

```typescript
import { applyFleetBuffs } from './fleetBuffs';
import type { FleetBuff } from '../../types/autogear';
```

(Note: check the relative path — `scoring.ts` is in `src/utils/autogear/`, so both imports are in the same directory.)

Add `fleetBuffs?: FleetBuff[]` as the last parameter of `calculateTotalScore`, after `arenaModifiers`:

```typescript
export function calculateTotalScore(
    ship: Ship,
    equipment: Partial<Record<GearSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null,
    fleetBuffs?: FleetBuff[]
): number {
```

- [ ] **Update the cache key to include fleet buffs**

Find the line (around line 201):
```typescript
const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}`;
```

Replace with:
```typescript
const fleetBuffsKey = fleetBuffs?.length
    ? fleetBuffs.map((b) => `${b.stat}:${b.percentage}`).join(',')
    : '';
const cacheKey = `${ship.id}|${equipmentKey}|${implantsKey}|${shipRole || 'none'}|${bonusesKey}|${arenaKey}|${fleetBuffsKey}`;
```

- [ ] **Apply fleet buffs after arena modifiers**

Find this block (around line 244):
```typescript
const statsForScoring =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
```

Replace with:
```typescript
const statsAfterArena =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
const statsForScoring =
    fleetBuffs && fleetBuffs.length > 0
        ? applyFleetBuffs(statsAfterArena, fleetBuffs)
        : statsAfterArena;
```

- [ ] **Run all tests to verify nothing breaks**

```bash
npm test -- --run
```

Expected: all existing tests PASS (fleet buffs default to undefined/empty so no existing behaviour changes).

- [ ] **Commit**

```bash
git add src/utils/autogear/scoring.ts
git commit -m "feat: add fleetBuffs param to calculateTotalScore"
```

---

## Task 4: Thread fleetBuffs through GeneticStrategy

**Files:**
- Modify: `src/utils/autogear/AutogearStrategy.ts`
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`

- [ ] **Add `fleetBuffs` to the `AutogearStrategy` interface**

In `src/utils/autogear/AutogearStrategy.ts`, add `FleetBuff` to imports:

```typescript
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../types/autogear';
```

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the `findOptimalGear` signature:

```typescript
findOptimalGear(
    ship: Ship,
    priorities: StatPriority[],
    inventory: GearPiece[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null,
    fleetBuffs?: FleetBuff[]
): Promise<AutogearResult> | AutogearResult;
```

- [ ] **Add imports to GeneticStrategy.ts**

In `src/utils/autogear/strategies/GeneticStrategy.ts`, add to existing imports:

```typescript
import { applyFleetBuffs } from '../fleetBuffs';
import type { FleetBuff } from '../../../types/autogear';
```

- [ ] **Update `findOptimalGear`**

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the method signature (line ~103).

Pass `fleetBuffs` to `buildFastScoringContext` (add after `arenaModifiers` in the object at line ~128):
```typescript
fleetBuffs,
```

Pass `fleetBuffs` to `runSingleGAPass` call (after `arenaModifiers` at line ~171):
```typescript
fleetBuffs,
```

Pass `fleetBuffs` to `computeViolations` call (after `arenaModifiers` at line ~207):
```typescript
arenaModifiers,
fleetBuffs
```

- [ ] **Update `runSingleGAPass`**

Add `fleetBuffs: FleetBuff[] | undefined` after `arenaModifiers` in the parameter list (line ~224).

Pass `fleetBuffs` to both `evaluatePopulation` calls (after `arenaModifiers` at lines ~251 and ~293):
```typescript
arenaModifiers,
fleetBuffs,
```

- [ ] **Update `evaluatePopulation`**

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the parameter list (line ~413).

Pass `fleetBuffs` to `calculateFitness` call (after `arenaModifiers` at line ~430):
```typescript
arenaModifiers,
fleetBuffs,
```

- [ ] **Update `computeViolations`**

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the parameter list (line ~322).

Find the stats inflation block (lines ~342–345):
```typescript
const stats =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
```

Replace with:
```typescript
const statsAfterArena =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
const stats =
    fleetBuffs && fleetBuffs.length > 0
        ? applyFleetBuffs(statsAfterArena, fleetBuffs)
        : statsAfterArena;
```

- [ ] **Update `calculateFitness`**

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the parameter list (line ~451).

Pass `fleetBuffs` to `verifyAgainstSlowPath` call (after `arenaModifiers` at line ~477):
```typescript
arenaModifiers,
fleetBuffs,
```

Pass `fleetBuffs` to `calculateTotalScore` slow-path call (after `arenaModifiers` at line ~518):
```typescript
arenaModifiers,
fleetBuffs
```

Find the slow-path violation block (lines ~535–538):
```typescript
const statsForViolation =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
```

Replace with:
```typescript
const statsAfterArena =
    arenaModifiers && Object.keys(arenaModifiers).length > 0
        ? applyArenaModifiers(totalStats.final, arenaModifiers)
        : totalStats.final;
const statsForViolation =
    fleetBuffs && fleetBuffs.length > 0
        ? applyFleetBuffs(statsAfterArena, fleetBuffs)
        : statsAfterArena;
```

- [ ] **Update `verifyAgainstSlowPath`**

Add `fleetBuffs?: FleetBuff[]` after `arenaModifiers` in the parameter list (line ~696).

Pass `fleetBuffs` to the single `calculateTotalScore` call (after `arenaModifiers` at line ~722):
```typescript
arenaModifiers,
fleetBuffs
```

- [ ] **Run all tests**

```bash
npm run lint && npm test -- --run
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Commit**

```bash
git add src/utils/autogear/AutogearStrategy.ts src/utils/autogear/strategies/GeneticStrategy.ts
git commit -m "feat: thread fleetBuffs through GeneticStrategy and AutogearStrategy interface"
```

---

## Task 5: Fast scoring — context and fastScore

**Files:**
- Modify: `src/utils/autogear/fastScoring/context.ts`
- Modify: `src/utils/autogear/fastScoring/fastScore.ts`

- [ ] **Add `fleetBuffs` to `FastScoringContext` and `BuildContextInput`**

In `src/utils/autogear/fastScoring/context.ts`, add `FleetBuff` to the import:

```typescript
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../../types/autogear';
```

Add to `FastScoringContext` after `arenaModifiers`:
```typescript
readonly fleetBuffs: readonly FleetBuff[] | undefined;
```

Add to `BuildContextInput` after `arenaModifiers`:
```typescript
fleetBuffs?: readonly FleetBuff[];
```

Wire in `buildFastScoringContext` return object after `arenaModifiers`:
```typescript
fleetBuffs: input.fleetBuffs,
```

- [ ] **Apply fleet buffs in `fastScore.ts`**

In `src/utils/autogear/fastScoring/fastScore.ts`, add these imports (consistent with the file's sibling-level imports like `'../arenaModifiers'`):

```typescript
import { applyFleetBuffs } from '../fleetBuffs';
import type { FleetBuff } from '../../../types/autogear';
```

Find the block (around lines 75–79):
```typescript
const statsForScoring =
    context.arenaModifiers && Object.keys(context.arenaModifiers).length > 0
        ? applyArenaModifiers(finalStats, context.arenaModifiers)
        : finalStats;
```

Replace with:
```typescript
const statsAfterArena =
    context.arenaModifiers && Object.keys(context.arenaModifiers).length > 0
        ? applyArenaModifiers(finalStats, context.arenaModifiers)
        : finalStats;
const statsForScoring =
    context.fleetBuffs && context.fleetBuffs.length > 0
        ? applyFleetBuffs(statsAfterArena, context.fleetBuffs as FleetBuff[])
        : statsAfterArena;
```

- [ ] **Run all tests**

```bash
npm run lint && npm test -- --run
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/utils/autogear/fastScoring/context.ts src/utils/autogear/fastScoring/fastScore.ts
git commit -m "feat: add fleetBuffs to fast scoring context and apply in fastScore"
```

---

## Task 6: FleetBuffForm component

**Files:**
- Create: `src/components/autogear/FleetBuffForm.tsx`

- [ ] **Create `FleetBuffForm.tsx`**

This is modelled after `StatBonusForm.tsx` but without the mode toggle. Create `src/components/autogear/FleetBuffForm.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { Button, Select, Input } from '../ui';
import type { FleetBuff } from '../../types/autogear';
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { PERCENTAGE_ONLY_STATS, type StatName } from '../../types/stats';

interface FleetBuffFormProps {
    onAdd: (buff: FleetBuff) => void;
    editingValue?: FleetBuff;
    onSave?: (buff: FleetBuff) => void;
    onCancel?: () => void;
}

export const FleetBuffForm: React.FC<FleetBuffFormProps> = ({
    onAdd,
    editingValue,
    onSave,
    onCancel,
}) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);

    useEffect(() => {
        if (editingValue) {
            setSelectedStat(editingValue.stat);
            setPercentage(editingValue.percentage);
        } else {
            setSelectedStat('');
            setPercentage(0);
        }
    }, [editingValue]);

    const isPercentageOnly =
        selectedStat !== '' &&
        (PERCENTAGE_ONLY_STATS as readonly StatName[]).includes(selectedStat);

    const hint = selectedStat
        ? isPercentageOnly
            ? 'Added directly to stat value (e.g. +30% crit on a 70% crit ship = 100% crit)'
            : 'Applied as a multiplier to the final stat (e.g. +45% attack on 10 000 = 14 500)'
        : '';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedStat) return;
        const value: FleetBuff = { stat: selectedStat, percentage };
        if (editingValue && onSave) {
            onSave(value);
            return;
        }
        onAdd(value);
        setSelectedStat('');
        setPercentage(0);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-theme-text-secondary">
                Add a fleet or commander buff that boosts this ship&apos;s stats during combat.
                The scorer will account for it when choosing gear.
            </p>
            <div className="flex gap-3 items-end flex-wrap">
                <Select
                    label="Stat"
                    className="flex-1 min-w-[8rem]"
                    options={ALL_STAT_NAMES.map((key) => ({
                        value: key,
                        label: STATS[key].label,
                    }))}
                    value={selectedStat}
                    onChange={(value) => setSelectedStat(value as StatName)}
                    noDefaultSelection
                />
                <div className="w-24">
                    <Input
                        label="Percentage"
                        type="number"
                        min="0"
                        step="1"
                        value={percentage}
                        onChange={(e) => setPercentage(parseFloat(e.target.value))}
                    />
                </div>
            </div>
            {hint && (
                <p className="text-xs text-theme-text-secondary">{hint}</p>
            )}
            <div className="flex justify-end gap-2 mt-auto">
                {editingValue ? (
                    <>
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!selectedStat} variant="primary">
                            Save
                        </Button>
                    </>
                ) : (
                    <Button
                        type="submit"
                        disabled={!selectedStat}
                        variant="secondary"
                    >
                        Add
                    </Button>
                )}
            </div>
        </form>
    );
};
```

- [ ] **Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/components/autogear/FleetBuffForm.tsx
git commit -m "feat: add FleetBuffForm component"
```

---

## Task 7: FleetBuffRow component

**Files:**
- Create: `src/components/autogear/FleetBuffRow.tsx`

- [ ] **Create `FleetBuffRow.tsx`**

Modelled after `StatBonusRow.tsx`. Create `src/components/autogear/FleetBuffRow.tsx`:

```typescript
import React from 'react';
import {
    Button,
    ChevronUpIcon,
    ChevronDownIcon,
    CloseIcon,
    EditIcon,
    InlineNumberEdit,
} from '../ui';
import type { FleetBuff } from '../../types/autogear';
import { STATS } from '../../constants';

interface FleetBuffRowProps {
    buff: FleetBuff;
    isEditing: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onUpdate: (buff: FleetBuff) => void;
    onEdit: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
}

export const FleetBuffRow: React.FC<FleetBuffRowProps> = ({
    buff,
    isEditing,
    canMoveUp,
    canMoveDown,
    onUpdate,
    onEdit,
    onMoveUp,
    onMoveDown,
    onRemove,
}) => {
    return (
        <div className={`flex items-center text-sm gap-2 ${isEditing ? 'opacity-60' : ''}`}>
            <div className="flex flex-col">
                {canMoveUp && (
                    <Button
                        aria-label="Move buff up"
                        variant="secondary"
                        size="xs"
                        onClick={onMoveUp}
                        disabled={isEditing}
                        className="!p-0.5"
                    >
                        <ChevronUpIcon className="w-3 h-3" />
                    </Button>
                )}
                {canMoveDown && (
                    <Button
                        aria-label="Move buff down"
                        variant="secondary"
                        size="xs"
                        onClick={onMoveDown}
                        disabled={isEditing}
                        className="!p-0.5"
                    >
                        <ChevronDownIcon className="w-3 h-3" />
                    </Button>
                )}
            </div>
            <span>
                {STATS[buff.stat].label} +
                <InlineNumberEdit
                    value={buff.percentage}
                    onSave={(v) => v !== undefined && onUpdate({ ...buff, percentage: v })}
                    min={0}
                    disabled={isEditing}
                >
                    {buff.percentage}
                </InlineNumberEdit>
                %
                {isEditing && (
                    <span className="ml-2 text-xs text-theme-text-secondary">(editing)</span>
                )}
            </span>
            <Button
                aria-label="Edit buff"
                variant="secondary"
                size="sm"
                onClick={onEdit}
                className="ml-auto"
                title="Edit buff"
            >
                <EditIcon />
            </Button>
            <Button aria-label="Remove buff" variant="danger" size="sm" onClick={onRemove}>
                <CloseIcon />
            </Button>
        </div>
    );
};
```

- [ ] **Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/components/autogear/FleetBuffRow.tsx
git commit -m "feat: add FleetBuffRow component"
```

---

## Task 8: AutogearSettings UI

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx`

This task has several targeted edits. Make them one at a time and run lint between each group.

- [ ] **Add imports**

Add to the top-level imports in `AutogearSettings.tsx`:

```typescript
import type { FleetBuff } from '../../types/autogear';
import { FleetBuffForm } from './FleetBuffForm';
import { FleetBuffRow } from './FleetBuffRow';
```

- [ ] **Extend `TweakView` type and `openForm` helper (line ~25–28 and ~207)**

Replace:
```typescript
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus'; editIndex: number | null };
```
With:
```typescript
type TweakView =
    | { mode: 'list' }
    | { mode: 'picker' }
    | { mode: 'form'; type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff'; editIndex: number | null };
```

Replace the `openForm` helper signature:
```typescript
    type: 'priority' | 'setPriority' | 'statBonus',
```
With:
```typescript
    type: 'priority' | 'setPriority' | 'statBonus' | 'fleetBuff',
```

- [ ] **Add fleet buff props to `AutogearSettingsProps` (line ~43–84)**

After the `onMoveStatBonus` line, add:
```typescript
fleetBuffs: FleetBuff[];
onAddFleetBuff: (buff: FleetBuff) => void;
onUpdateFleetBuff: (index: number, buff: FleetBuff) => void;
onRemoveFleetBuff: (index: number) => void;
onMoveFleetBuff: (fromIndex: number, toIndex: number) => void;
```

- [ ] **Destructure new props in the component function**

Find where `statBonuses` is destructured in the component body and add the new props alongside it:
```typescript
fleetBuffs,
onAddFleetBuff,
onUpdateFleetBuff,
onRemoveFleetBuff,
onMoveFleetBuff,
```

- [ ] **Add `isEditingFleetBuff` helper alongside the other `isEditing*` helpers (line ~213–221)**

```typescript
const isEditingFleetBuff = (index: number) =>
    tweakView.mode === 'form' &&
    tweakView.type === 'fleetBuff' &&
    tweakView.editIndex === index;
```

- [ ] **Update tweak count badge and empty-state check (lines ~277–293)**

Change the count expression from:
```typescript
{priorities.length + setPriorities.length + statBonuses.length}
```
To:
```typescript
{priorities.length + setPriorities.length + statBonuses.length + fleetBuffs.length}
```

Change the empty-state check from:
```typescript
{priorities.length + setPriorities.length + statBonuses.length === 0 ? (
```
To:
```typescript
{priorities.length + setPriorities.length + statBonuses.length + fleetBuffs.length === 0 ? (
```

- [ ] **Add fleet buff section to the tweak list (after the statBonuses section, line ~353–379)**

After the closing `)}` of the stat bonuses section, add:

```tsx
{fleetBuffs.length > 0 && (
    <div className="space-y-1">
        <h4 className="text-xs uppercase tracking-wide text-theme-text-secondary">
            Fleet buffs
        </h4>
        {fleetBuffs.map((buff, index) => (
            <FleetBuffRow
                key={`fleetbuff-${index}`}
                buff={buff}
                isEditing={isEditingFleetBuff(index)}
                canMoveUp={index > 0}
                canMoveDown={index < fleetBuffs.length - 1}
                onUpdate={(updated) => onUpdateFleetBuff(index, updated)}
                onEdit={() => openForm('fleetBuff', index)}
                onMoveUp={() => onMoveFleetBuff(index, index - 1)}
                onMoveDown={() => onMoveFleetBuff(index, index + 1)}
                onRemove={() => onRemoveFleetBuff(index)}
            />
        ))}
    </div>
)}
```

- [ ] **Add fleet buff option to the picker (after the statBonus picker button, line ~426–441)**

After the closing `</button>` of the Scale picker button, add:

```tsx
<button
    type="button"
    className="w-full text-left p-3 bg-dark border border-dark-border hover:border-primary hover:bg-dark-lighter rounded transition-colors"
    onClick={() => openForm('fleetBuff')}
>
    <div className="font-semibold">Fleet buff</div>
    <div className="text-xs text-theme-text-secondary">
        Apply a commander or fleet ability stat boost (e.g. Volk&apos;s +30% crit rate).
    </div>
</button>
```

- [ ] **Add fleet buff breadcrumb label in form view (line ~460–464)**

Find the breadcrumb ternary:
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
        : 'fleet buff'}
```

- [ ] **Add fleet buff form rendering (after the statBonus form block, line ~513–535)**

After the closing `)}` of the `tweakView.type === 'statBonus'` block, add:

```tsx
{tweakView.type === 'fleetBuff' && (
    <FleetBuffForm
        onAdd={(b) => {
            onAddFleetBuff(b);
            backToList();
        }}
        editingValue={
            tweakView.editIndex !== null
                ? fleetBuffs[tweakView.editIndex]
                : undefined
        }
        onSave={(b) => {
            if (tweakView.mode === 'form' && tweakView.editIndex !== null) {
                onUpdateFleetBuff(tweakView.editIndex, b);
                backToList();
            }
        }}
        onCancel={backToList}
    />
)}
```

- [ ] **Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx
git commit -m "feat: add fleet buff tweak type to AutogearSettings UI"
```

---

## Task 9: AutogearSettingsModal and AutogearConfigList

**Files:**
- Modify: `src/components/autogear/AutogearSettingsModal.tsx`
- Modify: `src/components/autogear/AutogearConfigList.tsx`

- [ ] **Add fleet buff props to `AutogearSettingsModal`**

In `src/components/autogear/AutogearSettingsModal.tsx`:

Add `FleetBuff` to imports:
```typescript
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../types/autogear';
```

Add to `AutogearSettingsModalProps` after the `onMoveStatBonus` line:
```typescript
fleetBuffs: FleetBuff[];
onAddFleetBuff: (buff: FleetBuff) => void;
onUpdateFleetBuff: (index: number, buff: FleetBuff) => void;
onRemoveFleetBuff: (index: number) => void;
onMoveFleetBuff: (fromIndex: number, toIndex: number) => void;
```

The component body already uses `{...settingsProps}` spread into `<AutogearSettings />`, so no further changes are needed in the component body.

- [ ] **Update `AutogearQuickSettings` to include `fleetBuffs` in its `getShipConfig` return type**

`AutogearQuickSettings.tsx` declares its own inline return-type for `getShipConfig` prop (lines 20–32). Add `FleetBuff` to imports and add `fleetBuffs: FleetBuff[]` to that inline type:

```typescript
import { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../types/autogear';
```

```typescript
getShipConfig: (shipId: string) => {
    // ...existing fields...
    optimizeImplants: boolean;
    fleetBuffs: FleetBuff[];   // add this
};
```

This ensures that when `AutogearConfigList` gains a `fleetBuffs` prop, the spread call at `<AutogearConfigList {...getShipConfig(ship.id)} />` satisfies the type.

- [ ] **Add fleet buffs display to `AutogearConfigList`**

In `src/components/autogear/AutogearConfigList.tsx`:

Add `FleetBuff` to imports:
```typescript
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../types/autogear';
```

Add `fleetBuffs?: FleetBuff[]` to `AutogearConfigListProps` (optional with `?` to be safe against any other callers not yet updated).

Add `fleetBuffs` to the destructured props with a default:

```typescript
const { ..., fleetBuffs = [] } = props; // destructure with default
```

Update the `hasConfig` check:

```typescript
const hasConfig =
    statPriorities.length > 0 ||
    setPriorities.length > 0 ||
    statBonuses.length > 0 ||
    fleetBuffs.length > 0 ||
    optimizeImplants ||
    ignoreEquipped ||
    ignoreUnleveled ||
    useUpgradedStats ||
    tryToCompleteSets;
```

Add a fleet buffs display section after the stat bonuses section:

```tsx
{fleetBuffs.length > 0 && (
    <>
        {fleetBuffs.map((buff, index) => (
            <span key={index}>
                {STATS[buff.stat]?.label} +{buff.percentage}%
            </span>
        ))}
    </>
)}
```

- [ ] **Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Commit**

```bash
git add src/components/autogear/AutogearSettingsModal.tsx src/components/autogear/AutogearConfigList.tsx
git commit -m "feat: propagate fleet buff props to AutogearSettingsModal and AutogearConfigList"
```

---

## Task 10: AutogearPage wiring

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx`

This is the largest single-file change. Make it in logical sub-steps.

- [ ] **Add `FleetBuff` to imports**

Add to the existing autogear type imports:
```typescript
import type { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../types/autogear';
```

- [ ] **Add `fleetBuffs` to the `shipConfigs` state type (line ~111–131)**

Add `fleetBuffs: FleetBuff[];` to the inline type of the record value, after `excludedImplantTypes: string[]`.

- [ ] **Add `fleetBuffs: []` to `getShipConfig` default (line ~212)**

Inside the default object returned by `getShipConfig`, add after `excludedImplantTypes: []`:
```typescript
fleetBuffs: [],
```

- [ ] **Add `fleetBuffs: []` to `onResetConfig` handler (line ~1375)**

Inside the `updateShipConfig` call in `onResetConfig`, add after `useArenaModifiers: false`:
```typescript
fleetBuffs: [],
```

- [ ] **Add `fleetBuffs: shipConfig.fleetBuffs` to the `handleAutogear` config object (line ~447)**

Inside the `config` object literal, add after `useArenaModifiers: shipConfig.useArenaModifiers`:
```typescript
fleetBuffs: shipConfig.fleetBuffs,
```

- [ ] **Add `fleetBuffs ?? []` fallback when loading a saved config**

Find where configs are loaded from storage (look for `getConfig` or `savedConfig` in the `useEffect` that loads saved configs, around line 275). For any place where a `SavedAutogearConfig` is read and spread into `shipConfigs`, ensure `fleetBuffs` has a fallback:

```typescript
fleetBuffs: savedConfig.fleetBuffs ?? [],
```

If the config is spread wholesale (e.g. `...savedConfig`), add an explicit override after the spread:
```typescript
fleetBuffs: savedConfig.fleetBuffs ?? [],
```

- [ ] **Pass `fleetBuffs` to the strategy call (line ~596)**

Find:
```typescript
arenaModifiers
```
as the last argument of `strategy.findOptimalGear(...)`. Add `shipConfig.fleetBuffs` after it:
```typescript
arenaModifiers,
shipConfig.fleetBuffs
```

- [ ] **Add the four fleet buff handlers**

After the `onMoveStatBonus` handler, add four new handlers following the exact same pattern:

```typescript
onAddFleetBuff={(buff) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            fleetBuffs: [...config.fleetBuffs, buff],
        });
    }
}}
onUpdateFleetBuff={(index, buff) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            fleetBuffs: config.fleetBuffs.map((b, i) =>
                i === index ? buff : b
            ),
        });
    }
}}
onRemoveFleetBuff={(index) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            fleetBuffs: config.fleetBuffs.filter((_, i) => i !== index),
        });
    }
}}
onMoveFleetBuff={(fromIndex, toIndex) => {
    if (shipSettings) {
        const config = getShipConfig(shipSettings.id);
        updateShipConfig(shipSettings.id, {
            fleetBuffs: arrayMove(config.fleetBuffs, fromIndex, toIndex),
        });
    }
}}
```

- [ ] **Pass `fleetBuffs` prop to `<AutogearSettingsModal />`**

At the `<AutogearSettingsModal />` JSX call site, add:
```tsx
fleetBuffs={shipSettings ? getShipConfig(shipSettings.id).fleetBuffs : []}
```

- [ ] **Pass `fleetBuffs` to `<AutogearConfigList />` if it is used on the page**

Search for `<AutogearConfigList` in `AutogearPage.tsx`. If found, add:
```tsx
fleetBuffs={getShipConfig(ship.id).fleetBuffs}
```

- [ ] **Run lint and tests**

```bash
npm run lint && npm test -- --run
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Commit**

```bash
git add src/pages/manager/AutogearPage.tsx
git commit -m "feat: wire fleet buffs into AutogearPage state, handlers, and strategy call"
```

---

## Task 11: Documentation

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Add fleet buffs to the autogear section**

Find the autogear section in `DocumentationPage.tsx`. Add a paragraph or list item describing fleet buffs. Example text:

> **Fleet buffs** — Add external commander or fleet ability buffs as tweaks (e.g. Volk's +30% crit rate). The scorer inflates the ship's stats before optimising, so gear choices reflect the ship's true in-combat performance. Percentage-only stats (crit, crit power, def pen, etc.) receive the buff as a flat addition; flat stats (attack, HP, defence, etc.) receive it as a percentage multiplier.

- [ ] **Run lint**

```bash
npm run lint
```

- [ ] **Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: document fleet buffs in autogear section"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
npm run lint && npm test -- --run
```

Expected: all tests pass, zero lint errors.

- [ ] **Start the dev server and manually test the golden path**

```bash
npm start
```

1. Open Autogear page, select a ship
2. Open Tweaks → Add tweak → confirm "Fleet buff" option appears
3. Add "Crit Rate +30%" — confirm it appears in the list
4. Add "Attack +45%" — confirm it appears
5. Edit the crit buff to +20% — confirm the value updates
6. Reorder the two buffs — confirm order changes
7. Remove one buff — confirm it disappears
8. Run autogear — confirm it completes without error
9. Reset config — confirm fleet buffs clear to empty
10. Save and reload — confirm fleet buffs persist across page reload
