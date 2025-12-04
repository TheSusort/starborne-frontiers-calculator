# Code Quality Improvement Plan

## Overview
This document outlines a systematic approach to improving code quality across the Starborne Frontiers Calculator codebase, focusing on component organization, design system adherence, and code reusability.

## Goals
1. **Reduce file size** - Break down large components (>300 lines) into smaller, focused components
2. **Improve reusability** - Extract common patterns into reusable UI components
3. **Design system compliance** - Ensure all components follow the DESIGN_STYLE_GUIDE.md
4. **Code consistency** - Standardize patterns and reduce duplication
5. **Maintainability** - Improve code organization and readability

---

## Phase 1: Large File Analysis & Breakdown

### Priority 1: Files >450 lines (Critical)

#### 1.1 `src/components/simulation/SimulationResults.tsx` (481 lines)
**Issues:**
- Massive component handling multiple responsibilities
- Complex state management
- Multiple chart/table sub-components embedded

**Action Plan:**
- Extract chart components into separate files:
  - `SimulationDamageChart.tsx`
  - `SimulationSurvivabilityChart.tsx`
  - `SimulationSummaryTable.tsx`
- Extract configuration panels:
  - `SimulationConfigPanel.tsx`
  - `SimulationFilters.tsx`
- Create shared hooks:
  - `useSimulationData.ts`
  - `useSimulationCharts.ts`

**Target:** Break into 5-7 smaller components (~50-100 lines each)

#### 1.2 `src/components/admin/AddShipTemplateForm.tsx` (477 lines)
**Issues:**
- Complex form with multiple sections
- Embedded validation logic
- Mixed UI and business logic

**Action Plan:**
- Extract form sections:
  - `ShipTemplateBasicInfo.tsx`
  - `ShipTemplateStats.tsx`
  - `ShipTemplateSkills.tsx`
  - `ShipTemplateValidation.tsx`
- Extract validation into utilities:
  - `utils/shipTemplateValidation.ts`
- Create reusable form components:
  - `StatInputGroup.tsx` (if not exists)

**Target:** Break into 4-6 components (~80-120 lines each)

#### 1.3 `src/components/statistics/EngineeringStatsTab.tsx` (463 lines)
**Issues:**
- Large chart component
- Complex data transformation
- Multiple chart types embedded

**Action Plan:**
- Extract chart components:
  - `EngineeringStatsChart.tsx`
  - `EngineeringStatsTable.tsx`
- Extract data transformation:
  - `utils/engineeringStatsTransform.ts`
- Create shared chart utilities:
  - `utils/chartHelpers.ts`

**Target:** Break into 3-4 components (~100-150 lines each)

### Priority 2: Files 350-450 lines (High)

#### 2.1 `src/components/import/BackupRestoreData.tsx` (434 lines)
**Action Plan:**
- Extract backup/restore logic:
  - `BackupManager.tsx`
  - `RestoreManager.tsx`
  - `BackupValidation.tsx`
- Extract migration utilities:
  - `utils/dataMigration.ts`

#### 2.2 `src/components/gear/GearUpgradeAnalysis.tsx` (423 lines)
**Action Plan:**
- Extract analysis components:
  - `UpgradeAnalysisTable.tsx`
  - `UpgradeComparison.tsx`
  - `UpgradeFilters.tsx`
- Extract calculation logic:
  - `utils/upgradeAnalysis.ts`

#### 2.3 `src/components/calculator/DPSChart.tsx` (397 lines)
**Action Plan:**
- Extract chart components:
  - `DPSLineChart.tsx`
  - `DPSBarChart.tsx`
  - `DPSChartControls.tsx`
- Extract data processing:
  - `utils/dpsChartData.ts`

### Priority 3: Files 300-350 lines (Medium)

#### 3.1 `src/components/autogear/AutogearSettings.tsx` (375 lines)
**Action Plan:**
- Extract settings sections:
  - `AutogearBasicSettings.tsx`
  - `AutogearAdvancedSettings.tsx`
  - `AutogearStatPriorities.tsx`

#### 3.2 `src/components/ui/layout/Sidebar.tsx` (374 lines)
**Action Plan:**
- Extract navigation components:
  - `NavigationMenu.tsx`
  - `NavigationItem.tsx`
  - `UserMenu.tsx`
- Extract mobile menu:
  - `MobileMenu.tsx`

#### 3.3 `src/components/gear/GearInventory.tsx` (379 lines)
**Status:** ✅ Already improved with Pagination component
**Remaining Actions:**
- Extract filter logic into custom hook if needed
- Consider extracting search functionality

#### 3.4 `src/components/ship/ShipInventory.tsx` (369 lines)
**Status:** ✅ Already improved with Pagination component
**Remaining Actions:**
- Similar to GearInventory improvements

---

## Phase 2: Common Component Extraction

### 2.1 Table Components
**Current State:** Multiple table implementations with similar patterns

**Target Components:**
- `DataTable.tsx` - Generic data table with sorting, filtering
  - Used in: `AllUsersTable`, `TopUsersTable`, `TableSizesTable`
  - Features: Sortable columns, pagination, row actions
- `StatTable.tsx` - Specialized table for stat displays
  - Used in: `StatBreakdown`, `DPSCalculatorTable`
  - Features: Stat formatting, color coding

**Files to Refactor:**
- `src/components/admin/AllUsersTable.tsx`
- `src/components/admin/TopUsersTable.tsx`
- `src/components/admin/TableSizesTable.tsx`
- `src/components/stats/StatBreakdown.tsx`
- `src/components/calculator/DPSCalculatorTable.tsx`

### 2.2 Chart Components
**Current State:** Multiple chart implementations using recharts

**Target Components:**
- `BaseChart.tsx` - Wrapper for recharts with consistent styling
  - Standard colors, tooltips, axes
- `LineChart.tsx` - Specialized line chart
- `BarChart.tsx` - Specialized bar chart
- `ChartTooltip.tsx` - Consistent tooltip styling
- `ChartLegend.tsx` - Consistent legend styling

**Files to Refactor:**
- `src/components/calculator/DPSChart.tsx`
- `src/components/calculator/DefensePenetrationChart.tsx`
- `src/components/calculator/DamageReductionChart.tsx`
- `src/components/statistics/EngineeringStatsTab.tsx`
- `src/components/admin/UsageChart.tsx`
- `src/components/admin/GrowthChart.tsx`
- `src/components/admin/UserDistributionChart.tsx`

### 2.3 Form Components
**Current State:** Inline form implementations

**Target Components:**
- `FormField.tsx` - Standard form field wrapper
  - Label, input, error message, help text
- `FormSection.tsx` - Grouped form fields
- `NumberInput.tsx` - Specialized number input with validation
- `SelectField.tsx` - Select with label and error handling
- `CheckboxField.tsx` - Checkbox with label

**Files to Refactor:**
- `src/components/ship/ShipForm.tsx`
- `src/components/gear/GearPieceForm.tsx`
- `src/components/admin/AddShipTemplateForm.tsx`
- `src/components/loadout/LoadoutForm.tsx`
- `src/components/loadout/TeamLoadoutForm.tsx`

### 2.4 Card Components
**Current State:** Multiple card implementations

**Target Components:**
- `Card.tsx` - Base card component
  - Header, body, footer slots
  - Consistent padding, borders, backgrounds
- `StatCard.tsx` - ✅ Already exists, verify usage
- `InfoCard.tsx` - Card for displaying information
- `ActionCard.tsx` - Card with action buttons

**Files to Refactor:**
- `src/components/ship/ShipCard.tsx`
- `src/components/gear/GearPieceDisplay.tsx`
- `src/components/loadout/LoadoutCard.tsx`
- `src/components/loadout/TeamLoadoutCard.tsx`

### 2.5 Modal/Dialog Patterns
**Current State:** Inconsistent modal implementations

**Target Components:**
- `Dialog.tsx` - Base dialog component (if not exists)
- `FormDialog.tsx` - Dialog with form handling
- `ConfirmDialog.tsx` - ✅ Already exists as ConfirmModal

**Files to Review:**
- All modal implementations for consistency

---

## Phase 3: Design System Compliance

### 3.1 Color Usage Audit
**Issues Found:**
- Hardcoded colors in components
- Inconsistent use of design system colors
- Missing use of custom Tailwind colors

**Action Items:**
1. Search for hardcoded hex colors (`#...`)
2. Replace with design system colors:
   - `primary`, `primary-hover`
   - `dark`, `dark-lighter`, `dark-border`
   - Rarity colors: `common`, `uncommon`, `rare`, `epic`, `legendary`
3. Standardize semantic colors:
   - `text-gray-300`, `text-gray-400` for text
   - `border-gray-600`, `border-dark-border` for borders

**Files to Fix:**
- `src/components/stats/StatBreakdown.tsx` - Hardcoded colors
- `src/components/stats/UpgradeSuggestions.tsx` - Hardcoded colors
- `src/components/statistics/StatCard.tsx` - Verify color usage

### 3.2 Spacing Consistency
**Issues:**
- Inconsistent padding/margin usage
- Not following spacing system (2, 4, 6, 8)

**Action Items:**
1. Audit spacing usage
2. Standardize to spacing system
3. Create spacing utility classes if needed

### 3.3 Typography Consistency
**Issues:**
- Inconsistent font sizes
- Missing use of design system typography

**Action Items:**
1. Standardize headings: `text-2xl font-bold` for h1
2. Standardize body text: `text-gray-300`
3. Standardize secondary text: `text-sm text-gray-400`

### 3.4 Button Consistency
**Status:** ✅ Button component exists
**Action Items:**
1. Audit all button usage
2. Replace native `<button>` with `Button` component
3. Ensure consistent variant/size usage

**Files to Check:**
- All components using buttons

### 3.5 Border & Container Patterns
**Action Items:**
1. Standardize card containers: `bg-dark-lighter border border-gray-600 p-6`
2. Standardize input fields: `bg-dark-lighter border border-dark-border`
3. Ensure consistent border colors

---

## Phase 4: Code Pattern Standardization

### 4.1 State Management Patterns
**Action Items:**
1. Audit useState usage for complex state
2. Consider useReducer for complex state machines
3. Extract state logic into custom hooks

**Examples:**
- Form state → `useFormState` hook
- Filter state → ✅ Already exists as `usePersistedFilters`
- Modal state → `useModal` hook

### 4.2 Data Fetching Patterns
**Action Items:**
1. Standardize loading states
2. Standardize error handling
3. Create data fetching utilities

### 4.3 Event Handler Patterns
**Action Items:**
1. Standardize callback naming: `handle*` for event handlers
2. Extract complex handlers into separate functions
3. Use useCallback for memoization where appropriate

### 4.4 TypeScript Patterns
**Action Items:**
1. Ensure consistent interface/type usage
2. Extract shared types to `types/` directory
3. Use proper type guards
4. Avoid `any` types

---

## Phase 5: Component Organization

### 5.1 Directory Structure Improvements
**Current Issues:**
- Some components in wrong directories
- Missing sub-directories for complex components

**Proposed Structure:**
```
src/components/
├── ui/                    # ✅ Good
│   ├── layout/            # ✅ Good
│   └── icons/             # ✅ Good
├── ship/
│   ├── ShipCard.tsx
│   ├── ShipForm.tsx
│   ├── ShipDisplay.tsx
│   └── ShipSelector.tsx
├── gear/
│   ├── GearCard.tsx       # Rename from GearPieceDisplay?
│   ├── GearForm.tsx
│   └── GearInventory.tsx
├── charts/                # NEW - Extract chart components
│   ├── BaseChart.tsx
│   ├── LineChart.tsx
│   └── BarChart.tsx
├── tables/                # NEW - Extract table components
│   ├── DataTable.tsx
│   └── StatTable.tsx
└── forms/                 # NEW - Extract form components
    ├── FormField.tsx
    └── FormSection.tsx
```

### 5.2 Component Naming
**Action Items:**
1. Ensure consistent naming: PascalCase
2. Use descriptive names
3. Consider renaming for clarity:
   - `GearPieceDisplay` → `GearCard`?
   - Verify all component names are clear

---

## Phase 6: Performance Optimizations

### 6.1 Memoization
**Action Items:**
1. Audit components for unnecessary re-renders
2. Add React.memo where appropriate
3. Use useMemo/useCallback for expensive computations

**Files to Review:**
- Large list components
- Chart components
- Form components

### 6.2 Code Splitting
**Status:** ✅ Already using lazy loading for pages
**Action Items:**
1. Consider code splitting for large components
2. Lazy load heavy chart libraries if possible

---

## Implementation Strategy

### Approach
1. **Incremental** - Work on one file/component at a time
2. **Test-driven** - Ensure tests pass after each refactor
3. **Documentation** - Update documentation as we go
4. **Review** - Test thoroughly before moving to next item

### Priority Order
1. **Phase 1** - Break down largest files first (biggest impact)
2. **Phase 2** - Extract common components (enables reuse)
3. **Phase 3** - Design system compliance (consistency)
4. **Phase 4** - Pattern standardization (maintainability)
5. **Phase 5** - Organization (long-term maintainability)
6. **Phase 6** - Performance (optimization)

### Success Metrics
- Average file size < 250 lines
- No files > 400 lines
- 80%+ of components using design system classes
- Reduced code duplication
- Improved test coverage
- Faster development velocity

---

## Quick Wins (Start Here)

### Week 1: Quick Wins
1. ✅ Create Pagination component (DONE)
2. Extract `DataTable` component from `AllUsersTable`
3. Extract `BaseChart` wrapper component
4. Fix hardcoded colors in `StatBreakdown.tsx`

### Week 2: Large Files
1. Break down `SimulationResults.tsx`
2. Break down `AddShipTemplateForm.tsx`
3. Break down `EngineeringStatsTab.tsx`

### Week 3: Common Components
1. Create `FormField` component
2. Create `Card` base component
3. Standardize chart components

---

## Notes

- Always run tests after refactoring
- Update TypeScript types as needed
- Follow existing code patterns where possible
- Document new components in DESIGN_STYLE_GUIDE.md if they become patterns
- Consider accessibility in all changes
- Maintain backward compatibility where possible

