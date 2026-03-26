# Statistics Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable authenticated users to compare their statistics page data against automatically saved monthly snapshots.

**Architecture:** A Supabase table stores monthly JSONB snapshots of computed statistics. A hook auto-creates snapshots on first Statistics page visit each month. The UI adds delta badges to StatCards and side-by-side grouped bars on distribution charts, controlled by a month-selector dropdown.

**Tech Stack:** React 18, TypeScript, Supabase (JSONB), Recharts, Vitest

**Spec:** `docs/plans/2026-03-26-statistics-snapshots-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260326000001_add_statistics_snapshots.sql` | DB table, index, RLS |
| Create | `src/types/statisticsSnapshot.ts` | Snapshot TypeScript interfaces |
| Create | `src/services/statisticsSnapshotService.ts` | Supabase CRUD (list, get, create) |
| Create | `src/hooks/useStatisticsSnapshot.ts` | Auto-create + selection state |
| Create | `src/components/statistics/SnapshotSelector.tsx` | Month dropdown component |
| Modify | `src/components/ui/StatCard.tsx` | Add `previousValue` + `positiveDirection` props |
| Modify | `src/pages/manager/StatisticsPage.tsx` | Wire hook, pass snapshot data to tabs |
| Modify | `src/components/statistics/ShipsStatsTab.tsx` | Accept snapshot prop, render deltas + comparison charts |
| Modify | `src/components/statistics/GearStatsTab.tsx` | Accept snapshot prop, render deltas + comparison charts |
| Modify | `src/components/statistics/ImplantsStatsTab.tsx` | Accept snapshot prop, render deltas + comparison charts |
| Modify | `src/components/statistics/EngineeringStatsTab.tsx` | Accept snapshot prop, render deltas + comparison charts |
| Create | `src/utils/statistics/mergeDistributions.ts` | Shared helper for merging current + previous chart data |
| Create | `src/__tests__/services/statisticsSnapshotService.test.ts` | Service unit tests |
| Create | `src/__tests__/hooks/useStatisticsSnapshot.test.ts` | Hook unit tests |
| Create | `src/__tests__/components/ui/StatCard.test.tsx` | StatCard delta rendering tests |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260326000001_add_statistics_snapshots.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Statistics snapshots for monthly comparison
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

-- Rollback: DROP TABLE statistics_snapshots;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260326000001_add_statistics_snapshots.sql
git commit -m "feat: add statistics_snapshots migration"
```

---

### Task 2: TypeScript Interfaces

**Files:**
- Create: `src/types/statisticsSnapshot.ts`

- [ ] **Step 1: Create snapshot type definitions**

These interfaces mirror the return types of the existing statistics utility functions. Union types like `ShipTypeName` become `string` because JSONB round-trips lose branded types.

```typescript
// src/types/statisticsSnapshot.ts

export interface ShipsSnapshot {
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

export interface GearSnapshot {
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
    byMainStat: {
        statName: string;
        statType: string;
        count: number;
        category: 'Offensive' | 'Defensive' | 'Utility';
    }[];
    byRarity: { rarity: string; count: number; percentage: number }[];
    byStarLevel: { stars: number; count: number }[];
    byLevel: { range: string; count: number }[];
    bySlot: { slot: string; count: number }[];
}

export interface ImplantsSnapshot {
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

export interface EngineeringSnapshot {
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

export interface StatisticsSnapshot {
    id: string;
    userId: string;
    snapshotMonth: string; // ISO date string, e.g. "2026-03-01"
    shipsStats: ShipsSnapshot | null;
    gearStats: GearSnapshot | null;
    implantsStats: ImplantsSnapshot | null;
    engineeringStats: EngineeringSnapshot | null;
    createdAt: string;
}

export interface SnapshotListItem {
    id: string;
    snapshotMonth: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/statisticsSnapshot.ts
git commit -m "feat: add statistics snapshot type definitions"
```

---

### Task 3: Service Layer

**Files:**
- Create: `src/services/statisticsSnapshotService.ts`
- Create: `src/__tests__/services/statisticsSnapshotService.test.ts`

- [ ] **Step 1: Write the service tests**

```typescript
// src/__tests__/services/statisticsSnapshotService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase before importing the service
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: mockSelect,
            insert: mockInsert,
        })),
    },
}));

import {
    getSnapshotList,
    getSnapshot,
    createSnapshot,
} from '../../services/statisticsSnapshotService';

describe('statisticsSnapshotService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Chain setup for select queries
        mockSelect.mockReturnValue({ eq: mockEq });
        mockEq.mockReturnValue({ order: mockOrder });
        mockOrder.mockReturnValue({ data: [], error: null });
    });

    describe('getSnapshotList', () => {
        it('fetches only id and snapshot_month columns', async () => {
            mockOrder.mockReturnValue({
                data: [
                    { id: '1', snapshot_month: '2026-03-01' },
                    { id: '2', snapshot_month: '2026-02-01' },
                ],
                error: null,
            });

            const result = await getSnapshotList('user-123');
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                id: '1',
                snapshotMonth: '2026-03-01',
            });
        });

        it('returns empty array on error', async () => {
            mockOrder.mockReturnValue({
                data: null,
                error: { message: 'fail' },
            });

            const result = await getSnapshotList('user-123');
            expect(result).toEqual([]);
        });
    });

    describe('getSnapshot', () => {
        it('fetches full snapshot for a specific month', async () => {
            const mockSnapshot = {
                id: '1',
                user_id: 'user-123',
                snapshot_month: '2026-03-01',
                ships_stats: { total: 10 },
                gear_stats: null,
                implants_stats: null,
                engineering_stats: null,
                created_at: '2026-03-01T00:00:00Z',
            };
            mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
            mockMaybeSingle.mockReturnValue({ data: mockSnapshot, error: null });

            const result = await getSnapshot('user-123', '2026-03-01');
            expect(result).not.toBeNull();
            expect(result!.shipsStats).toEqual({ total: 10 });
        });

        it('returns null when no snapshot exists', async () => {
            mockEq.mockReturnValue({ maybeSingle: mockMaybeSingle });
            mockMaybeSingle.mockReturnValue({ data: null, error: null });

            const result = await getSnapshot('user-123', '2026-03-01');
            expect(result).toBeNull();
        });
    });

    describe('createSnapshot', () => {
        it('upserts with ignoreDuplicates for ON CONFLICT DO NOTHING behavior', async () => {
            const mockUpsert = vi.fn().mockReturnValue({ error: null });
            // Re-mock to include upsert
            const { supabase } = await import('../../config/supabase');
            (supabase.from as any).mockReturnValue({ upsert: mockUpsert });

            await createSnapshot('user-123', '2026-03-01', {
                shipsStats: null,
                gearStats: null,
                implantsStats: null,
                engineeringStats: null,
            });

            expect(mockUpsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    user_id: 'user-123',
                    snapshot_month: '2026-03-01',
                }),
                expect.objectContaining({ onConflict: 'user_id,snapshot_month', ignoreDuplicates: true })
            );
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/services/statisticsSnapshotService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

```typescript
// src/services/statisticsSnapshotService.ts
import { supabase } from '../config/supabase';
import {
    StatisticsSnapshot,
    SnapshotListItem,
    ShipsSnapshot,
    GearSnapshot,
    ImplantsSnapshot,
    EngineeringSnapshot,
} from '../types/statisticsSnapshot';

interface SnapshotData {
    shipsStats: ShipsSnapshot | null;
    gearStats: GearSnapshot | null;
    implantsStats: ImplantsSnapshot | null;
    engineeringStats: EngineeringSnapshot | null;
}

export async function getSnapshotList(userId: string): Promise<SnapshotListItem[]> {
    const { data, error } = await supabase
        .from('statistics_snapshots')
        .select('id, snapshot_month')
        .eq('user_id', userId)
        .order('snapshot_month', { ascending: false });

    if (error) {
        console.error('Failed to fetch snapshot list:', error);
        return [];
    }

    return (data || []).map((row) => ({
        id: row.id,
        snapshotMonth: row.snapshot_month,
    }));
}

export async function getSnapshot(
    userId: string,
    month: string
): Promise<StatisticsSnapshot | null> {
    const { data, error } = await supabase
        .from('statistics_snapshots')
        .select('*')
        .eq('user_id', userId)
        .eq('snapshot_month', month)
        .maybeSingle();

    if (error) {
        console.error('Failed to fetch snapshot:', error);
        return null;
    }

    if (!data) return null;

    return {
        id: data.id,
        userId: data.user_id,
        snapshotMonth: data.snapshot_month,
        shipsStats: data.ships_stats,
        gearStats: data.gear_stats,
        implantsStats: data.implants_stats,
        engineeringStats: data.engineering_stats,
        createdAt: data.created_at,
    };
}

export async function createSnapshot(
    userId: string,
    month: string,
    snapshotData: SnapshotData
): Promise<void> {
    const { error } = await supabase.from('statistics_snapshots').upsert(
        {
            user_id: userId,
            snapshot_month: month,
            ships_stats: snapshotData.shipsStats,
            gear_stats: snapshotData.gearStats,
            implants_stats: snapshotData.implantsStats,
            engineering_stats: snapshotData.engineeringStats,
        },
        { onConflict: 'user_id,snapshot_month', ignoreDuplicates: true }
    );

    if (error) {
        console.error('Failed to create snapshot:', error);
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/services/statisticsSnapshotService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/statisticsSnapshotService.ts src/__tests__/services/statisticsSnapshotService.test.ts
git commit -m "feat: add statistics snapshot service layer"
```

---

### Task 4: StatCard Delta Indicators

**Files:**
- Modify: `src/components/ui/StatCard.tsx`
- Create: `src/__tests__/components/ui/StatCard.test.tsx`

- [ ] **Step 1: Write StatCard delta tests**

```typescript
// src/__tests__/components/ui/StatCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../../../components/ui/StatCard';

describe('StatCard', () => {
    it('renders without delta when no previousValue', () => {
        render(<StatCard title="Total Ships" value={42} />);
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.queryByText(/[+-]/)).not.toBeInTheDocument();
    });

    it('renders positive delta in green', () => {
        render(<StatCard title="Total Ships" value={42} previousValue={35} />);
        const delta = screen.getByText('+7');
        expect(delta.className).toContain('text-green');
    });

    it('renders negative delta in red (positive direction = up)', () => {
        render(<StatCard title="Total Ships" value={30} previousValue={35} />);
        const delta = screen.getByText('-5');
        expect(delta.className).toContain('text-red');
    });

    it('respects positiveDirection=down (less is better)', () => {
        // Ungeared ships went from 10 to 5 — that's good
        render(
            <StatCard title="Ungeared" value={5} previousValue={10} positiveDirection="down" />
        );
        const delta = screen.getByText('-5');
        expect(delta.className).toContain('text-green');
    });

    it('renders zero delta in gray', () => {
        render(<StatCard title="Total Ships" value={42} previousValue={42} />);
        const delta = screen.getByText('0');
        expect(delta.className).toContain('text-gray');
    });

    it('handles string numeric values', () => {
        render(<StatCard title="Avg Level" value="38.2" previousValue={36.0} />);
        const delta = screen.getByText('+2.2');
        expect(delta).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/components/ui/StatCard.test.tsx`
Expected: FAIL — `previousValue` prop doesn't exist yet

- [ ] **Step 3: Implement StatCard delta rendering**

Modify `src/components/ui/StatCard.tsx`:

Add `previousValue?: number` and `positiveDirection?: 'up' | 'down'` to the props interface. Add delta badge rendering after the subtitle.

```typescript
// Updated StatCard component
import React from 'react';

interface StatCardProps {
    title: string;
    value: string | number;
    subtitle?: string;
    icon?: React.ReactNode;
    color?: 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'red';
    className?: string;
    previousValue?: number;
    positiveDirection?: 'up' | 'down';
}

const colorClasses = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
    default: 'text-white',
};

export const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    subtitle,
    icon,
    color = 'default',
    className = '',
    previousValue,
    positiveDirection = 'up',
}) => {
    const renderDelta = () => {
        if (previousValue === undefined) return null;

        const currentNumeric =
            typeof value === 'number' ? value : parseFloat(String(value));
        if (isNaN(currentNumeric)) return null;

        const delta = currentNumeric - previousValue;
        const rounded = Math.abs(delta) < 0.1 ? 0 : parseFloat(delta.toFixed(1));

        if (rounded === 0) {
            return <span className="text-xs text-gray-400">0</span>;
        }

        const isPositiveChange = rounded > 0;
        const isGood =
            positiveDirection === 'up' ? isPositiveChange : !isPositiveChange;
        const colorClass = isGood ? 'text-green-400' : 'text-red-400';
        const prefix = rounded > 0 ? '+' : '';

        return (
            <span className={`text-xs font-medium ${colorClass}`}>
                {prefix}
                {rounded}
            </span>
        );
    };

    return (
        <div className={`card ${className}`}>
            <div className={icon ? 'flex items-center justify-between' : ''}>
                <div>
                    <div className="text-sm text-theme-text-secondary mb-1">{title}</div>
                    <div
                        className={`text-2xl font-bold ${colorClasses[color as keyof typeof colorClasses] ?? colorClasses.default}`}
                    >
                        {value}
                    </div>
                    {subtitle && (
                        <div className="text-xs text-theme-text-secondary mt-1">{subtitle}</div>
                    )}
                    {renderDelta()}
                </div>
                {icon && <div className="text-4xl opacity-50">{icon}</div>}
            </div>
        </div>
    );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/components/ui/StatCard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/StatCard.tsx src/__tests__/components/ui/StatCard.test.tsx
git commit -m "feat: add delta indicators to StatCard"
```

---

### Task 5: useStatisticsSnapshot Hook

**Files:**
- Create: `src/hooks/useStatisticsSnapshot.ts`
- Create: `src/__tests__/hooks/useStatisticsSnapshot.test.ts`

- [ ] **Step 1: Write the hook tests**

```typescript
// src/__tests__/hooks/useStatisticsSnapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the service
vi.mock('../../services/statisticsSnapshotService', () => ({
    getSnapshotList: vi.fn(),
    getSnapshot: vi.fn(),
    createSnapshot: vi.fn(),
}));

// Mock the auth context
vi.mock('../../contexts/AuthProvider', () => ({
    useAuth: vi.fn(),
}));

import { getSnapshotList, getSnapshot, createSnapshot } from '../../services/statisticsSnapshotService';
import { useAuth } from '../../contexts/AuthProvider';
import { getFirstDayOfMonth, getPreviousMonth } from '../../hooks/useStatisticsSnapshot';

describe('useStatisticsSnapshot helpers', () => {
    it('getFirstDayOfMonth returns first day of current month in ISO format', () => {
        const result = getFirstDayOfMonth(new Date('2026-03-15'));
        expect(result).toBe('2026-03-01');
    });

    it('getPreviousMonth returns first day of previous month', () => {
        const result = getPreviousMonth('2026-03-01');
        expect(result).toBe('2026-02-01');
    });

    it('getPreviousMonth handles January correctly', () => {
        const result = getPreviousMonth('2026-01-01');
        expect(result).toBe('2025-12-01');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/__tests__/hooks/useStatisticsSnapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

```typescript
// src/hooks/useStatisticsSnapshot.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import {
    getSnapshotList,
    getSnapshot,
    createSnapshot,
} from '../services/statisticsSnapshotService';
import {
    StatisticsSnapshot,
    SnapshotListItem,
} from '../types/statisticsSnapshot';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { EngineeringStat } from '../types/stats';
import { calculateShipStatistics } from '../utils/statistics/shipsStats';
import { calculateGearStatistics } from '../utils/statistics/gearStats';
import { calculateImplantStatistics } from '../utils/statistics/implantsStats';
import { calculateEngineeringStatistics } from '../utils/statistics/engineeringStats';

export function getFirstDayOfMonth(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
}

export function getPreviousMonth(monthStr: string): string {
    const date = new Date(monthStr + 'T00:00:00');
    date.setMonth(date.getMonth() - 1);
    return getFirstDayOfMonth(date);
}

interface UseStatisticsSnapshotParams {
    ships: Ship[];
    gear: GearPiece[];
    implants: GearPiece[];
    engineeringStats: EngineeringStat[];
    allContextsLoaded: boolean; // true only when ALL contexts (ships, inventory, engineering) are done loading
}

interface UseStatisticsSnapshotReturn {
    snapshots: SnapshotListItem[];
    selectedSnapshot: StatisticsSnapshot | null;
    selectedMonth: string | null;
    setSelectedMonth: (month: string | null) => void;
    loading: boolean;
}

export function useStatisticsSnapshot({
    ships,
    gear,
    implants,
    engineeringStats,
    allContextsLoaded,
}: UseStatisticsSnapshotParams): UseStatisticsSnapshotReturn {
    const { user } = useAuth();
    const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
    const [selectedSnapshot, setSelectedSnapshot] = useState<StatisticsSnapshot | null>(null);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const snapshotCreatedRef = useRef(false);

    const currentMonth = getFirstDayOfMonth(new Date());
    const previousMonth = getPreviousMonth(currentMonth);

    // Load snapshot list and auto-create current month snapshot
    useEffect(() => {
        if (!user?.id || !allContextsLoaded) return;

        const init = async () => {
            setLoading(true);

            // Fetch existing snapshots
            const list = await getSnapshotList(user.id);
            setSnapshots(list);

            // Auto-create current month snapshot if missing and user has data
            const hasCurrentMonth = list.some((s) => s.snapshotMonth === currentMonth);
            if (
                !hasCurrentMonth &&
                !snapshotCreatedRef.current &&
                (ships.length > 0 || gear.length > 0)
            ) {
                snapshotCreatedRef.current = true;
                const shipsStats = calculateShipStatistics(ships);
                const gearStats = calculateGearStatistics(gear, ships);
                const implantsStats = calculateImplantStatistics(implants, ships);
                const engStats = calculateEngineeringStatistics(engineeringStats);

                await createSnapshot(user.id, currentMonth, {
                    shipsStats,
                    gearStats,
                    implantsStats,
                    engineeringStats: engStats,
                });

                // Refresh list
                const updatedList = await getSnapshotList(user.id);
                setSnapshots(updatedList);
            }

            // Auto-select previous month if available (use latest list after possible refresh)
            const finalList = snapshotCreatedRef.current
                ? await getSnapshotList(user.id)
                : list;
            setSnapshots(finalList);
            const hasPreviousMonth = finalList.some(
                (s) => s.snapshotMonth === previousMonth
            );
            if (hasPreviousMonth) {
                setSelectedMonth(previousMonth);
            }

            setLoading(false);
        };

        init();
    }, [user?.id, allContextsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load selected snapshot data
    useEffect(() => {
        if (!user?.id || !selectedMonth) {
            setSelectedSnapshot(null);
            return;
        }

        const loadSnapshot = async () => {
            setLoading(true);
            const snapshot = await getSnapshot(user.id, selectedMonth);
            setSelectedSnapshot(snapshot);
            setLoading(false);
        };

        loadSnapshot();
    }, [user?.id, selectedMonth]);

    return {
        snapshots,
        selectedSnapshot,
        selectedMonth,
        setSelectedMonth,
        loading,
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/__tests__/hooks/useStatisticsSnapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStatisticsSnapshot.ts src/__tests__/hooks/useStatisticsSnapshot.test.ts
git commit -m "feat: add useStatisticsSnapshot hook"
```

---

### Task 6: SnapshotSelector Component

**Files:**
- Create: `src/components/statistics/SnapshotSelector.tsx`

- [ ] **Step 1: Create the SnapshotSelector component**

Uses the existing `Select` component from `src/components/ui/`.

```typescript
// src/components/statistics/SnapshotSelector.tsx
import React from 'react';
import { Select } from '../ui';
import { SnapshotListItem } from '../../types/statisticsSnapshot';

interface SnapshotSelectorProps {
    snapshots: SnapshotListItem[];
    selectedMonth: string | null;
    onChange: (month: string | null) => void;
    loading: boolean;
}

function formatMonth(isoDate: string): string {
    const date = new Date(isoDate + 'T12:00:00'); // noon to avoid timezone edge cases
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

export const SnapshotSelector: React.FC<SnapshotSelectorProps> = ({
    snapshots,
    selectedMonth,
    onChange,
    loading,
}) => {
    if (snapshots.length === 0 && !loading) {
        return (
            <div className="text-sm text-theme-text-secondary">
                Snapshots are saved automatically each month. Check back next month to compare
                your progress.
            </div>
        );
    }

    // Filter out current month — comparing against it always shows zero deltas
    const currentMonth = new Date();
    const currentMonthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const options = [
        { value: 'none', label: 'No comparison' },
        ...snapshots
            .filter((s) => s.snapshotMonth !== currentMonthStr)
            .map((s) => ({
                value: s.snapshotMonth,
                label: formatMonth(s.snapshotMonth),
            })),
    ];

    return (
        <div className="flex items-center gap-3">
            <label className="text-sm text-theme-text-secondary whitespace-nowrap">
                Compare with:
            </label>
            <Select
                value={selectedMonth || 'none'}
                onChange={(val) => onChange(val === 'none' ? null : val)}
                options={options}
                disabled={loading}
            />
        </div>
    );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/statistics/SnapshotSelector.tsx
git commit -m "feat: add SnapshotSelector component"
```

---

### Task 7: Wire Up StatisticsPage

**Files:**
- Modify: `src/pages/manager/StatisticsPage.tsx`

- [ ] **Step 1: Integrate hook and pass snapshot data to tabs**

Update `StatisticsPage.tsx` to:
1. Import and call `useStatisticsSnapshot`
2. Render `SnapshotSelector` between the title and tabs
3. Pass the relevant snapshot section to each tab component

```typescript
// Updated StatisticsPage.tsx
import React, { useState, useMemo } from 'react';
import { PageLayout, Tabs } from '../../components/ui';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../contexts/EngineeringStatsProvider';
import { ShipsStatsTab } from '../../components/statistics/ShipsStatsTab';
import { GearStatsTab } from '../../components/statistics/GearStatsTab';
import { ImplantsStatsTab } from '../../components/statistics/ImplantsStatsTab';
import { EngineeringStatsTab } from '../../components/statistics/EngineeringStatsTab';
import { SnapshotSelector } from '../../components/statistics/SnapshotSelector';
import { useStatisticsSnapshot } from '../../hooks/useStatisticsSnapshot';
import { Link } from 'react-router-dom';

export const StatisticsPage: React.FC = () => {
    const { ships, loading: shipsLoading } = useShips();
    const { inventory: gear, loading: gearLoading } = useInventory();
    const { engineeringStats, loading: engineeringLoading } = useEngineeringStats();
    const [activeTab, setActiveTab] = useState('ships');

    const gearOnly = useMemo(() => {
        return gear.filter((piece) => !piece.slot.startsWith('implant_'));
    }, [gear]);

    const implantsOnly = useMemo(() => {
        return gear.filter((piece) => piece.slot.startsWith('implant_'));
    }, [gear]);

    const hasData = ships.length > 0 || gear.length > 0;
    const allContextsLoaded = !shipsLoading && !gearLoading && !engineeringLoading;

    const {
        snapshots,
        selectedSnapshot,
        selectedMonth,
        setSelectedMonth,
        loading: snapshotLoading,
    } = useStatisticsSnapshot({
        ships,
        gear: gearOnly,
        implants: implantsOnly,
        engineeringStats: engineeringStats.stats,
        allContextsLoaded,
    });

    if (!hasData) {
        return (
            <PageLayout title="Statistics" description="View statistics about your fleet and gear">
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="text-theme-text-secondary text-lg mb-4">
                        No data available. Import your game data to see statistics.
                    </div>
                    <Link
                        to="/"
                        className="px-6 py-3 bg-primary text-white hover:bg-primary-dark transition-colors"
                    >
                        Upload Game File
                    </Link>
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout
            title="Statistics"
            description="Detailed statistics about your ships, gear, and engineering"
        >
            <div className="space-y-6">
                {/* Snapshot Selector */}
                <SnapshotSelector
                    snapshots={snapshots}
                    selectedMonth={selectedMonth}
                    onChange={setSelectedMonth}
                    loading={snapshotLoading}
                />

                {/* Tabs */}
                <Tabs
                    tabs={[
                        { id: 'ships', label: `Ships (${ships.length})` },
                        { id: 'gear', label: `Gear (${gearOnly.length})` },
                        { id: 'implants', label: `Implants (${implantsOnly.length})` },
                        { id: 'engineering', label: 'Engineering' },
                    ]}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                />

                {/* Tab Content */}
                {activeTab === 'ships' && (
                    <ShipsStatsTab
                        ships={ships}
                        previousStats={selectedSnapshot?.shipsStats ?? undefined}
                    />
                )}
                {activeTab === 'gear' && (
                    <GearStatsTab
                        gear={gear}
                        ships={ships}
                        previousStats={selectedSnapshot?.gearStats ?? undefined}
                    />
                )}
                {activeTab === 'implants' && (
                    <ImplantsStatsTab
                        gear={gear}
                        ships={ships}
                        previousStats={selectedSnapshot?.implantsStats ?? undefined}
                    />
                )}
                {activeTab === 'engineering' && (
                    <EngineeringStatsTab
                        engineeringStats={engineeringStats.stats}
                        previousStats={selectedSnapshot?.engineeringStats ?? undefined}
                    />
                )}
            </div>
        </PageLayout>
    );
};

export default StatisticsPage;
```

- [ ] **Step 2: Verify the dev server compiles without errors**

Run: `npm run lint`
Expected: no errors (tabs don't accept `previousStats` yet — that's next task, so expect type errors until Task 8)

- [ ] **Step 3: Commit**

```bash
git add src/pages/manager/StatisticsPage.tsx
git commit -m "feat: wire snapshot hook and selector into StatisticsPage"
```

---

### Task 8: Update ShipsStatsTab with Comparison

**Files:**
- Modify: `src/components/statistics/ShipsStatsTab.tsx`

- [ ] **Step 1: Add previousStats prop and delta indicators to StatCards**

Update the props interface to accept `previousStats?: ShipsSnapshot`. Pass `previousValue` to each StatCard using the snapshot data. For charts, when `previousStats` is present, add a second `<Bar>` series for grouped comparison.

Key changes:
1. Props: add `previousStats?: ShipsSnapshot`
2. Each numeric StatCard gets `previousValue={previousStats?.fieldName}`
3. Bar charts: add second `<Bar dataKey="previous">` when snapshot available
4. Pie chart (rarity): convert to grouped bar chart when comparing
5. Prepare merged chart data that combines current + previous distributions

The pattern for merging chart data (used across all tabs):

```typescript
// Merge current and previous distribution data for grouped bar chart.
// Callers should pre-map their data to { name: string; value: number }[] format.
function mergeDistributions(
    current: { name: string; value: number }[],
    previous: { name: string; value: number }[] | undefined
): { name: string; current: number; previous: number }[] {
    const merged = new Map<string, { current: number; previous: number }>();

    current.forEach((item) => {
        merged.set(item.name, { current: item.value, previous: 0 });
    });

    previous?.forEach((item) => {
        const existing = merged.get(item.name);
        if (existing) {
            existing.previous = item.value;
        } else {
            merged.set(item.name, { current: 0, previous: item.value });
        }
    });

    return Array.from(merged.entries()).map(([name, values]) => ({
        name,
        ...values,
    }));
}
```

Extract this helper into a shared utility at `src/utils/statistics/mergeDistributions.ts` so all four tabs can import it.

For the rarity pie chart, when `previousStats` is present, render a grouped `<BarChart>` instead of `<PieChart>`. When no comparison, keep the existing pie chart.

The muted color for "previous" bars: use opacity 0.4 of the current bar color, e.g., `fill="#3b82f6"` for current and `fill="#3b82f666"` for previous.

- [ ] **Step 2: Verify the dev server renders correctly**

Run: visit Statistics > Ships tab in browser. Verify:
- StatCards render as before when no snapshot selected
- When a snapshot is selected via dropdown, delta badges appear
- Charts show grouped bars when comparing

- [ ] **Step 3: Commit**

```bash
git add src/components/statistics/ShipsStatsTab.tsx
git commit -m "feat: add comparison UI to ShipsStatsTab"
```

---

### Task 9: Update GearStatsTab with Comparison

**Files:**
- Modify: `src/components/statistics/GearStatsTab.tsx`

- [ ] **Step 1: Add previousStats prop and comparison rendering**

Same pattern as Task 8:
1. Props: add `previousStats?: GearSnapshot`
2. StatCards get `previousValue` from snapshot (numeric cards only — not "most common set/main stat" string cards)
3. Bar charts get grouped comparison bars
4. Pie chart (rarity) converts to grouped bar when comparing

StatCard mappings:
- Total Gear: `previousStats.total`
- Equipped %: `previousStats.equippedPercentage`
- Avg Level: `previousStats.averageLevel`
- Avg Stars: `previousStats.averageStarLevel`
- Max Level: `previousStats.maxLevelCount`
- Max Level %: `previousStats.maxLevelPercentage`
- Most Common Set: no `previousValue` (string, not numeric)
- Most Common Main Stat: no `previousValue` (string, not numeric)

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add src/components/statistics/GearStatsTab.tsx
git commit -m "feat: add comparison UI to GearStatsTab"
```

---

### Task 10: Update ImplantsStatsTab with Comparison

**Files:**
- Modify: `src/components/statistics/ImplantsStatsTab.tsx`

- [ ] **Step 1: Add previousStats prop and comparison rendering**

Same pattern:
1. Props: add `previousStats?: ImplantsSnapshot`
2. StatCards: `previousValue` for total, equippedPercentage, typesAvailable (use `previousStats.byType.length`)
3. Charts: grouped comparison bars
4. Rarity pie → grouped bar when comparing

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add src/components/statistics/ImplantsStatsTab.tsx
git commit -m "feat: add comparison UI to ImplantsStatsTab"
```

---

### Task 11: Update EngineeringStatsTab with Comparison

**Files:**
- Modify: `src/components/statistics/EngineeringStatsTab.tsx`

- [ ] **Step 1: Add previousStats prop and comparison rendering**

1. Props: add `previousStats?: EngineeringSnapshot`
2. StatCards: `previousValue` for totalPoints, averagePointsPerRole
3. Points by role chart: grouped comparison bars
4. Stacked stat-type chart: add previous data as a second group

Note: "Most invested role" and "Roles with zero investment" StatCards use string/array values — no `previousValue` for these.

- [ ] **Step 2: Verify in browser**

- [ ] **Step 3: Commit**

```bash
git add src/components/statistics/EngineeringStatsTab.tsx
git commit -m "feat: add comparison UI to EngineeringStatsTab"
```

---

### Task 12: Final Integration Test & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --run`
Expected: all tests pass

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: 0 warnings, 0 errors

- [ ] **Step 3: Manual QA checklist**

Verify in browser:
- [ ] Statistics page loads normally without auth (no snapshot UI)
- [ ] When logged in, snapshot is auto-created on first visit
- [ ] Dropdown shows available months
- [ ] Selecting a month shows delta badges on StatCards
- [ ] Delta colors are correct (green for improvement, red for regression)
- [ ] Charts show grouped bars when comparing
- [ ] Pie charts convert to bar charts when comparing, revert when "None" selected
- [ ] Selecting "No comparison" hides all comparison UI
- [ ] Page still works when no snapshots exist (empty state message)

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: final cleanup for statistics snapshots"
```
