# Searchable / filterable targeting & pattern

**Date:** 2026-06-15
**Status:** Approved (design)

## Goal

Let users find ships by their skill targeting on two pages:

- **Ship Database** (`src/pages/database/ShipIndexPage.tsx`)
- **Manager → Ships** (`src/pages/manager/ShipsPage.tsx` → `src/components/ship/ShipInventory.tsx`)

Two new axes, chosen by the user:

1. **Who it hits** — the parsed `TargetSelection` (Front, Back, Skip, All, Self, Team, Others)
2. **AoE pattern shape** — the parsed `PatternShape` (Cone, Line, Circle, Wings, etc.)

Each axis is exposed as a **multi-select dropdown filter** (consistent with the existing
faction/type/rarity/affinity filters) **and** folded into the page's existing **free-text search**
box (typing "cone" or "backline" surfaces matching ships).

Range and target-side filters are explicitly **out of scope** (not requested). Passive skills carry
no targeting data and are ignored.

## Background — existing structure

Both pages already share one filtering stack:

- `FilterPanel` (`src/components/filters/FilterPanel.tsx`) renders multi-select dropdowns from a
  `FilterConfig[]` plus one search box (`searchValue` / `onSearchChange`).
- `usePersistedFilters` (`src/hooks/usePersistedFilters.ts`) owns `FilterState` (sort + `filters`
  object) and persists it to localStorage under a per-page key
  (`ship-database-filters`, `ship-inventory-filters`).

Targeting data:

- Parser `parseShipTargeting(ship)` (`src/utils/targetingParser.ts`) returns
  `{ active?: SkillTargeting; charged?: SkillTargeting }`, where each `SkillTargeting` has
  `target.selection` (`TargetSelection`), `target.side`, and `pattern.shape` (`PatternShape`).
- `TargetSelection` = `'front' | 'back' | 'skip' | 'all' | 'team' | 'others' | 'self'` (7 fixed).
- `PatternShape` = `'base' | 'cone' | 'line' | 'cross' | 'curve' | 'circle' | 'backline' | 'root'
  | 'split' | 'burst' | 'scattershot' | 'wings' | 'range' | 'pickaxe' | 'all'` (15).
- Selection labels live in `TARGETING_RULES` (`src/constants/targetingRules.ts`). There is **no**
  label map for shapes yet.

Data availability differs by page:

- **Database page** reads `ship_templates` via `useShipsData`, which already populates
  `activeTarget / activePattern / chargedTarget / chargedPattern` on the `Ship`.
- **Manager page** reads owned ships from `ShipsContext`. These are enriched from a `ship_templates`
  join, but the join currently selects only skill-text columns — **not** the 4 targeting columns. So
  owned ships do not carry targeting data today.

## Design

### 1. Shape label map (new)

Add `PATTERN_SHAPES: Record<PatternShape, { id: PatternShape; label: string }>` to
`src/constants/targetingRules.ts`, mirroring `TARGETING_RULES`. Keeps display copy out of
components. Labels are short human forms (e.g. `cone` → "Cone", `backline` → "Backline",
`scattershot` → "Scattershot", `pickaxe` → "Pickaxe").

### 2. Shared filter helper (new)

`src/utils/targeting/targetingFilter.ts` — single source of truth for both pages, fully unit-tested:

```ts
// Deduped union of selections/shapes across active + charged slots.
export function getShipTargetingFacets(ship: Ship): {
    selections: TargetSelection[];
    shapes: PatternShape[];
};

// Lowercased string of selection labels + shape labels + raw target/pattern,
// appended to each page's free-text matchesSearch check.
export function buildTargetingSearchText(ship: Ship): string;

// OR within an axis, AND across axes (matches existing filter semantics).
// Empty arrays = no constraint on that axis.
export function matchesTargetingFilters(
    ship: Ship,
    filters: { selections?: string[]; shapes?: string[] }
): boolean;
```

All three call `parseShipTargeting(ship)` and union across `active` + `charged`. A ship matches a
selection (or shape) filter if **either** slot has it.

### 3. Filter state

Extend `FilterState['filters']` in `usePersistedFilters.ts` with:

```ts
targetSelections?: string[];
patternShapes?: string[];
```

Both optional → existing persisted state stays valid (no migration needed).

### 4. Ship Database page (`ShipIndexPage.tsx`)

- Add two `FilterConfig` entries:
  - **Who it hits** — options from the 7 `TARGETING_RULES` (fixed order).
  - **Pattern shape** — options derived from shapes actually present in `templateShips`
    (same approach as `uniqueAffinities`), labeled via `PATTERN_SHAPES`, sorted by label.
- Add setter callbacks (`setSelectedTargetSelections`, `setSelectedPatternShapes`) following the
  existing setter pattern.
- In `filteredAndSortedShips`, add `matchesTargetingFilters(ship, { selections, shapes })` to the
  predicate, and append `buildTargetingSearchText(ship)` to the `matchesSearch` OR-chain.
- Include the two new filters in the `hasActiveFilters` computation and in `clearFilters` reset.
- Update `searchPlaceholder` copy (e.g. "Search ships by name, skills, or targeting…").

### 5. Manager → Ships page (data plumbing + filters)

**Data plumbing in `ShipsContext.tsx`** (so owned ships carry targeting):

- Add `active_target, active_pattern, charged_target, charged_pattern` to:
  - the authenticated `ship_templates!inner (...)` join select (~line 369),
  - the single-ship template type/map (`ship_templates` type ~line 100; mapping ~line 249),
  - the unauthenticated enrichment `.select(...)` (~line 315) and its mapping (~line 334).
- Map each to the corresponding `Ship` field (`activeTarget`, `activePattern`, `chargedTarget`,
  `chargedPattern`).

**Filters in `ShipInventory.tsx`:** mirror the Database page — same two `FilterConfig` entries
(shapes derived from the owned `ships`), same predicate + search extension, same
`hasActiveFilters` / `clearFilters` wiring. Persisted under the existing `ship-inventory-filters`
key.

## Testing

Unit-test `targetingFilter.ts` with `Ship` fixtures covering:

- active-only ship (no charged) — facets/search/match use active.
- charged inheriting from active (per `parseShipTargeting` fallback) — no double-count.
- ally/support selection (`team` / `self` / `others`).
- no-targeting ship — empty facets, empty search text, matches only when filters are empty.
- `matchesTargetingFilters`: OR within axis, AND across axes, empty-array = unconstrained.

Existing page tests should continue to pass; add a focused render/predicate test only if the
existing pages already have one to extend.

## Out of scope

- Range and target-side filters.
- Targeting on passive skills (none exists).
- Sorting by targeting.

## Files touched

- `src/constants/targetingRules.ts` — add `PATTERN_SHAPES`.
- `src/utils/targeting/targetingFilter.ts` — new helper (+ test).
- `src/hooks/usePersistedFilters.ts` — two new optional filter fields.
- `src/pages/database/ShipIndexPage.tsx` — two filters + search + wiring.
- `src/components/ship/ShipInventory.tsx` — two filters + search + wiring.
- `src/contexts/ShipsContext.tsx` — pull 4 targeting columns onto owned ships.
- `src/pages/DocumentationPage.tsx` — note the new filters (per repo convention).
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry (user-facing).
