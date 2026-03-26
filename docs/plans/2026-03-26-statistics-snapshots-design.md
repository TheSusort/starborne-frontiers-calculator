# Statistics Snapshots & Monthly Comparison

## Overview

Add monthly statistics snapshots for authenticated users, enabling comparison of fleet progression over time. Snapshots are created automatically on the first Statistics page visit each month and stored indefinitely.

## Requirements

- **Granularity:** Hybrid — summary metrics (for delta badges) + distribution data (for side-by-side charts)
- **Trigger:** Automatic on first Statistics page visit each month (authenticated users only)
- **Retention:** Unlimited
- **Default comparison:** Previous month
- **UI:** Delta indicators on metric cards, side-by-side grouped bars on distribution charts
- **Snapshots always capture unfiltered statistics** — filters active in the UI at snapshot time are ignored

## Storage Estimation

Each snapshot stores summary metrics + distributions as JSONB. Rough per-user per-month estimate:
- Ships: ~2-4 KB (metrics + 5 distributions)
- Gear: ~3-5 KB (metrics + 6 distributions)
- Implants: ~1-2 KB (metrics + 3 distributions)
- Engineering: ~2-3 KB (per-role breakdown)
- **Total: ~8-14 KB per snapshot**

At 100 users with 24 months of history: ~100 * 24 * 14 KB = ~33 MB. Well within the 500 MB Supabase limit.

## Database Schema

### Table: `statistics_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | Default `gen_random_uuid()` |
| `user_id` | uuid (FK -> users) | NOT NULL, CASCADE on delete |
| `snapshot_month` | date | First day of month (e.g., `2026-03-01`). NOT NULL |
| `ships_stats` | jsonb | Ship metrics + distributions |
| `gear_stats` | jsonb | Gear metrics + distributions |
| `implants_stats` | jsonb | Implant metrics + distributions |
| `engineering_stats` | jsonb | Engineering metrics + distributions |
| `created_at` | timestamptz | Default `now()` |

**Constraints:**
- `UNIQUE(user_id, snapshot_month)` — one snapshot per user per month
- Index on `user_id` for fast lookups

**RLS policies:**
- `SELECT`: `auth.uid() = user_id`
- `INSERT`: `auth.uid() = user_id`
- No UPDATE or DELETE — snapshots are immutable

## JSONB Snapshot Interfaces

Snapshot interfaces directly mirror the existing utility function return types. No transformation needed — the utility output is stored as-is. Note: union types like `ShipTypeName` become `string` after JSONB round-trip, so snapshot interfaces use `string` where the source uses branded types.

### ShipsSnapshot

Mirrors `ShipStatistics` from `src/utils/statistics/shipsStats.ts`:

```typescript
interface ShipsSnapshot {
  total: number;
  averageLevel: number;
  maxLevelCount: number;
  maxLevelPercentage: number;
  withImplantsCount: number;
  withImplantsPercentage: number;
  fullyGearedCount: number;
  fullyGearedPercentage: number;
  ungearedCount: number;
  ungearedPercentage: number;
  refits: {
    total: number;
    average: number;
    byRarity: { rarity: string; count: number }[];
  };
  byRarity: { rarity: string; count: number; percentage: number }[];
  byRole: { role: string; count: number; percentage: number }[];
  byFaction: { faction: string; count: number }[];
  levels: { range: string; count: number }[];
}
```

### GearSnapshot

Mirrors `GearStatistics` from `src/utils/statistics/gearStats.ts`:

```typescript
interface GearSnapshot {
  total: number;
  equippedCount: number;
  equippedPercentage: number;
  unequippedCount: number;
  unequippedPercentage: number;
  averageLevel: number;
  averageStarLevel: number;
  maxLevelCount: number;
  maxLevelPercentage: number;
  bySet: { setName: string; count: number }[];
  byMainStat: { statName: string; statType: string; count: number; category: 'Offensive' | 'Defensive' | 'Utility' }[];
  byRarity: { rarity: string; count: number; percentage: number }[];
  byStarLevel: { stars: number; count: number }[];
  byLevel: { range: string; count: number }[];
  bySlot: { slot: string; count: number }[];
}
```

Note: "Most common set" and "most common main stat" (shown as StatCard metrics in the UI) are derived from `bySet[0].setName` and `byMainStat[0].statName` at render time, not stored separately.

### ImplantsSnapshot

Mirrors `ImplantStatistics` from `src/utils/statistics/implantsStats.ts`:

```typescript
interface ImplantsSnapshot {
  total: number;
  equippedCount: number;
  equippedPercentage: number;
  unequippedCount: number;
  unequippedPercentage: number;
  byRarity: { rarity: string; count: number; percentage: number }[];
  byType: { type: string; count: number; percentage: number }[];
  setsByType: {
    type: string;
    totalCount: number;
    setBonuses: { setName: string; count: number; percentage: number }[];
  }[];
}
```

### EngineeringSnapshot

Mirrors `EngineeringStatistics` from `src/utils/statistics/engineeringStats.ts`:

```typescript
interface EngineeringSnapshot {
  totalPoints: number;
  averagePointsPerRole: number;
  mostInvestedRole: { role: string; points: number } | null;
  leastInvestedRole: { role: string; points: number } | null;
  rolesWithZeroInvestment: string[];
  byRole: {
    role: string;
    totalPoints: number;
    byStatType: { statName: string; points: number }[];
  }[];
}
```

## Snapshot Creation Logic

### Hook: `useStatisticsSnapshot`

Called from `StatisticsPage.tsx` where all three data contexts are available.

**Flow:**
1. Check: user authenticated? All data loaded (ships, inventory, engineering)?
2. Query: does snapshot exist for `(user_id, current month first day)`?
3. If no snapshot and user has data:
   - Filter inventory: gear = items where `!slot.startsWith('implant_')`, implants = items where `slot.startsWith('implant_')`
   - Compute stats using existing utility functions with **unfiltered** data (no role/rarity/set filters applied):
     - `calculateShipStatistics(ships)`
     - `calculateGearStatistics(gear, ships)` — requires unfiltered `ships` for equipped/unequipped status
     - `calculateImplantStatistics(implants, ships)` — also requires unfiltered `ships`
     - `calculateEngineeringStatistics(engineeringStats.stats)`
   - Store the utility function return values directly as JSONB — no transformation needed
   - `INSERT ... ON CONFLICT DO NOTHING` (race condition safety)
4. If snapshot exists, skip

**Why Statistics page?** It's the only place all three contexts (ships, inventory, engineering) are guaranteed loaded. Triggering globally would require loading all data on every page visit.

**Mid-month data changes:** The snapshot reflects data at the time of first Statistics page visit that month. Data imported after the snapshot is captured will be reflected in next month's comparison. This is intentional — snapshots are immutable point-in-time records.

### Hook return value

```typescript
{
  snapshots: { id: string; snapshotMonth: string }[];  // ISO date strings for dropdown
  selectedSnapshot: StatisticsSnapshot | null;
  selectedMonth: string | null;  // ISO date string
  setSelectedMonth: (month: string | null) => void;
  loading: boolean;
}
```

Note: Supabase returns dates as ISO strings. The service layer passes them through as strings; formatting to "March 2026" happens in the UI component.

## Service Layer

### `statisticsSnapshotService.ts`

- `getSnapshotList(userId)` — Fetch snapshot metadata (`id`, `snapshot_month`) for dropdown. Selects only these columns, no JSONB.
- `getSnapshot(userId, month)` — Fetch full snapshot for a specific month.
- `createSnapshot(userId, month, data)` — Insert snapshot with `ON CONFLICT DO NOTHING`.

### Loading strategy

- On mount: fetch snapshot list + previous month snapshot in parallel with existing data
- On dropdown change: fetch selected month's full snapshot, cache in state
- Tab switches reuse the cached snapshot (no re-fetch)

## Comparison UI

### Snapshot Selector

Dropdown at the top of the Statistics page, next to the tab navigation. Options: available months formatted as "March 2026", plus "None" to hide comparisons. Default: previous month.

### StatCard Delta Indicators

New optional props on `StatCard`:

```typescript
interface StatCardProps {
  // ...existing props
  previousValue?: number;
  positiveDirection?: 'up' | 'down';  // default: 'up'
}
```

- When `previousValue` is provided, renders a small delta badge below the value
- Delta = current numeric value - previousValue
- Badge color: green if delta is in the positive direction, red if opposite, gray if zero
- Format: `+5`, `-3`, `0` for integers; `+2.5%` for percentage metrics
- `positiveDirection: 'down'` used for metrics like "ungeared ships" where less is better
- `previousValue` should only be provided on cards where `value` is numeric (or a numeric string like `"38.2"`). Do not provide `previousValue` on cards with non-numeric values (e.g., "Attacker"). The delta is computed as `previousValue` minus current numeric value.

### Chart Side-by-Side Comparison

- When a comparison snapshot is selected, distribution charts render two bar series: "Current" and the snapshot month name (e.g., "Feb 2026")
- Recharts grouped bars (multiple `<Bar>` elements)
- Pie charts: show as pie when no comparison selected, convert to grouped bar charts when comparing (preserves normal UX, enables comparison when needed)
- Color coding: current = existing chart colors, snapshot = muted/lighter variant

### Empty States

- No snapshots available: "Snapshots are saved automatically each month. Check back next month to compare your progress."
- Selected month missing data for a tab: hide comparison for that tab

## File Structure

```
src/
├── types/
│   └── statisticsSnapshot.ts          # Snapshot interfaces
├── services/
│   └── statisticsSnapshotService.ts   # Supabase CRUD
├── hooks/
│   └── useStatisticsSnapshot.ts       # Auto-create + selection logic
├── components/
│   └── statistics/
│       └── SnapshotSelector.tsx        # Month dropdown
supabase/
└── migrations/
    └── 20260326000001_add_statistics_snapshots.sql
```

## Migration SQL

```sql
CREATE TABLE statistics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_month date NOT NULL,
  ships_stats jsonb,
  gear_stats jsonb,
  implants_stats jsonb,
  engineering_stats jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, snapshot_month)
);

CREATE INDEX idx_statistics_snapshots_user_id ON statistics_snapshots(user_id);

ALTER TABLE statistics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own snapshots"
  ON statistics_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots"
  ON statistics_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```
