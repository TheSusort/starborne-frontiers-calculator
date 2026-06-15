# Targeting & Pattern Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users filter and search ships by skill targeting ("who it hits") and AoE pattern shape on both the Ship Database page and the Manager → Ships page.

**Architecture:** A single pure helper module (`targetingFilter.ts`) parses each ship's targeting via the existing `parseShipTargeting`, unions the facets across the active + charged slots, and exposes three functions used identically by both pages: facet extraction, filter matching, and a search-text builder. Both pages add two multi-select `FilterConfig` entries and fold the search text into their existing free-text predicate. The Manager page additionally needs `ShipsContext` to carry four targeting columns onto owned ships (the Database page already has them via `useShipsData`).

**Tech Stack:** React 18, TypeScript, Vite, Vitest, TailwindCSS, Supabase.

**Spec:** `docs/superpowers/specs/2026-06-15-targeting-pattern-filters-design.md`

---

## File Structure

- **Create** `src/utils/targeting/targetingFilter.ts` — pure helper: `getShipTargetingFacets`, `matchesTargetingFilters`, `buildTargetingSearchText`. One responsibility: turn a `Ship` into targeting facets/search-text and answer filter queries.
- **Create** `src/utils/targeting/__tests__/targetingFilter.test.ts` — unit tests for the helper.
- **Modify** `src/constants/targetingRules.ts` — add `PATTERN_SHAPES` label map (mirrors `TARGETING_RULES`).
- **Modify** `src/hooks/usePersistedFilters.ts` — add two optional filter fields.
- **Modify** `src/pages/database/ShipIndexPage.tsx` — two filters + search + wiring.
- **Modify** `src/components/ship/ShipInventory.tsx` — two filters + search + wiring (Manager page).
- **Modify** `src/contexts/ShipsContext.tsx` — pull four targeting columns onto owned ships (3 query sites).
- **Modify** `src/pages/DocumentationPage.tsx` — note the new filters.
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

---

## Task 1: Pattern shape label map

**Files:**
- Modify: `src/constants/targetingRules.ts`

- [ ] **Step 1: Add `PATTERN_SHAPES` map**

Append to `src/constants/targetingRules.ts` (after the existing `TARGETING_RULES` export). Import `PatternShape` from the parser:

```ts
import { TargetSelection, PatternShape } from '../utils/targetingParser';

// (existing TargetingRule interface + TARGETING_RULES stay as-is)

/**
 * Human-readable labels for parsed AoE pattern shapes. Mirrors TARGETING_RULES:
 * keep display copy here, never hardcoded in components. Add a new shape by
 * adding a row keyed on its PatternShape id.
 */
export interface PatternShapeInfo {
    id: PatternShape;
    label: string;
}

export const PATTERN_SHAPES: Record<PatternShape, PatternShapeInfo> = {
    base: { id: 'base', label: 'Single Target' },
    cone: { id: 'cone', label: 'Cone' },
    line: { id: 'line', label: 'Line' },
    cross: { id: 'cross', label: 'Cross' },
    curve: { id: 'curve', label: 'Curve' },
    circle: { id: 'circle', label: 'Circle' },
    backline: { id: 'backline', label: 'Backline' },
    root: { id: 'root', label: 'Root' },
    split: { id: 'split', label: 'Split' },
    burst: { id: 'burst', label: 'Burst' },
    scattershot: { id: 'scattershot', label: 'Scattershot' },
    wings: { id: 'wings', label: 'Wings' },
    range: { id: 'range', label: 'Range' },
    pickaxe: { id: 'pickaxe', label: 'Pickaxe' },
    all: { id: 'all', label: 'All' },
};
```

> Note: the first line changes the existing single `import { TargetSelection }` line to also import `PatternShape`. If `TargetSelection` is imported on its own line, just extend it.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (the `Record<PatternShape, ...>` will fail to compile if a shape is missing — confirms all 15 are covered).

- [ ] **Step 3: Commit**

```bash
git add src/constants/targetingRules.ts
git commit -m "feat(targeting): pattern shape label map"
```

---

## Task 2: Shared targeting filter helper (TDD)

**Files:**
- Create: `src/utils/targeting/targetingFilter.ts`
- Test: `src/utils/targeting/__tests__/targetingFilter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/targeting/__tests__/targetingFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    getShipTargetingFacets,
    matchesTargetingFilters,
    buildTargetingSearchText,
} from '../targetingFilter';
import { Ship } from '../../../types/ship';

// Minimal Ship factory — only targeting-relevant fields matter for the helper.
const makeShip = (overrides: Partial<Ship>): Ship =>
    ({
        id: '1',
        name: 'Test',
        rarity: 'legendary',
        faction: 'terran',
        type: 'attacker',
        baseStats: {},
        stats: {},
        equipment: {},
        ...overrides,
    }) as Ship;

describe('getShipTargetingFacets', () => {
    it('extracts active selection + shape', () => {
        const ship = makeShip({ activeTarget: 'front', activePattern: 'Pattern-Cone-Range-1' });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['front']);
        expect(facets.shapes).toEqual(['cone']);
    });

    it('unions active + charged, deduped', () => {
        const ship = makeShip({
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-1',
            chargedTarget: 'all',
            chargedPattern: 'Pattern-Circle-Range-1',
            chargeSkillCharge: 3,
        });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections.sort()).toEqual(['all', 'front']);
        expect(facets.shapes.sort()).toEqual(['circle', 'cone']);
    });

    it('does not double-count when charged inherits active', () => {
        const ship = makeShip({
            activeTarget: 'front',
            activePattern: 'Pattern-Cone-Range-1',
            chargeSkillCharge: 3, // charged inherits active per parseShipTargeting
        });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['front']);
        expect(facets.shapes).toEqual(['cone']);
    });

    it('returns empty facets for a ship with no targeting', () => {
        const facets = getShipTargetingFacets(makeShip({}));
        expect(facets.selections).toEqual([]);
        expect(facets.shapes).toEqual([]);
    });

    it('handles ally/support selection', () => {
        const ship = makeShip({ activeTarget: 'allies', activePattern: 'Pattern-Base-Support' });
        const facets = getShipTargetingFacets(ship);
        expect(facets.selections).toEqual(['team']);
    });
});

describe('matchesTargetingFilters', () => {
    const ship = makeShip({
        activeTarget: 'front',
        activePattern: 'Pattern-Cone-Range-1',
    });

    it('matches when no filters set', () => {
        expect(matchesTargetingFilters(ship, {})).toBe(true);
        expect(matchesTargetingFilters(ship, { selections: [], shapes: [] })).toBe(true);
    });

    it('OR within an axis', () => {
        expect(matchesTargetingFilters(ship, { selections: ['front', 'back'] })).toBe(true);
        expect(matchesTargetingFilters(ship, { selections: ['back'] })).toBe(false);
    });

    it('AND across axes', () => {
        expect(matchesTargetingFilters(ship, { selections: ['front'], shapes: ['cone'] })).toBe(
            true
        );
        expect(matchesTargetingFilters(ship, { selections: ['front'], shapes: ['circle'] })).toBe(
            false
        );
    });

    it('no-targeting ship fails any non-empty filter', () => {
        expect(matchesTargetingFilters(makeShip({}), { shapes: ['cone'] })).toBe(false);
    });
});

describe('buildTargetingSearchText', () => {
    it('includes selection label, shape label, and raw strings, lowercased', () => {
        const ship = makeShip({ activeTarget: 'front', activePattern: 'Pattern-Cone-Range-1' });
        const text = buildTargetingSearchText(ship);
        expect(text).toContain('front');
        expect(text).toContain('cone');
        expect(text).toContain('pattern-cone-range-1');
    });

    it('is empty for a ship with no targeting', () => {
        expect(buildTargetingSearchText(makeShip({}))).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/targeting/__tests__/targetingFilter.test.ts`
Expected: FAIL — cannot resolve `../targetingFilter`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/targeting/targetingFilter.ts`:

```ts
import { Ship } from '../../types/ship';
import { parseShipTargeting, TargetSelection, PatternShape } from '../targetingParser';
import { TARGETING_RULES, PATTERN_SHAPES } from '../../constants/targetingRules';

export interface ShipTargetingFacets {
    selections: TargetSelection[];
    shapes: PatternShape[];
}

/**
 * Deduped union of targeting selections + pattern shapes across a ship's
 * active and charged skills. Passive skills carry no targeting and are ignored.
 */
export function getShipTargetingFacets(ship: Ship): ShipTargetingFacets {
    const targeting = parseShipTargeting(ship);
    const selections = new Set<TargetSelection>();
    const shapes = new Set<PatternShape>();
    for (const slot of [targeting.active, targeting.charged]) {
        if (!slot) continue;
        selections.add(slot.target.selection);
        shapes.add(slot.pattern.shape);
    }
    return { selections: [...selections], shapes: [...shapes] };
}

/**
 * OR within an axis, AND across axes (matches the existing faction/type filter
 * semantics). An empty array for an axis means "no constraint on that axis".
 */
export function matchesTargetingFilters(
    ship: Ship,
    filters: { selections?: string[]; shapes?: string[] }
): boolean {
    const selections = filters.selections ?? [];
    const shapes = filters.shapes ?? [];
    if (selections.length === 0 && shapes.length === 0) return true;

    const facets = getShipTargetingFacets(ship);
    const matchesSelection =
        selections.length === 0 || facets.selections.some((s) => selections.includes(s));
    const matchesShape = shapes.length === 0 || facets.shapes.some((s) => shapes.includes(s));
    return matchesSelection && matchesShape;
}

/**
 * Lowercased haystack of selection labels + shape labels + raw game tokens,
 * appended to each page's free-text search so typing "cone" / "backline" /
 * "front" surfaces matching ships.
 */
export function buildTargetingSearchText(ship: Ship): string {
    const facets = getShipTargetingFacets(ship);
    const parts: string[] = [];
    for (const sel of facets.selections) parts.push(TARGETING_RULES[sel].label);
    for (const shape of facets.shapes) parts.push(PATTERN_SHAPES[shape].label);
    for (const raw of [
        ship.activeTarget,
        ship.activePattern,
        ship.chargedTarget,
        ship.chargedPattern,
    ]) {
        if (raw) parts.push(raw);
    }
    return parts.join(' ').toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/targeting/__tests__/targetingFilter.test.ts`
Expected: PASS (all cases).

> If the `makeShip` factory cast errors under strict TS, add only the missing required `Ship` fields — do not loosen the helper's types.

- [ ] **Step 5: Commit**

```bash
git add src/utils/targeting/targetingFilter.ts src/utils/targeting/__tests__/targetingFilter.test.ts
git commit -m "feat(targeting): shared targeting filter helper"
```

---

## Task 3: Filter state fields

**Files:**
- Modify: `src/hooks/usePersistedFilters.ts`

- [ ] **Step 1: Add the two optional fields**

In `FilterState['filters']` (after `affinities?: string[];`), add:

```ts
        targetSelections?: string[];
        patternShapes?: string[];
```

In `DEFAULT_STATE.filters` (after `affinities: [],`), add:

```ts
        targetSelections: [],
        patternShapes: [],
```

Both optional → existing persisted localStorage state stays valid; no migration needed.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePersistedFilters.ts
git commit -m "feat(targeting): add targeting filter state fields"
```

---

## Task 4: Ship Database page filters

**Files:**
- Modify: `src/pages/database/ShipIndexPage.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports:

```ts
import { TARGETING_RULES, PATTERN_SHAPES } from '../../constants/targetingRules';
import { PatternShape } from '../../utils/targetingParser';
import {
    getShipTargetingFacets,
    matchesTargetingFilters,
    buildTargetingSearchText,
} from '../../utils/targeting/targetingFilter';
```

- [ ] **Step 2: Add setters** (next to `setSelectedAffinities`, ~line 110)

```ts
    const setSelectedTargetSelections = (targetSelections: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, targetSelections },
        }));
    };

    const setSelectedPatternShapes = (patternShapes: string[]) => {
        setState((prev) => ({
            ...prev,
            filters: { ...prev.filters, patternShapes },
        }));
    };
```

- [ ] **Step 3: Derive shape options from data** (next to `uniqueAffinities`, ~line 133)

```ts
    const uniquePatternShapes = useMemo(() => {
        if (!templateShips) return [];
        const shapes = new Set<PatternShape>();
        templateShips.forEach((ship) => {
            getShipTargetingFacets(ship).shapes.forEach((s) => shapes.add(s));
        });
        return Array.from(shapes).sort((a, b) =>
            PATTERN_SHAPES[a].label.localeCompare(PATTERN_SHAPES[b].label)
        );
    }, [templateShips]);
```

- [ ] **Step 4: Add the two `FilterConfig` entries** (append to the `filters` array, after the `affinity` entry)

```ts
        {
            id: 'targetSelection',
            label: 'Who it hits',
            values: state.filters.targetSelections ?? [],
            onChange: setSelectedTargetSelections,
            options: Object.values(TARGETING_RULES).map((rule) => ({
                value: rule.id,
                label: rule.label,
            })),
        },
        {
            id: 'patternShape',
            label: 'Pattern',
            values: state.filters.patternShapes ?? [],
            onChange: setSelectedPatternShapes,
            options: uniquePatternShapes.map((shape) => ({
                value: shape,
                label: PATTERN_SHAPES[shape].label,
            })),
        },
```

- [ ] **Step 5: Extend `hasActiveFilters`** (the `||` chain, ~line 38)

Add before `searchQuery.length > 0`:

```ts
        (state.filters.targetSelections?.length ?? 0) > 0 ||
        (state.filters.patternShapes?.length ?? 0) > 0 ||
```

- [ ] **Step 6: Extend the predicate** in `filteredAndSortedShips` (~line 189)

Add a targeting match before the `return`:

```ts
            const matchesTargeting = matchesTargetingFilters(ship, {
                selections: state.filters.targetSelections,
                shapes: state.filters.patternShapes,
            });
```

Append to the `matchesSearch` OR-chain (after the `thirdPassiveSkillText` line, inside the same expression):

```ts
                ||
                buildTargetingSearchText(ship).includes(searchQuery.toLowerCase());
```

Update the final `return` to include `matchesTargeting`:

```ts
            return (
                matchesFaction &&
                matchesType &&
                matchesRarity &&
                matchesAffinity &&
                matchesTargeting &&
                matchesSearch
            );
```

- [ ] **Step 7: Update search placeholder** (~line 331)

```ts
                            searchPlaceholder="Search ships by name, skills, or targeting…"
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no warnings (lint is `--max-warnings 0`).

- [ ] **Step 9: Commit**

```bash
git add src/pages/database/ShipIndexPage.tsx
git commit -m "feat(targeting): targeting & pattern filters on ship database page"
```

---

## Task 5: Carry targeting columns onto owned ships

**Files:**
- Modify: `src/contexts/ShipsContext.tsx`

Three query sites + the local `ship_templates` type must learn the four targeting columns.

- [ ] **Step 1: Extend the local `ship_templates` type** (~line 100)

After `third_passive_skill_text: string | null;`, add:

```ts
        active_target: string | null;
        active_pattern: string | null;
        charged_target: string | null;
        charged_pattern: string | null;
```

- [ ] **Step 2: Map them in `transformShipData`** (~line 255)

After `thirdPassiveSkillText: data.ship_templates.third_passive_skill_text ?? undefined,`, add:

```ts
            activeTarget: data.ship_templates.active_target ?? undefined,
            activePattern: data.ship_templates.active_pattern ?? undefined,
            chargedTarget: data.ship_templates.charged_target ?? undefined,
            chargedPattern: data.ship_templates.charged_pattern ?? undefined,
```

- [ ] **Step 3: Add columns to the authenticated join select** (~line 369)

In the `ship_templates!inner ( ... )` block, after `third_passive_skill_text,` add:

```ts
                        active_target,
                        active_pattern,
                        charged_target,
                        charged_pattern
```

(Remove/keep trailing commas so the select string stays valid — `third_passive_skill_text` needs a trailing comma now.)

- [ ] **Step 4: Add columns to the unauthenticated select + map** (~line 315 and ~line 334)

Extend the `.select(...)` string to include the four columns:

```ts
            .select(
                'name, active_skill_text, charge_skill_text, charge_skill_charge, first_passive_skill_text, second_passive_skill_text, third_passive_skill_text, active_target, active_pattern, charged_target, charged_pattern'
            )
```

Update the enrichment guard so ships missing targeting are also backfilled (~line 305):

```ts
        const shipsNeedingText = storageShips.filter((s) => !s.activeSkillText || !s.activeTarget);
```

In the `.map(...)` callback, update the early-return and the merged object (~line 329):

```ts
                        if (ship.activeSkillText && ship.activeTarget) return ship;
                        const t = templateMap.get(ship.name);
                        if (!t) return ship;
                        return {
                            ...ship,
                            activeSkillText: t.active_skill_text ?? ship.activeSkillText,
                            chargeSkillText: t.charge_skill_text ?? ship.chargeSkillText,
                            chargeSkillCharge: t.charge_skill_charge ?? ship.chargeSkillCharge,
                            firstPassiveSkillText:
                                t.first_passive_skill_text ?? ship.firstPassiveSkillText,
                            secondPassiveSkillText:
                                t.second_passive_skill_text ?? ship.secondPassiveSkillText,
                            thirdPassiveSkillText:
                                t.third_passive_skill_text ?? ship.thirdPassiveSkillText,
                            activeTarget: t.active_target ?? undefined,
                            activePattern: t.active_pattern ?? undefined,
                            chargedTarget: t.charged_target ?? undefined,
                            chargedPattern: t.charged_pattern ?? undefined,
                        };
```

> **Tradeoff to be aware of (not a blocker):** ships whose template genuinely has no targeting keep `activeTarget === undefined`, so the `|| !s.activeTarget` guard re-includes them in the batched fetch on each mount. This is a single batched `.in('name', …)` request per mount (the effect only re-runs when `storageShips`/`activeProfileId` change), matching the existing skill-text enrichment behavior. Acceptable.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test -- src/contexts 2>/dev/null; npm run lint`
Expected: typecheck PASS, lint PASS. (No context tests may exist — that's fine.)

- [ ] **Step 6: Commit**

```bash
git add src/contexts/ShipsContext.tsx
git commit -m "feat(targeting): carry targeting columns onto owned ships"
```

---

## Task 6: Manager → Ships page filters

**Files:**
- Modify: `src/components/ship/ShipInventory.tsx`

Mirror Task 4 against the owned `ships` list.

- [ ] **Step 1: Add imports** (same three modules as Task 4 — adjust relative paths)

```ts
import { TARGETING_RULES, PATTERN_SHAPES } from '../../constants/targetingRules';
import { PatternShape } from '../../utils/targetingParser';
import {
    getShipTargetingFacets,
    matchesTargetingFilters,
    buildTargetingSearchText,
} from '../../utils/targeting/targetingFilter';
```

- [ ] **Step 2: Add setters** (next to `setSelectedAffinities`, ~line 148)

```ts
    const setSelectedTargetSelections = (targetSelections: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, targetSelections },
        }));
    };

    const setSelectedPatternShapes = (patternShapes: string[]) => {
        setState((prev: FilterState) => ({
            ...prev,
            filters: { ...prev.filters, patternShapes },
        }));
    };
```

- [ ] **Step 3: Derive shape options** (next to `uniqueAffinities`, ~line 305)

```ts
    const uniquePatternShapes = useMemo(() => {
        const shapes = new Set<PatternShape>();
        ships.forEach((ship) => {
            getShipTargetingFacets(ship).shapes.forEach((s) => shapes.add(s));
        });
        return Array.from(shapes).sort((a, b) =>
            PATTERN_SHAPES[a].label.localeCompare(PATTERN_SHAPES[b].label)
        );
    }, [ships]);
```

- [ ] **Step 4: Add the two `FilterConfig` entries** (append to the `filters` array, after the `shipStatus` entry ~line 367)

```ts
        {
            id: 'targetSelection',
            label: 'Who it hits',
            values: state.filters.targetSelections ?? [],
            onChange: setSelectedTargetSelections,
            options: Object.values(TARGETING_RULES).map((rule) => ({
                value: rule.id,
                label: rule.label,
            })),
        },
        {
            id: 'patternShape',
            label: 'Pattern',
            values: state.filters.patternShapes ?? [],
            onChange: setSelectedPatternShapes,
            options: uniquePatternShapes.map((shape) => ({
                value: shape,
                label: PATTERN_SHAPES[shape].label,
            })),
        },
```

- [ ] **Step 5: Extend `hasActiveFilters`** (~line 118)

Add before `searchQuery.length > 0`:

```ts
        (state.filters.targetSelections?.length ?? 0) > 0 ||
        (state.filters.patternShapes?.length ?? 0) > 0 ||
```

- [ ] **Step 6: Extend the predicate** in `filteredInventory` (~line 170)

Add before the `return`:

```ts
            const matchesTargeting = matchesTargetingFilters(ship, {
                selections: state.filters.targetSelections,
                shapes: state.filters.patternShapes,
            });
```

Append to the `matchesSearch` OR-chain (after the `ship.affinity?...` line):

```ts
                ||
                buildTargetingSearchText(ship).includes(searchQuery.toLowerCase());
```

Add `matchesTargeting &&` to the final `return (...)`.

- [ ] **Step 7: Update search placeholder** (~line 417)

```ts
                    searchPlaceholder="Search ships by name or targeting…"
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS, no warnings.

- [ ] **Step 9: Commit**

```bash
git add src/components/ship/ShipInventory.tsx
git commit -m "feat(targeting): targeting & pattern filters on manager ships page"
```

---

## Task 7: Docs + changelog

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Documentation**

Find the Ship Database / Ships section in `DocumentationPage.tsx` (search for "filter" or "Ship Database") and add a sentence noting that ships can now be filtered/searched by "who the skill hits" and AoE pattern shape. Use existing UI components/copy style — no raw markup.

- [ ] **Step 2: Changelog**

Add a plain-English entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, e.g.:

> Ship Database and Ships pages can now be filtered and searched by skill targeting (who it hits) and AoE pattern shape.

Match the existing entry shape in that array.

- [ ] **Step 3: Verify + final full run**

Run: `npx tsc --noEmit && npm run lint && npm test -- --run`
Expected: typecheck PASS, lint PASS (0 warnings), all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "docs(targeting): document targeting & pattern filters + changelog"
```

---

## Manual verification (after all tasks)

Use the `run` / `verify` skill or the dev server (`npm start`, port 3000):

1. **Ship Database** → open Filters. Confirm "Who it hits" lists the 7 rules and "Pattern" lists only shapes present in the data. Select "Backline" → only backline ships remain. Type "cone" in search → cone ships surface. Clear filters resets both.
2. **Manager → Ships** (needs owned ships) → same two filters appear and work; confirm owned ships actually carry targeting (filters return results, not empty). Test both signed-in and signed-out (localStorage) if possible.
3. Confirm persisted filters survive a page reload (localStorage keys `ship-database-filters` / `ship-inventory-filters`).

---

## Notes

- **DRY:** all matching logic lives in `targetingFilter.ts`; both pages call it identically.
- **YAGNI:** no range filter, no target-side filter, no sorting by targeting, no passive targeting — all explicitly out of scope per the spec.
- **No DB migration:** the four `ship_templates` columns already exist (added in `20260613000001_add_targeting_to_ship_templates.sql`); this plan only reads them.
