# Engineering Preview Implementation Plan

## Task 1: Create Engineering Stats Constants

**File:** `src/constants/engineeringStats.ts`

Create:
- `ENGINEERING_STATS_BY_ROLE` - 4 stats per base role
- `ENGINEERING_CUMULATIVE_COSTS` - Cost table (levels 0-20)
- `getUpgradeCost(currentLevel)` - Helper function
- `getBaseRole(role)` - Extract base role from any role variant
- `getStatIncrement(statName)` - Returns 1 for %, 2 for flat

## Task 2: Create RoleSelector Component

**File:** `src/components/ui/RoleSelector.tsx`

- Wrap existing Select component
- Group options by base role with subtypes
- Props: value, onChange, label, className, disabled

## Task 3: Create EngineeringPreviewTab Component

**File:** `src/components/engineering/EngineeringPreviewTab.tsx`

- Ship selector (existing ShipSelector)
- Role selector (new RoleSelector)
- Radio button group for 4 engineering stats
- Preview panel with StatList and role score
- Empty states for missing selections

## Task 4: Update EngineeringStatsPage with Tabs

**File:** `src/pages/manager/EngineeringStatsPage.tsx`

- Add Tabs component (existing)
- Tab 1: "Engineering Stats" - existing content
- Tab 2: "Preview Upgrade" - new EngineeringPreviewTab

## Task 5: Test with Chrome MCP

- Navigate to http://localhost:3000/engineering
- Test tab switching
- Test ship selection
- Test role selection
- Test stat radio buttons
- Verify stat changes and score updates
