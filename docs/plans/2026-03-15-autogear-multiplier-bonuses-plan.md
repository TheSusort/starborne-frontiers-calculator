# Autogear Stat Bonus Multiplier Mode — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-bonus "mode" toggle (additive vs multiplier) to the autogear stat bonus system so users can make stats scale proportionally with role scores.

**Architecture:** The `StatBonus` type gains an optional `mode` field. Scoring splits bonuses by mode: additive bonuses add to the role score, multiplier bonuses multiply it. The UI adds a toggle per bonus in the form and display.

**Tech Stack:** React 18, TypeScript, Vitest

**Spec:** `docs/plans/2026-03-15-autogear-multiplier-bonuses-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/autogear.ts` | Modify | Add optional `mode` field to `StatBonus` |
| `src/utils/autogear/__tests__/scoring.test.ts` | Create | Unit tests for bonus scoring |
| `src/utils/autogear/scoring.ts` | Modify | Split `applystatBonuses` into additive/multiplier paths |
| `src/components/autogear/StatBonusForm.tsx` | Modify | Add mode toggle to the form |
| `src/components/autogear/AutogearSettings.tsx` | Modify | Show mode label in bonus display rows |
| `src/components/autogear/AutogearConfigList.tsx` | Modify | Show mode prefix in compact bonus display |

---

## Task 1: Add `mode` field to StatBonus type

**Files:**
- Modify: `src/types/autogear.ts:23-26`

- [ ] **Step 1: Add optional mode field**

In `src/types/autogear.ts`, change the `StatBonus` interface:

```typescript
export interface StatBonus {
    stat: string;
    percentage: number;
    mode?: 'additive' | 'multiplier';
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (field is optional, so all existing usage still compiles)

- [ ] **Step 3: Commit**

```bash
git add src/types/autogear.ts
git commit -m "feat(autogear): add optional mode field to StatBonus type"
```

---

## Task 2: Write scoring tests and update scoring logic

**Files:**
- Create: `src/utils/autogear/__tests__/scoring.test.ts`
- Modify: `src/utils/autogear/scoring.ts:317-324`

- [ ] **Step 1: Write failing tests for additive and multiplier bonus scoring**

Create `src/utils/autogear/__tests__/scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StatBonus } from '../../../types/autogear';
import { BaseStats } from '../../../types/stats';

// We need to export the helper functions or test through the role-specific functions.
// Since applystatBonuses is private, we'll test through the exported scoring functions.
// For now, we'll test the helpers directly by importing from a testable path.
// The refactor will export two new functions: applyAdditiveBonuses and applyMultiplierFactor.

import { applyAdditiveBonuses, calculateMultiplierFactor } from '../scoring';

const baseStats: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 8000,
    speed: 300,
    hacking: 5000,
    security: 3000,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

describe('applyAdditiveBonuses', () => {
    it('returns 0 when no bonuses provided', () => {
        expect(applyAdditiveBonuses(baseStats)).toBe(0);
        expect(applyAdditiveBonuses(baseStats, [])).toBe(0);
    });

    it('calculates additive bonuses (mode undefined defaults to additive)', () => {
        const bonuses: StatBonus[] = [{ stat: 'defence', percentage: 80 }];
        // 8000 * (80/100) = 6400
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(6400);
    });

    it('calculates additive bonuses (mode explicitly additive)', () => {
        const bonuses: StatBonus[] = [{ stat: 'defence', percentage: 80, mode: 'additive' }];
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(6400);
    });

    it('ignores multiplier bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'defence', percentage: 80, mode: 'additive' },
            { stat: 'hacking', percentage: 50, mode: 'multiplier' },
        ];
        // Only defence additive: 8000 * 0.8 = 6400
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(6400);
    });

    it('sums multiple additive bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'defence', percentage: 80 },
            { stat: 'hp', percentage: 5 },
        ];
        // 8000 * 0.8 + 50000 * 0.05 = 6400 + 2500 = 8900
        expect(applyAdditiveBonuses(baseStats, bonuses)).toBe(8900);
    });
});

describe('calculateMultiplierFactor', () => {
    it('returns 1 when no bonuses provided', () => {
        expect(calculateMultiplierFactor(baseStats)).toBe(1);
        expect(calculateMultiplierFactor(baseStats, [])).toBe(1);
    });

    it('returns 1 when only additive bonuses exist', () => {
        const bonuses: StatBonus[] = [{ stat: 'defence', percentage: 80, mode: 'additive' }];
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(1);
    });

    it('returns 1 when no multiplier bonuses exist (undefined mode)', () => {
        const bonuses: StatBonus[] = [{ stat: 'defence', percentage: 80 }];
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(1);
    });

    it('calculates multiplier factor from multiplier bonuses', () => {
        const bonuses: StatBonus[] = [{ stat: 'hacking', percentage: 50, mode: 'multiplier' }];
        // 5000 * (50/100) = 2500
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(2500);
    });

    it('sums multiple multiplier bonuses', () => {
        const bonuses: StatBonus[] = [
            { stat: 'hacking', percentage: 50, mode: 'multiplier' },
            { stat: 'speed', percentage: 20, mode: 'multiplier' },
        ];
        // 5000 * 0.5 + 300 * 0.2 = 2500 + 60 = 2560
        expect(calculateMultiplierFactor(baseStats, bonuses)).toBe(2560);
    });

    it('returns 0 when multiplier bonus stat value is 0', () => {
        const stats = { ...baseStats, hacking: 0 };
        const bonuses: StatBonus[] = [{ stat: 'hacking', percentage: 50, mode: 'multiplier' }];
        // 0 * 0.5 = 0 — gear with no hacking should score 0
        expect(calculateMultiplierFactor(stats, bonuses)).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/autogear/__tests__/scoring.test.ts`
Expected: FAIL — `applyAdditiveBonuses` and `calculateMultiplierFactor` are not exported

- [ ] **Step 3: Implement the scoring changes**

In `src/utils/autogear/scoring.ts`, replace the existing `applystatBonuses` function (lines 316-324) with two new exported functions:

```typescript
// Helper function to apply additive stat bonuses (mode === 'additive' or undefined)
export function applyAdditiveBonuses(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 0;

    return statBonuses.reduce((total, bonus) => {
        if (bonus.mode === 'multiplier') return total;
        const statValue = stats[bonus.stat as keyof BaseStats] || 0;
        return total + statValue * (bonus.percentage / 100);
    }, 0);
}

// Helper function to calculate multiplier factor from multiplier bonuses
// Returns 1 when no multiplier bonuses exist (no-op multiplier)
// Returns 0 when multiplier bonuses exist but stat values sum to 0
export function calculateMultiplierFactor(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 1;

    const multiplierBonuses = statBonuses.filter((b) => b.mode === 'multiplier');
    if (multiplierBonuses.length === 0) return 1;

    return multiplierBonuses.reduce((total, bonus) => {
        const statValue = stats[bonus.stat as keyof BaseStats] || 0;
        return total + statValue * (bonus.percentage / 100);
    }, 0);
}
```

- [ ] **Step 4: Update all role-specific score functions to use both helpers**

Replace each function's bonus application pattern. The pattern changes from:

```typescript
const bonusScore = applystatBonuses(stats, statBonuses);
return baseScore + bonusScore;
```

To:

```typescript
const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
return (baseScore + additiveBonus) * multiplierFactor;
```

Apply this to all 12 role-specific functions:

**`calculateAttackerScore` (line 326):**
```typescript
function calculateAttackerScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const baseDPS = calculateDPS(stats, arcaneSiegeMultiplier);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (baseDPS + additiveBonus) * multiplierFactor;
}
```

**`calculateDefenderScore` (line 337):** Special handling for MAX_SAFE_INTEGER:
```typescript
function calculateDefenderScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const totalEffectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;
    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;

    if (healingWithShieldPerRound >= damagePerRound) {
        // Apply multiplier before capping to avoid Infinity
        return Math.min(
            (Number.MAX_SAFE_INTEGER + additiveBonus) * multiplierFactor,
            Number.MAX_SAFE_INTEGER
        );
    }

    const survivalRounds = totalEffectiveHP / (damagePerRound - healingWithShieldPerRound);
    return Math.max((survivalRounds * 1000 + additiveBonus) * multiplierFactor, 0);
}
```

**`calculateDefenderSecurityScore` (line 366):** No change needed — it delegates to `calculateDefenderScore` which already applies bonuses, then multiplies by security. Leave as-is.

**`calculateDebufferScore` (line 373):**
```typescript
function calculateDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    const dps = calculateDPS(stats, arcaneSiegeMultiplier);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * dps + additiveBonus) * multiplierFactor;
}
```

**`calculateDefensiveDebufferScore` (line 385):**
```typescript
function calculateDefensiveDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const effectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * effectiveHP + additiveBonus) * multiplierFactor;
}
```

**`calculateDefensiveSecurityDebufferScore` (line 396):**
```typescript
function calculateDefensiveSecurityDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[]
): number {
    const hacking = stats.hacking || 0;
    const security = stats.security || 0;
    const effectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * security + effectiveHP + additiveBonus) * multiplierFactor;
}
```

**`calculateBomberDebufferScore` (line 410):**
```typescript
function calculateBomberDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    const attack = stats.attack || 0;
    const attackWithMultiplier =
        arcaneSiegeMultiplier > 0 ? attack * (1 + arcaneSiegeMultiplier / 100) : attack;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * attackWithMultiplier + additiveBonus) * multiplierFactor;
}
```

**`calculateCorrosionDebufferScore` (line 425):**
```typescript
function calculateCorrosionDebufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hacking = stats.hacking || 0;
    const decimation = setCount?.DECIMATION || 0;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    const decimationMultiplier = decimation * 0.1;
    const totalDamage = hacking * (1 + decimationMultiplier);
    return (totalDamage + additiveBonus) * multiplierFactor;
}
```

**`calculateHealerScore` (line 443):**
```typescript
function calculateHealerScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT;
    const critMultiplier = calculateCritMultiplier(stats);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    const healModifier = stats.healModifier || 0;
    return (baseHealing * critMultiplier * (1 + healModifier / 100) + additiveBonus) * multiplierFactor;
}
```

**`calculateBufferScore` (line 456):**
```typescript
function calculateBufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    const speedScore = speed * 10;
    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 45000;
    }
    const ehpScore = Math.sqrt(effectiveHP) * 2;
    return (speedScore + boostScore + ehpScore + additiveBonus) * multiplierFactor;
}
```

**`calculateOffensiveSupporterScore` (line 482):**
```typescript
function calculateOffensiveSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const attack = Math.sqrt(stats.attack || 0) * 2;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 45000;
    }
    return (speed * 10 + attack + boostScore + additiveBonus) * multiplierFactor;
}
```

**`calculateShieldSupporterScore` (line 500):**
```typescript
function calculateShieldSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hp = stats.hp || 0;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hp + additiveBonus) * multiplierFactor;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/utils/autogear/__tests__/scoring.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/utils/autogear/__tests__/scoring.test.ts src/utils/autogear/scoring.ts
git commit -m "feat(autogear): split bonus scoring into additive and multiplier paths"
```

---

## Task 3: Add mode toggle to StatBonusForm

**Files:**
- Modify: `src/components/autogear/StatBonusForm.tsx`

- [ ] **Step 1: Add mode state and toggle to the form**

Replace the entire `StatBonusForm.tsx` with:

```tsx
import React, { useState } from 'react';
import { Button, Select, Input } from '../ui';
import { StatBonus } from '../../types/autogear';
import { STATS, ALL_STAT_NAMES } from '../../constants';
import { StatName } from '../../types/stats';

interface StatBonusFormProps {
    onAdd: (bonus: StatBonus) => void;
    existingBonuses: StatBonus[];
    onRemove: (index: number) => void;
}

export const StatBonusForm: React.FC<StatBonusFormProps> = ({ onAdd }) => {
    const [selectedStat, setSelectedStat] = useState<StatName | ''>('');
    const [percentage, setPercentage] = useState<number>(0);
    const [mode, setMode] = useState<'additive' | 'multiplier'>('additive');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedStat) {
            onAdd({ stat: selectedStat, percentage, mode });
            setSelectedStat('');
            setPercentage(0);
        }
    };

    const helpText =
        mode === 'additive'
            ? 'Adds stat × % directly to role score. Use for skills that scale off a stat (e.g., defense@80% for a skill dealing 80% of defense as damage).'
            : 'Multiplies role score by stat × %. Use when a stat should scale proportionally with the role (e.g., hacking@50% makes DPS scale with hacking).';

    return (
        <div className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-2">
                <div className="flex gap-4 items-end">
                    <Select
                        label="Stat"
                        className="flex-1"
                        options={ALL_STAT_NAMES.map((key) => ({
                            value: key,
                            label: STATS[key].label,
                        }))}
                        value={selectedStat}
                        onChange={(value) => setSelectedStat(value as StatName)}
                        noDefaultSelection
                        helpLabel={helpText}
                    />
                    <div className="w-32">
                        <Input
                            label="Percentage"
                            type="number"
                            min="0"
                            step="1"
                            value={percentage}
                            onChange={(e) => setPercentage(parseFloat(e.target.value))}
                            helpLabel={helpText}
                        />
                    </div>
                    <div className="flex items-end gap-1 pb-[1px]">
                        <button
                            type="button"
                            onClick={() => setMode('additive')}
                            className={`px-2 py-1.5 text-xs rounded-l border transition-colors ${
                                mode === 'additive'
                                    ? 'bg-blue-600 border-blue-500 text-white'
                                    : 'bg-dark-lighter border-dark-lighter text-gray-400 hover:text-white'
                            }`}
                        >
                            Additive
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('multiplier')}
                            className={`px-2 py-1.5 text-xs rounded-r border transition-colors ${
                                mode === 'multiplier'
                                    ? 'bg-blue-600 border-blue-500 text-white'
                                    : 'bg-dark-lighter border-dark-lighter text-gray-400 hover:text-white'
                            }`}
                        >
                            Multiplier
                        </button>
                    </div>
                    <Button type="submit" disabled={!selectedStat} variant="secondary">
                        Add
                    </Button>
                </div>
            </form>
        </div>
    );
};
```

- [ ] **Step 2: Verify the app compiles and renders**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/autogear/StatBonusForm.tsx
git commit -m "feat(autogear): add additive/multiplier mode toggle to StatBonusForm"
```

---

## Task 4: Update bonus display in AutogearSettings and AutogearConfigList

**Files:**
- Modify: `src/components/autogear/AutogearSettings.tsx:316-331`
- Modify: `src/components/autogear/AutogearConfigList.tsx:92-100`

- [ ] **Step 1: Update bonus display rows in AutogearSettings**

In `src/components/autogear/AutogearSettings.tsx`, update the stat bonuses display section (around line 316-331). Change the `<span>` content to show the mode:

Replace:
```tsx
<span>
    {STATS[bonus.stat as StatName].label} ({bonus.percentage}%)
</span>
```

With:
```tsx
<span>
    {STATS[bonus.stat as StatName].label} ({bonus.percentage}%){' '}
    <span className="text-xs text-gray-500">
        {bonus.mode === 'multiplier' ? '×' : '+'}
    </span>
</span>
```

- [ ] **Step 2: Update help text in AutogearSettings**

In `src/components/autogear/AutogearSettings.tsx`, update the description paragraph (around line 242-247).

Replace:
```tsx
<p className="text-sm text-gray-400">
    Add stat bonuses that contribute to the role score. These are additive
    adjustments (typically &lt;5% of total score) for hybrid builds or
    skill-specific scaling. Example: Defender with hacking @ 80% for debuff
    capability, or attacker with HP @ 5% for HP-scaling skills.
</p>
```

With:
```tsx
<p className="text-sm text-gray-400">
    Add stat bonuses that contribute to the role score.
    <strong> Additive</strong> adds stat × % directly (e.g., defense@80% for
    a skill dealing 80% of defense as damage).
    <strong> Multiplier</strong> multiplies the role score by stat × % (e.g.,
    hacking@50% makes DPS scale with hacking).
</p>
```

- [ ] **Step 3: Update compact display in AutogearConfigList**

In `src/components/autogear/AutogearConfigList.tsx`, update the stat bonuses display (around line 94-97).

Replace:
```tsx
<span key={index}>
    {STATS[bonus.stat as StatName]?.label} +{bonus.percentage}%
</span>
```

With:
```tsx
<span key={index}>
    {STATS[bonus.stat as StatName]?.label}{' '}
    {bonus.mode === 'multiplier' ? '×' : '+'}{bonus.percentage}%
</span>
```

- [ ] **Step 4: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/AutogearSettings.tsx src/components/autogear/AutogearConfigList.tsx
git commit -m "feat(autogear): show additive/multiplier mode in bonus display"
```

---

## Task 5: Verify end-to-end and run full test suite

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test**

Start the dev server with `npm start` and verify:
1. Navigate to Autogear page
2. Select a ship and a role (e.g., Attacker)
3. Expand Secondary Priorities
4. In Stat Bonuses, verify the Additive/Multiplier toggle appears
5. Add a bonus with each mode and verify they display correctly in the summary
6. Run autogear and confirm it completes without errors

- [ ] **Step 5: Final commit if any formatting was needed**

Run: `npm run format` and commit any changes.
