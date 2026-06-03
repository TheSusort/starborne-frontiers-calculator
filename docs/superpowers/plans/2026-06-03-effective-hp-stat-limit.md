# Effective HP Stat Limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Effective HP" as a selectable stat limit in autogear config that behaves exactly like existing limits (min/max + hard requirement).

**Architecture:** Effective HP is a *derived* value (from `hp` + `defence` + `damageReduction`), not a base stat. Keep `StatName` clean for gear/import/display; introduce a `LimitableStat = StatName | 'effectiveHp'` type used only by limits. A single resolver (`resolveLimitStatValue`) computes the value at every limit read-site via the existing `calculateEffectiveHP`. Labels resolve through `getLimitStatLabel` since `STATS` is keyed by `StatName`.

**Tech Stack:** React 18, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-effective-hp-stat-limit-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/types/stats.ts` | Stat type vocabulary | Add `DerivedStatName`, `LimitableStat` |
| `src/types/autogear.ts` | `StatPriority` | Widen `.stat` to `LimitableStat` |
| `src/utils/autogear/AutogearStrategy.ts` | `HardRequirementViolation` | Widen `.stat` to `LimitableStat` |
| `src/utils/autogear/priorityScore.ts` | Scoring + limit checks | Add `resolveLimitStatValue`; route read-sites |
| `src/utils/autogear/scoring.ts` | Re-export barrel | Re-export `resolveLimitStatValue` |
| `src/utils/autogear/strategies/GeneticStrategy.ts` | Hard-violation builder | Route read-site through resolver |
| `src/pages/manager/AutogearPage.tsx` | Unmet-priorities display | Route read-site through resolver |
| `src/constants/stats.ts` | Labels + normalizers | Add `effectiveHp` normalizer, `getLimitStatLabel`, `DERIVED_STAT_LABELS` |
| `src/components/stats/StatPriorityForm.tsx` | Limit picker form | Add `effectiveHp` to options; type as `LimitableStat` |
| `src/components/autogear/StatPriorityRow.tsx` | Limit row label | Use `getLimitStatLabel` |
| `src/components/autogear/GearSuggestions.tsx` | Violation banner label | Use `getLimitStatLabel` |
| `src/components/autogear/AutogearConfigList.tsx` | Config list label | Use `getLimitStatLabel` |
| `src/constants/changelog.ts` | Changelog | Add `UNRELEASED_CHANGES` entry |
| `src/pages/DocumentationPage.tsx` | In-app docs | Mention effective-HP limit |
| `src/utils/autogear/__tests__/priorityScore.test.ts` | Tests | Add `effectiveHp` resolution + limit tests |

---

## Task 1: Types + `resolveLimitStatValue` + route read-sites

This is the functional core. The type widening and the resolver MUST land together — widening `StatPriority.stat` to `LimitableStat` makes the bare `stats[priority.stat]` indexing fail to type-check, so the resolver replaces those sites in the same task.

**Files:**
- Modify: `src/types/stats.ts`
- Modify: `src/types/autogear.ts`
- Modify: `src/utils/autogear/AutogearStrategy.ts`
- Modify: `src/utils/autogear/priorityScore.ts`
- Modify: `src/utils/autogear/strategies/GeneticStrategy.ts`
- Modify: `src/pages/manager/AutogearPage.tsx`
- Modify: `src/constants/stats.ts` (normalizer only)
- Test: `src/utils/autogear/__tests__/priorityScore.test.ts`

- [ ] **Step 1: Add the derived-stat types** in `src/types/stats.ts`, immediately after the `StatName` definition (after line 21):

```ts
// Derived (computed) stats that can be used as autogear *limits* but are not
// real gear/base stats. Kept out of StatName so gear rolls, imports, and stat
// display are unaffected.
export type DerivedStatName = 'effectiveHp';

// Stat identifiers usable as autogear limit targets: every base StatName plus
// derived stats resolved on the fly (see resolveLimitStatValue).
export type LimitableStat = StatName | DerivedStatName;
```

- [ ] **Step 2: Widen `StatPriority.stat`** in `src/types/autogear.ts`. Change the import and the field:

```ts
// import line (was: import { StatName } from './stats';)
import { StatName, LimitableStat } from './stats';
```

```ts
export interface StatPriority {
    stat: LimitableStat;
    weight?: number;
    minLimit?: number;
    maxLimit?: number;
    hardRequirement?: boolean;
}
```

(Leave other uses of `StatName` in this file — e.g. `FleetBuff.stat` — unchanged.)

- [ ] **Step 3: Widen `HardRequirementViolation.stat`** in `src/utils/autogear/AutogearStrategy.ts`:

```ts
// ensure LimitableStat is imported from '../../types/stats'
export interface HardRequirementViolation {
    stat: LimitableStat;
    kind: 'min' | 'max';
    limit: number;
    actual: number;
}
```

Check the existing import line at the top of the file; add `LimitableStat` to the `../../types/stats` import (or create one if absent).

- [ ] **Step 4: Write the failing test** in `src/utils/autogear/__tests__/priorityScore.test.ts`. Add to the imports at the top:

```ts
import {
    calculatePriorityScore,
    resolveLimitStatValue,
    calculateHardViolation,
    calculateEffectiveHP,
} from '../priorityScore';
import { StatPriority } from '../../../types/autogear';
```

(Adjust the existing `calculatePriorityScore` import line rather than duplicating it.) Then append:

```ts
describe('resolveLimitStatValue', () => {
    it('passes base stats through unchanged', () => {
        expect(resolveLimitStatValue(stats, 'hp')).toBe(stats.hp);
        expect(resolveLimitStatValue(stats, 'defence')).toBe(stats.defence);
    });

    it('resolves effectiveHp via calculateEffectiveHP', () => {
        expect(resolveLimitStatValue(stats, 'effectiveHp')).toBeCloseTo(
            calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0),
            5
        );
    });

    it('does not produce NaN/Infinity when defence is 0', () => {
        const zeroDef: typeof stats = { ...stats, defence: 0 };
        const ehp = resolveLimitStatValue(zeroDef, 'effectiveHp');
        expect(Number.isFinite(ehp)).toBe(true);
        expect(ehp).toBeGreaterThan(0);
    });
});

describe('effectiveHp as a limit', () => {
    it('reports a hard violation when effectiveHp is below an unreachable min', () => {
        const priorities: StatPriority[] = [
            { stat: 'effectiveHp', minLimit: 100_000_000, hardRequirement: true, weight: 1 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBeGreaterThan(0);
    });

    it('reports no hard violation when effectiveHp min is met', () => {
        const priorities: StatPriority[] = [
            { stat: 'effectiveHp', minLimit: 1, hardRequirement: true, weight: 1 },
        ];
        expect(calculateHardViolation(stats, priorities)).toBe(0);
    });

    it('applies a soft penalty when an effectiveHp min limit is missed', () => {
        const unmet: StatPriority[] = [
            { stat: 'effectiveHp', minLimit: 100_000_000, weight: 1 },
        ];
        const met: StatPriority[] = [{ stat: 'effectiveHp', minLimit: 1, weight: 1 }];
        const scoreUnmet = calculatePriorityScore(stats, unmet, 'DEFENDER');
        const scoreMet = calculatePriorityScore(stats, met, 'DEFENDER');
        expect(scoreUnmet).toBeLessThan(scoreMet);
    });
});
```

- [ ] **Step 5: Run the test, verify it fails** (resolver not exported yet):

Run: `npm test -- src/utils/autogear/__tests__/priorityScore.test.ts`
Expected: FAIL — `resolveLimitStatValue is not a function` / import error.

- [ ] **Step 6: Implement `resolveLimitStatValue`** in `src/utils/autogear/priorityScore.ts`, immediately after `calculateEffectiveHP` (after line 25). Also add the `LimitableStat` import:

```ts
// top of file — extend the stats import
import { BaseStats, LimitableStat } from '../../types/stats';
```

```ts
/**
 * Resolve the value to compare against a stat limit. Base stats pass through;
 * derived stats (effectiveHp) are computed from the build's stats on the fly.
 */
export function resolveLimitStatValue(stats: BaseStats, stat: LimitableStat): number {
    if (stat === 'effectiveHp') {
        return calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0);
    }
    return stats[stat] || 0;
}
```

- [ ] **Step 7: Route the three `priorityScore.ts` read-sites** through the resolver.

`calculateDefaultScore` (~line 340):
```ts
        const statValue = resolveLimitStatValue(stats, priority.stat);
        const normalizer = STAT_NORMALIZERS[priority.stat] || 1;
```

`calculateHardViolation` (~line 358):
```ts
        const value = resolveLimitStatValue(stats, p.stat);
```

`calculatePriorityScore` soft-penalty loop (~line 384):
```ts
        const statValue = resolveLimitStatValue(stats, priority.stat);
```

- [ ] **Step 8: Add the `effectiveHp` normalizer** in `src/constants/stats.ts` inside `STAT_NORMALIZERS` (after line 136, before the closing brace):

```ts
    effectiveHp: 30000, // effectiveHP runs ~1.3-5x raw hp; normalize above hp's 10k
```

- [ ] **Step 9a: Re-export `resolveLimitStatValue` from the scoring barrel.** `src/utils/autogear/scoring.ts` is a re-export barrel for every `priorityScore` helper, and `GeneticStrategy` imports from it (not directly from `priorityScore`). Add `resolveLimitStatValue` to BOTH the import-from-`./priorityScore` block (~lines 12-21) and the `export { ... }` re-export block (~lines 24-33) in `scoring.ts`:

```ts
import {
    calculatePriorityScore,
    // ...existing...
    calculateHardViolation,
    resolveLimitStatValue,
} from './priorityScore';

// Re-export ... so existing imports from this module continue to work
export {
    calculatePriorityScore,
    // ...existing...
    calculateHardViolation,
    resolveLimitStatValue,
};
```

- [ ] **Step 9b: Route `GeneticStrategy.ts` read-site** (~line 364). Add `resolveLimitStatValue` to the existing import from `'../scoring'` (line 8: `import { calculateTotalScore, calculateHardViolation, clearScoreCache } from '../scoring';`), then replace the read:

```ts
import { calculateTotalScore, calculateHardViolation, clearScoreCache, resolveLimitStatValue } from '../scoring';
```
```ts
            const value = resolveLimitStatValue(stats, p.stat);
```

- [ ] **Step 10: Route `AutogearPage.tsx` read-site** (~line 900). Add `resolveLimitStatValue` to the existing import from `../../utils/autogear/priorityScore` (or add an import), then:

```ts
            const currentValue = resolveLimitStatValue(stats, priority.stat);
```

- [ ] **Step 11: Run the tests, verify they pass:**

Run: `npm test -- src/utils/autogear/__tests__/priorityScore.test.ts`
Expected: PASS (all new + existing cases).

- [ ] **Step 12: Type-check the whole project:**

Run: `npx tsc --noEmit`
Expected: no errors. (If a `stats[stat]` site outside the routed five still fails, route it through `resolveLimitStatValue` too.)

- [ ] **Step 13: Commit**

```bash
git add src/types/stats.ts src/types/autogear.ts src/utils/autogear/AutogearStrategy.ts src/utils/autogear/priorityScore.ts src/utils/autogear/scoring.ts src/utils/autogear/strategies/GeneticStrategy.ts src/pages/manager/AutogearPage.tsx src/constants/stats.ts src/utils/autogear/__tests__/priorityScore.test.ts
git commit -m "feat: resolve effective HP as an autogear limit stat"
```

---

## Task 2: Labels (`getLimitStatLabel`)

`STATS` is `Record<StatName, ...>` and will not contain `effectiveHp`, so `STATS[stat].label` is `undefined` for the derived stat (and two render sites access it unsafely). Add a resolver and use it everywhere a limit stat is labelled.

**Files:**
- Modify: `src/constants/stats.ts`
- Modify: `src/components/stats/StatPriorityForm.tsx`
- Modify: `src/components/autogear/StatPriorityRow.tsx`
- Modify: `src/components/autogear/GearSuggestions.tsx`
- Modify: `src/components/autogear/AutogearConfigList.tsx`
- Test: `src/constants/__tests__/stats.test.ts` (create if absent — check first)

- [ ] **Step 1: Write the failing test.** Check for an existing stats test file first:

Run: `ls src/constants/__tests__/ 2>/dev/null`

Create `src/constants/__tests__/stats.test.ts` (or append if it exists):

```ts
import { describe, it, expect } from 'vitest';
import { getLimitStatLabel } from '../stats';

describe('getLimitStatLabel', () => {
    it('returns the STATS label for a base stat', () => {
        expect(getLimitStatLabel('hp')).toBe('HP');
    });
    it('returns a human label for the derived effectiveHp stat', () => {
        expect(getLimitStatLabel('effectiveHp')).toBe('Effective HP');
    });
});
```

- [ ] **Step 2: Run it, verify it fails:**

Run: `npm test -- src/constants/__tests__/stats.test.ts`
Expected: FAIL — `getLimitStatLabel is not a function`.

- [ ] **Step 3: Implement labels** in `src/constants/stats.ts`. Update the type import and add the map + resolver near the bottom of the file (after `STAT_NORMALIZERS`):

```ts
// top: was `import type { StatName, StatType } from '../types/stats';`
import type { StatName, StatType, LimitableStat, DerivedStatName } from '../types/stats';
```

```ts
// Labels for derived limit stats (not present in STATS, which is keyed by StatName).
export const DERIVED_STAT_LABELS: Record<DerivedStatName, { label: string; shortLabel: string }> =
    {
        effectiveHp: { label: 'Effective HP', shortLabel: 'EHP' },
    };

/** Display label for any limitable stat, including derived ones. */
export function getLimitStatLabel(stat: LimitableStat): string {
    return (
        STATS[stat as StatName]?.label ??
        DERIVED_STAT_LABELS[stat as DerivedStatName]?.label ??
        stat
    );
}
```

- [ ] **Step 4: Run it, verify it passes:**

Run: `npm test -- src/constants/__tests__/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Use `getLimitStatLabel` at the render sites.**

`src/components/autogear/StatPriorityRow.tsx` (~line 73) — was `{STATS[priority.stat].label}`:
```tsx
{getLimitStatLabel(priority.stat)}
```

`src/components/autogear/GearSuggestions.tsx` (~line 86) — was `{STATS[v.stat].label}`:
```tsx
{getLimitStatLabel(v.stat)}
```

`src/components/autogear/AutogearConfigList.tsx` (~line 83) — was `{STATS[priority.stat]?.label || priority.stat}`:
```tsx
{getLimitStatLabel(priority.stat)}
```

In each file, add `getLimitStatLabel` to the existing `../../constants/stats` (or `../../constants`) import. Remove the now-unused `STATS` import only if nothing else in the file uses it.

- [ ] **Step 6: Type-check:**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/constants/stats.ts src/constants/__tests__/stats.test.ts src/components/autogear/StatPriorityRow.tsx src/components/autogear/GearSuggestions.tsx src/components/autogear/AutogearConfigList.tsx
git commit -m "feat: label derived effective-HP limit stat safely"
```

---

## Task 3: UI — add to the Limits dropdown

**Files:**
- Modify: `src/components/stats/StatPriorityForm.tsx`

- [ ] **Step 1: Widen the available-stats list and state.** In `src/components/stats/StatPriorityForm.tsx`:

Imports:
```tsx
import { StatName, LimitableStat } from '../../types/stats';
import { StatPriority } from '../../types/autogear';
import { STATS, getLimitStatLabel } from '../../constants/stats';
```

Available stats (line 7) — type as `LimitableStat[]` and append `effectiveHp`:
```tsx
const AVAILABLE_STATS: LimitableStat[] = [
    'attack',
    'defence',
    'hp',
    'effectiveHp',
    'speed',
    'crit',
    'critDamage',
    'hacking',
    'security',
    'healModifier',
    'shield',
];
```

State (line 37):
```tsx
    const [selectedStat, setSelectedStat] = useState<LimitableStat>(AVAILABLE_STATS[0]);
```

`onChange` cast (line 94):
```tsx
                    onChange={(value) => setSelectedStat(value as LimitableStat)}
```

Option labels (lines 95-98) — use the resolver:
```tsx
                    options={AVAILABLE_STATS.map((stat) => ({
                        value: stat,
                        label: getLimitStatLabel(stat),
                    }))}
```

`STATS` may now be unused in this file — if ESLint flags it, drop it from the import.

- [ ] **Step 2: Type-check and lint:**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, 0 warnings.

- [ ] **Step 3: Manual smoke check** (optional, if dev server available): open Autogear → add a Limit → confirm "Effective HP" appears in the dropdown, accepts a min, and a row renders with the "Effective HP" label.

- [ ] **Step 4: Commit**

```bash
git add src/components/stats/StatPriorityForm.tsx
git commit -m "feat: offer Effective HP in the autogear limit picker"
```

---

## Task 4: Docs + changelog

**Files:**
- Modify: `src/constants/changelog.ts`
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Add a changelog entry.** In `src/constants/changelog.ts`, append to the `UNRELEASED_CHANGES` array:

```ts
    'Autogear: you can now set a minimum (or maximum) Effective HP as a stat limit — handy when you care about overall survivability rather than tuning HP and Defense separately. Works as a soft limit or a hard requirement like any other stat.',
```

- [ ] **Step 2: Mention it in the docs.** In `src/pages/DocumentationPage.tsx`, in the "Stat Priorities" card (~line 1313), extend the description paragraph to note the derived stat. Append a sentence to the existing first `<p>`:

```tsx
                                        optimizing the overall build. You can also limit{' '}
                                        <strong>Effective HP</strong> — a derived survivability
                                        value combining HP, Defense, and damage reduction.
```

(Keep the surrounding JSX intact; only extend the sentence inside the existing paragraph.)

- [ ] **Step 3: Type-check and lint:**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs: note Effective HP autogear limit"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the full test suite:**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Lint + type-check:**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Final review** — confirm every `stats[priority.stat]` / `stats[p.stat]` limit read-site goes through `resolveLimitStatValue`, and every limit-stat label goes through `getLimitStatLabel`:

Run: `grep -rn "stats\[priority.stat\]\|stats\[p.stat\]\|STATS\[priority.stat\]\|STATS\[v.stat\]" src/`
Expected: no remaining limit read/label sites (matches in unrelated code that legitimately uses base `StatName` are fine).
