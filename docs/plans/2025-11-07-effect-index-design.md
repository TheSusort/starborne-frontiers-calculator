# Effect Index Design

**Date:** 2025-11-07
**Status:** Approved
**Approach:** Minimal Clone Pattern

## Overview

Add a searchable/filterable "Effect Index" page displaying all 155 buffs, debuffs, and effects from `constants/buffs.ts`. This follows the established pattern of Ship Database and Implants pages.

## Context

The app has comprehensive ship and implant databases, but no dedicated page for viewing game effects (buffs/debuffs). Players need an easy way to search and reference what effects do during gameplay.

**Current State:**
- 155 effects defined in `src/constants/buffs.ts`
- Each has: `name`, `description`, `type` ('buff' | 'debuff' | 'effect')
- Manually maintained (not auto-generated)
- No images currently mapped (future enhancement)

## Requirements

**Must Have:**
- Display all 155 effects in searchable/filterable grid
- Search by: name, type, or description
- Filter by type: buff, debuff, effect
- Sort by name (ascending/descending)
- Responsive grid layout (2-3 columns)
- Color-coded type badges
- Route: `/buffs`
- Sidebar label: "Effect Index"

**Nice to Have:**
- Support for optional effect images (via `imageKey`)
- Persistent filter state (like other database pages)
- Result count display
- Graceful image fallback when missing

**Constraints:**
- No git workflows - develop directly in main
- Follow existing ImplantIndexPage pattern exactly
- Maintain consistency with Ship Database styling
- Keep implementation simple (static data, no hooks needed)

## Design Decisions

### Approach Selected: Minimal Clone Pattern

Clone the proven ImplantIndexPage structure:
- Use existing components (`FilterPanel`, `SearchInput`, `PageLayout`)
- Import `BUFFS` array directly from constants
- No custom hooks needed (static data)
- `usePersistedFilters` for state management

**Why not create a data hook?**
Effects are static, manually-maintained data. Unlike ships/implants which come from database/external sources, buffs don't need abstraction. Following YAGNI principle.

**Why not refactor into shared component?**
Would require touching working Ship Database and Implants pages. High risk, low immediate benefit. Current approach ships faster and is proven.

### Type Badge Colors

Match existing dark theme patterns:
- **Buff** (positive): Green (`bg-green-500/20 text-green-400 border-green-500/30`)
- **Debuff** (negative): Red (`bg-red-500/20 text-red-400 border-red-500/30`)
- **Effect** (neutral): Blue (`bg-blue-500/20 text-blue-400 border-blue-500/30`)

### Image Support Strategy

**Phase 1 (MVP):** Add `imageKey?: string` to Buff interface, display placeholder
**Phase 2 (Future):** Populate imageKey values as images become available
**Phase 3 (Future):** Full Cloudinary integration (already exists in codebase)

Graceful degradation: Show effect name if no image available.

## Implementation Plan

### 1. Update Data Model

**File:** `src/constants/buffs.ts`

Add optional `imageKey` field:
```typescript
export interface Buff {
    name: string;
    description: string;
    type: 'buff' | 'debuff' | 'effect';
    imageKey?: string; // NEW - optional for future use
}
```

No changes to existing 155 buff objects needed (backward compatible).

### 2. Create EffectIndexPage Component

**File:** `src/pages/EffectIndexPage.tsx`

**Structure:**
```typescript
- Import BUFFS from constants/buffs
- useState for search query
- usePersistedFilters('effect-index-filters') for filters/sort
- useMemo for filtering and sorting logic
- FilterPanel with type filters (buff/debuff/effect)
- SearchInput searching across name, type, description
- Grid of effect cards (2-3 columns, responsive)
```

**Search Logic:**
```typescript
const matchesSearch =
    searchQuery === '' ||
    buff.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    buff.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
    buff.description.toLowerCase().includes(searchQuery.toLowerCase());
```

**Card Display:**
- Type badge at top (color-coded)
- Optional image area (w-12 h-12, centered)
- Effect name (font-semibold, text-white)
- Description (text-sm, text-gray-300)
- Border hover effect (border-primary on hover)

### 3. Add Routing

**File:** `src/App.tsx`

**Add lazy import:**
```typescript
const EffectIndexPage = lazy(() => import('./pages/EffectIndexPage'));
```

**Add route:**
```typescript
<Route path="/buffs" element={<EffectIndexPage />} />
```

Position: After implants route, before shared encounters.

### 4. Update Sidebar Navigation

**File:** `src/components/ui/layout/Sidebar.tsx`

Add after "Implants", before "Shared Encounters":
```typescript
{ path: '/ships/index', label: 'Ship Database' },
{ path: '/implants', label: 'Implants' },
{ path: '/buffs', label: 'Effect Index' }, // NEW
{ path: '/shared-encounters', label: 'Shared Encounters' },
```

### 5. Add SEO Configuration

**File:** `src/constants/seo.ts`

```typescript
export const SEO_CONFIG = {
    // ... existing configs
    effectIndex: {
        title: 'Effect Index - Starborne Frontiers Calculator',
        description: 'Browse all buffs, debuffs, and effects in Starborne Frontiers. Search and filter through 155+ game effects.',
        keywords: 'starborne, frontiers, buffs, debuffs, effects, status effects, abilities',
    },
};
```

### 6. Documentation Update

**File:** `src/pages/DocumentationPage.tsx`

Add section about Effect Index in appropriate location:
```tsx
<p className="text-gray-300">
    The Effect Index provides a comprehensive reference of all buffs,
    debuffs, and effects in the game. Use the search bar to find specific
    effects or filter by type.
</p>
```

## Component Patterns

### Filter Configuration
```typescript
const filters: FilterConfig[] = [
    {
        id: 'type',
        label: 'Type',
        values: state.filters.types ?? [],
        onChange: setSelectedTypes,
        options: [
            { value: 'buff', label: 'Buff' },
            { value: 'debuff', label: 'Debuff' },
            { value: 'effect', label: 'Effect' },
        ],
    },
];
```

### Sort Configuration
```typescript
const sortOptions = [
    { value: 'name', label: 'Name' },
];
```

### Type Badge Component
```typescript
const getTypeBadgeClasses = (type: Buff['type']) => {
    switch (type) {
        case 'buff':
            return 'bg-green-500/20 text-green-400 border border-green-500/30';
        case 'debuff':
            return 'bg-red-500/20 text-red-400 border border-red-500/30';
        case 'effect':
            return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    }
};
```

## Data Flow

```
BUFFS constant (buffs.ts)
    ↓
EffectIndexPage imports directly
    ↓
useState (searchQuery)
usePersistedFilters (filters, sort)
    ↓
useMemo (filter + sort logic)
    ↓
Render grid of effect cards
```

No API calls, no hooks, no database queries - pure static data display.

## Testing Strategy

**Manual Testing:**
- [ ] Navigate to `/buffs` - page loads successfully
- [ ] Search by effect name - correct results
- [ ] Search by type ("buff"/"debuff"/"effect") - correct results
- [ ] Search by description text - correct results
- [ ] Filter by each type - correct filtering
- [ ] Clear filters - shows all 155 effects
- [ ] Sort ascending/descending - correct ordering
- [ ] Responsive layout - works on mobile/tablet/desktop
- [ ] Sidebar link - navigates correctly
- [ ] Type badge colors - correct for each type
- [ ] Image placeholder area - displays correctly (even without images)
- [ ] Result count - displays correct number

**Build Verification:**
```bash
npm run build  # TypeScript compilation succeeds
npm run lint   # No new linting errors
```

## Future Enhancements

### Phase 2: Add Images
When effect images are available:
1. Map image keys in `constants/buffs.ts`
2. Images display automatically (component already supports this)
3. No code changes needed to EffectIndexPage

### Phase 3: Advanced Filters
If requested:
- Filter by stat affected (attack, defense, speed, etc.)
- Filter by duration (temporary vs permanent)
- Filter by source (skill vs item vs passive)

### Phase 4: Effect Details Modal
Click effect card to show:
- Full description
- Related skills that apply this effect
- Ships with abilities using this effect
- Strategy tips

## Rollback Plan

If issues discovered:
1. Remove route from `App.tsx`
2. Remove sidebar link from `Sidebar.tsx`
3. Delete `EffectIndexPage.tsx`
4. Revert `Buff` interface changes in `buffs.ts` (if needed)

No database changes, no migration needed - purely additive frontend feature.

## Success Criteria

- ✅ Page accessible at `/buffs`
- ✅ All 155 effects display correctly
- ✅ Search works across name, type, description
- ✅ Filter by type works (buff/debuff/effect)
- ✅ Sort by name works (asc/desc)
- ✅ Type badges color-coded correctly
- ✅ Sidebar navigation link works
- ✅ Responsive on all screen sizes
- ✅ No TypeScript errors
- ✅ No new linting warnings
- ✅ Follows existing page patterns
- ✅ Documentation updated

## Files to Create/Modify

**New Files:**
- `src/pages/EffectIndexPage.tsx` (~150-200 lines)
- `docs/plans/2025-11-07-effect-index-design.md` (this file)

**Modified Files:**
- `src/constants/buffs.ts` (add optional imageKey field)
- `src/App.tsx` (add route)
- `src/components/ui/layout/Sidebar.tsx` (add nav link)
- `src/constants/seo.ts` (add SEO config)
- `src/pages/DocumentationPage.tsx` (add documentation)

**Total Estimated LOC:** ~200 new lines, ~20 modified lines
