# Starred Ships & Gear Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ship starring and persistent gear alerts so users never forget when important ships are missing equipment after autogear runs.

**Architecture:** Two features built on a single `starred` boolean on the Ship type. Feature 1: star toggle UI + persistent alert panel at app layout level. Feature 2: post-equip suggestion list on the autogear page combining donor ships with starred ships missing gear.

**Tech Stack:** React 18, TypeScript, TailwindCSS, Supabase, React Router

**Spec:** `docs/superpowers/specs/2026-04-13-starred-ships-gear-alerts-design.md`

---

## File Structure

**New files:**
- `src/components/ui/icons/StarIcon.tsx` — filled star SVG icon
- `src/components/ui/icons/StarOutlineIcon.tsx` — outline star SVG icon
- `src/components/starred/StarredShipAlerts.tsx` — persistent alert panel component
- `src/components/starred/StarToggleButton.tsx` — reusable star toggle button
- `src/components/autogear/GearSuggestionTargets.tsx` — post-equip suggestion list
- `src/utils/ship/missingGear.ts` — utility to check if a ship has empty gear/implant slots
- `src/utils/ship/__tests__/missingGear.test.ts` — tests for missing gear utility
- `supabase/migrations/20260413000001_add_starred_to_ships.sql` — database migration

**Modified files:**
- `src/types/ship.ts` — add `starred?: boolean` to Ship interface
- `src/components/ui/icons/index.tsx` — export new star icons
- `src/contexts/ShipsContext.tsx` — add `toggleStarred` function, update RawShipData, transform, create/update calls
- `src/utils/migratePlayerData.ts` — preserve `starred` state during data reimport
- `src/components/ship/shipDisplayComponents.tsx` — add `StarToggleButton` next to `LockEquipmentButton`
- `src/components/ship/ShipDisplay.tsx` — pass star toggle props
- `src/components/ship/ShipDisplayImage.tsx` — pass star toggle props
- `src/components/ship/ShipCard.tsx` — pass star toggle props
- `src/components/autogear/GearSuggestions.tsx` — add star toggle next to lock button
- `src/components/autogear/AutogearQuickSettings.tsx` — add star toggle next to ship info/settings buttons
- `src/pages/manager/AutogearPage.tsx` — integrate post-equip suggestion list, preserve gearMovements
- `src/App.tsx` — render `StarredShipAlerts` component

---

### Task 1: Missing Gear Utility

**Files:**
- Create: `src/utils/ship/missingGear.ts`
- Create: `src/utils/ship/__tests__/missingGear.test.ts`

- [ ] **Step 1: Write failing tests for `getEmptySlotCount` and `hasEmptySlots`**

```typescript
// src/utils/ship/__tests__/missingGear.test.ts
import { describe, it, expect } from 'vitest';
import { getEmptySlotCount, hasEmptySlots } from '../missingGear';
import { Ship } from '../../../../types/ship';

const makeShip = (overrides: Partial<Ship> = {}): Ship => ({
    id: 'test-ship',
    name: 'Test Ship',
    rarity: 'legendary',
    faction: 'terran',
    type: 'attacker',
    baseStats: { hp: 100, attack: 50, defence: 30, hacking: 10, security: 10, speed: 20, crit: 5, critDamage: 50 },
    equipment: {},
    implants: {},
    refits: [],
    ...overrides,
});

describe('getEmptySlotCount', () => {
    it('returns 11 for a ship with no equipment or implants', () => {
        expect(getEmptySlotCount(makeShip())).toBe(11);
    });

    it('returns 0 for a fully equipped ship', () => {
        const ship = makeShip({
            equipment: {
                weapon: 'g1', hull: 'g2', generator: 'g3',
                sensor: 'g4', software: 'g5', thrusters: 'g6',
            },
            implants: {
                implant_minor_alpha: 'i1', implant_minor_gamma: 'i2',
                implant_minor_sigma: 'i3', implant_major: 'i4', implant_ultimate: 'i5',
            },
        });
        expect(getEmptySlotCount(ship)).toBe(0);
    });

    it('counts only empty gear slots (not filled ones)', () => {
        const ship = makeShip({
            equipment: { weapon: 'g1', hull: 'g2' },
            implants: { implant_major: 'i1' },
        });
        // 4 empty gear + 4 empty implant = 8
        expect(getEmptySlotCount(ship)).toBe(8);
    });

    it('treats falsy values as empty', () => {
        const ship = makeShip({
            equipment: { weapon: '', hull: 'g2' },
        });
        // weapon is falsy so still empty: 5 empty gear + 5 empty implant = 10
        expect(getEmptySlotCount(ship)).toBe(10);
    });
});

describe('hasEmptySlots', () => {
    it('returns true for a ship with empty slots', () => {
        expect(hasEmptySlots(makeShip())).toBe(true);
    });

    it('returns false for a fully equipped ship', () => {
        const ship = makeShip({
            equipment: {
                weapon: 'g1', hull: 'g2', generator: 'g3',
                sensor: 'g4', software: 'g5', thrusters: 'g6',
            },
            implants: {
                implant_minor_alpha: 'i1', implant_minor_gamma: 'i2',
                implant_minor_sigma: 'i3', implant_major: 'i4', implant_ultimate: 'i5',
            },
        });
        expect(hasEmptySlots(ship)).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/utils/ship/__tests__/missingGear.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the utility**

```typescript
// src/utils/ship/missingGear.ts
import { Ship } from '../../types/ship';
import { GEAR_SLOTS, IMPLANT_SLOTS } from '../../constants/gearTypes';

const ALL_GEAR_SLOT_KEYS = Object.keys(GEAR_SLOTS);
const ALL_IMPLANT_SLOT_KEYS = Object.keys(IMPLANT_SLOTS);

export const getEmptySlotCount = (ship: Ship): number => {
    let empty = 0;
    for (const slot of ALL_GEAR_SLOT_KEYS) {
        if (!ship.equipment[slot]) empty++;
    }
    for (const slot of ALL_IMPLANT_SLOT_KEYS) {
        if (!ship.implants[slot]) empty++;
    }
    return empty;
};

export const hasEmptySlots = (ship: Ship): boolean => {
    return getEmptySlotCount(ship) > 0;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/utils/ship/__tests__/missingGear.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/utils/ship/missingGear.ts src/utils/ship/__tests__/missingGear.test.ts
git commit -m "feat: add missing gear slot utility functions"
```

---

### Task 2: Data Model — Ship Type + Supabase Migration

**Files:**
- Modify: `src/types/ship.ts:18` — add `starred` field after `equipmentLocked`
- Create: `supabase/migrations/20260413000001_add_starred_to_ships.sql`

- [ ] **Step 1: Add `starred` to Ship interface**

In `src/types/ship.ts`, add after line 18 (`equipmentLocked?: boolean;`):

```typescript
    starred?: boolean;
```

- [ ] **Step 2: Create Supabase migration**

```sql
-- supabase/migrations/20260413000001_add_starred_to_ships.sql
-- Add starred column to ships table for marking important ships
ALTER TABLE ships ADD COLUMN starred boolean DEFAULT false;

-- Rollback: ALTER TABLE ships DROP COLUMN starred;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/ship.ts supabase/migrations/20260413000001_add_starred_to_ships.sql
git commit -m "feat: add starred field to Ship type and database"
```

---

### Task 3: ShipsContext — toggleStarred + Persistence

**Files:**
- Modify: `src/contexts/ShipsContext.tsx`
  - Interface `ShipsContextType` (~line 15): add `toggleStarred`
  - Interface `RawShipData` (~line 94): add `starred`
  - `transformShipData` (~line 227): map `starred`
  - `addShip` (~line 411): include `starred` in insert
  - `updateShip` (~line 519): include `starred` in update
  - After `toggleEquipmentLock` (~line 1028): add `toggleStarred` function
  - Context value (~line 1040): add `toggleStarred`
- Modify: `src/utils/migratePlayerData.ts` — preserve `starred` during reimport

- [ ] **Step 1: Add `toggleStarred` to `ShipsContextType` interface**

In `src/contexts/ShipsContext.tsx`, after line 35 (`toggleEquipmentLock: (shipId: string) => Promise<void>;`):

```typescript
    toggleStarred: (shipId: string) => Promise<void>;
```

- [ ] **Step 2: Add `starred` to `RawShipData` interface**

After line 94 (`equipment_locked: boolean;`):

```typescript
    starred: boolean;
```

- [ ] **Step 3: Map `starred` in `transformShipData`**

After line 227 (`equipmentLocked: data.equipment_locked || false,`):

```typescript
            starred: data.starred || false,
```

- [ ] **Step 4: Include `starred` in `addShip` insert**

After line 418 (`equipment_locked: newShip.equipmentLocked,`):

```typescript
                    starred: newShip.starred,
```

- [ ] **Step 5: Include `starred` in `updateShip`**

After line 525 (`equipment_locked: updates.equipmentLocked,`):

```typescript
                        starred: updates.starred,
```

- [ ] **Step 6: Add `toggleStarred` function**

After `toggleEquipmentLock` (after line 1028), add:

```typescript
    const toggleStarred = useCallback(
        async (shipId: string) => {
            const ship = localShips.find((s) => s.id === shipId);
            if (!ship) throw new Error('Ship not found');

            const newStarred = !ship.starred;

            // Optimistic update
            const updatedShips = localShips.map((s) =>
                s.id === shipId ? { ...s, starred: newStarred } : s
            );
            setLocalShips(updatedShips);
            void setStorageShips(updatedShips);

            if (!user?.id) return;

            try {
                const { error } = await supabase
                    .from('ships')
                    .update({ starred: newStarred })
                    .eq('id', shipId)
                    .eq('user_id', user.id);

                if (error) throw error;
            } catch (error) {
                await loadShips();
                console.error('Error updating starred state:', error);
                addNotification('error', 'Failed to update starred state');
                throw error;
            }
        },
        [user?.id, loadShips, addNotification, localShips, setStorageShips]
    );
```

- [ ] **Step 7: Add `toggleStarred` to context value**

In the context value object (after `toggleEquipmentLock,` around line 1057):

```typescript
                toggleStarred,
```

- [ ] **Step 8: Preserve `starred` in migratePlayerData**

In `src/utils/migratePlayerData.ts`:

1. Update the select query at line 353 to include `starred`:
   ```typescript
   .select('id, equipment_locked, starred, type')
   ```

2. Update the map at line 359 to include `starred`:
   ```typescript
   { equipmentLocked: ship.equipment_locked, starred: ship.starred, type: ship.type },
   ```

3. Add `starred` to the ship records at line 392 (after `equipment_locked`):
   ```typescript
   starred:
       existingShipsMap.get(ship.id)?.starred ?? ship.starred,
   ```

- [ ] **Step 9: Run tests to verify nothing breaks**

Run: `npm test -- --run`
Expected: All existing tests pass

- [ ] **Step 10: Commit**

```bash
git add src/contexts/ShipsContext.tsx src/utils/migratePlayerData.ts
git commit -m "feat: add toggleStarred to ShipsContext with Supabase persistence"
```

---

### Task 4: Star Icons

**Files:**
- Create: `src/components/ui/icons/StarIcon.tsx`
- Create: `src/components/ui/icons/StarOutlineIcon.tsx`
- Modify: `src/components/ui/icons/index.tsx` — add exports

- [ ] **Step 1: Create filled StarIcon**

```typescript
// src/components/ui/icons/StarIcon.tsx
import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const StarIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 ${className}`}
            viewBox="0 0 24 24"
            fill="currentColor"
            role="img"
            aria-hidden="true"
            {...props}
        >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
    );
};
```

- [ ] **Step 2: Create outline StarOutlineIcon**

```typescript
// src/components/ui/icons/StarOutlineIcon.tsx
import React, { ComponentPropsWithoutRef } from 'react';

type IconProps = ComponentPropsWithoutRef<'svg'> & {
    className?: string;
};

export const StarOutlineIcon: React.FC<IconProps> = ({ className = '', ...props }) => {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 ${className}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-hidden="true"
            {...props}
        >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
    );
};
```

- [ ] **Step 3: Export from index**

Add to `src/components/ui/icons/index.tsx`:

```typescript
export * from './StarIcon';
export * from './StarOutlineIcon';
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/icons/StarIcon.tsx src/components/ui/icons/StarOutlineIcon.tsx src/components/ui/icons/index.tsx
git commit -m "feat: add star and star outline icons"
```

---

### Task 5: StarToggleButton Component

**Files:**
- Create: `src/components/starred/StarToggleButton.tsx`

- [ ] **Step 1: Create the reusable star toggle button**

```typescript
// src/components/starred/StarToggleButton.tsx
import React from 'react';
import { Button } from '../ui';
import { StarIcon, StarOutlineIcon } from '../ui/icons';
import { Ship } from '../../types/ship';

interface StarToggleButtonProps {
    ship: Ship;
    onToggleStarred: (shipId: string) => Promise<void>;
    size?: 'xs' | 'sm' | 'md' | 'lg';
}

export const StarToggleButton: React.FC<StarToggleButtonProps> = ({
    ship,
    onToggleStarred,
    size = 'sm',
}) => (
    <Button
        variant="secondary"
        size={size}
        title={ship.starred ? 'Unstar ship' : 'Star ship'}
        onClick={(e) => {
            e.stopPropagation();
            void (async () => {
                try {
                    await onToggleStarred(ship.id);
                } catch (error) {
                    console.error('Failed to update starred state:', error);
                }
            })();
        }}
    >
        {ship.starred ? (
            <StarIcon className="text-yellow-400" />
        ) : (
            <StarOutlineIcon />
        )}
    </Button>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/starred/StarToggleButton.tsx
git commit -m "feat: add reusable StarToggleButton component"
```

---

### Task 6: Star Toggle in Ship Cards

**Files:**
- Modify: `src/components/ship/shipDisplayComponents.tsx` — add star toggle props to `ShipDisplayProps`
- Modify: `src/components/ship/ShipDisplay.tsx` — render `StarToggleButton` next to `LockEquipmentButton`
- Modify: `src/components/ship/ShipDisplayImage.tsx` — render `StarToggleButton` (same pattern)
- Modify: `src/components/ship/ShipCard.tsx` — pass `onToggleStarred` prop through
- Modify: `src/pages/manager/ShipsPage.tsx` or wherever `ShipCard` is rendered — pass `toggleStarred` from context

- [ ] **Step 1: Add `onToggleStarred` to `ShipDisplayProps` in `shipDisplayComponents.tsx`**

Find the `ShipDisplayProps` interface and add:

```typescript
    onToggleStarred?: (shipId: string) => Promise<void>;
```

- [ ] **Step 2: Add `StarToggleButton` to `ShipDisplay.tsx`**

Import `StarToggleButton`:
```typescript
import { StarToggleButton } from './../../components/starred/StarToggleButton';
```

In the header area where `LockEquipmentButton` is rendered (around line 124), add the star toggle right before the lock button:

```typescript
{onToggleStarred && (
    <StarToggleButton
        ship={ship}
        onToggleStarred={onToggleStarred}
    />
)}
```

Destructure `onToggleStarred` from the component props.

- [ ] **Step 3: Add `StarToggleButton` to `ShipDisplayImage.tsx`**

Follow the same pattern as `ShipDisplay.tsx` — destructure `onToggleStarred` from props, render `StarToggleButton` next to the lock button.

- [ ] **Step 4: Pass `onToggleStarred` through `ShipCard.tsx`**

Add `onToggleStarred?: (shipId: string) => Promise<void>;` to the ShipCard `Props` interface.

Pass it to `ShipDisplayComponent`:
```typescript
<ShipDisplayComponent
    ship={ship}
    onEdit={onEdit}
    onRemove={onRemove}
    onLockEquipment={onLockEquipment}
    onToggleStarred={onToggleStarred}
    ...
```

- [ ] **Step 5: Pass `toggleStarred` from the ships page**

Find where `ShipCard` components are rendered (likely in `ShipsPage.tsx` or similar) and pass `toggleStarred` from `useShips()` context:

```typescript
const { toggleStarred } = useShips();
// ...
<ShipCard onToggleStarred={toggleStarred} ... />
```

- [ ] **Step 6: Verify in browser**

Run: `npm start`
Navigate to Ships page, verify star icon appears on ship cards next to the lock icon. Click it — should toggle between filled/outline star.

- [ ] **Step 7: Commit**

```bash
git add src/components/ship/shipDisplayComponents.tsx src/components/ship/ShipDisplay.tsx src/components/ship/ShipDisplayImage.tsx src/components/ship/ShipCard.tsx
git add -u  # catch the page file that passes the prop
git commit -m "feat: add star toggle to ship cards"
```

---

### Task 7: Star Toggle in Autogear UI

**Files:**
- Modify: `src/components/autogear/GearSuggestions.tsx` — add star button next to lock button
- Modify: `src/components/autogear/AutogearQuickSettings.tsx` — add star button next to ship action buttons
- Modify: `src/pages/manager/AutogearPage.tsx` — pass `toggleStarred` to both components

- [ ] **Step 1: Add star toggle to `GearSuggestions.tsx`**

Add to the `GearSuggestionsProps` interface:
```typescript
    onToggleStarred?: (shipId: string) => Promise<void>;
```

Destructure `onToggleStarred` from props. Import `StarToggleButton`:
```typescript
import { StarToggleButton } from '../starred/StarToggleButton';
```

In the button row (line ~271, after the lock button block), add:
```typescript
{onToggleStarred && ship && (
    <StarToggleButton
        ship={ship}
        onToggleStarred={onToggleStarred}
    />
)}
```

- [ ] **Step 2: Add star toggle to `AutogearQuickSettings.tsx`**

Add to `AutogearQuickSettingsProps`:
```typescript
    onToggleStarred?: (shipId: string) => Promise<void>;
```

Destructure `onToggleStarred` from props. Import `StarToggleButton`:
```typescript
import { StarToggleButton } from '../starred/StarToggleButton';
```

In the button row for each selected ship (around line 86, in the `<div className="flex gap-2 items-center">` after the info and settings buttons), add before the remove button:

```typescript
{ship && onToggleStarred && (
    <StarToggleButton
        ship={ship}
        onToggleStarred={onToggleStarred}
    />
)}
```

- [ ] **Step 3: Pass `toggleStarred` from `AutogearPage.tsx`**

In `AutogearPage.tsx`, destructure `toggleStarred` from `useShips()`.

Pass to `AutogearQuickSettings`:
```typescript
<AutogearQuickSettings
    ...
    onToggleStarred={toggleStarred}
/>
```

Pass to `GearSuggestions`:
```typescript
<GearSuggestions
    ...
    onToggleStarred={toggleStarred}
/>
```

- [ ] **Step 4: Verify in browser**

Navigate to Autogear page. Select a ship — star icon should appear next to the settings gear icon and next to the lock icon in suggestions.

- [ ] **Step 5: Commit**

```bash
git add src/components/autogear/GearSuggestions.tsx src/components/autogear/AutogearQuickSettings.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat: add star toggle to autogear ship selector and suggestions"
```

---

### Task 8: Persistent Alert Panel

**Files:**
- Create: `src/components/starred/StarredShipAlerts.tsx`
- Modify: `src/App.tsx` — render alert panel

- [ ] **Step 1: Create the `StarredShipAlerts` component**

```typescript
// src/components/starred/StarredShipAlerts.tsx
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShips } from '../../contexts/ShipsContext';
import { getEmptySlotCount } from '../../utils/ship/missingGear';
import { StarIcon } from '../ui/icons';
import { Button } from '../ui';
import { ChevronRightIcon } from '../ui/icons';

const STORAGE_KEY = 'starred_alerts_minimized';

export const StarredShipAlerts: React.FC = () => {
    const { ships } = useShips();
    const navigate = useNavigate();
    const [minimized, setMinimized] = useState(() => {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    });

    const alertShips = useMemo(() => {
        return ships
            .filter((ship) => ship.starred)
            .map((ship) => ({
                ship,
                emptySlots: getEmptySlotCount(ship),
            }))
            .filter((entry) => entry.emptySlots > 0);
    }, [ships]);

    if (alertShips.length === 0) return null;

    const handleToggleMinimize = () => {
        const newValue = !minimized;
        setMinimized(newValue);
        localStorage.setItem(STORAGE_KEY, String(newValue));
    };

    const handleNavigateToShip = (shipId: string) => {
        navigate(`/autogear?shipId=${shipId}`);
    };

    if (minimized) {
        return (
            <button
                onClick={handleToggleMinimize}
                className="fixed bottom-4 right-4 z-40 bg-dark border border-dark-border rounded-lg p-2 flex items-center gap-1.5 hover:bg-dark-lighter transition-colors cursor-pointer"
                title={`${alertShips.length} starred ship${alertShips.length !== 1 ? 's' : ''} missing gear`}
            >
                <StarIcon className="text-yellow-400 h-4 w-4" />
                <span className="text-sm font-medium text-theme-text">{alertShips.length}</span>
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-40 w-72 sm:w-80 bg-dark border border-dark-border rounded-lg shadow-lg max-h-64 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border">
                <div className="flex items-center gap-1.5">
                    <StarIcon className="text-yellow-400 h-4 w-4" />
                    <span className="text-sm font-medium text-theme-text">
                        Missing Gear ({alertShips.length})
                    </span>
                </div>
                <button
                    onClick={handleToggleMinimize}
                    className="text-theme-text-secondary hover:text-theme-text p-1"
                    title="Minimize"
                >
                    <ChevronRightIcon className="h-4 w-4" />
                </button>
            </div>
            <div className="overflow-y-auto flex-1">
                {alertShips.map(({ ship, emptySlots }) => (
                    <button
                        key={ship.id}
                        onClick={() => handleNavigateToShip(ship.id)}
                        className="w-full text-left px-3 py-2 hover:bg-dark-lighter transition-colors flex justify-between items-center cursor-pointer"
                    >
                        <span className="text-sm text-theme-text truncate">{ship.name}</span>
                        <span className="text-xs text-theme-text-secondary ml-2 whitespace-nowrap">
                            {emptySlots} empty
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
};
```

Note: `ChevronRightIcon` should already exist in the icons. If not, use a simple `>` character or check the `ChevronIcons` export. The implementer should verify what's available in `src/components/ui/icons/ChevronIcons.tsx` and use the appropriate right-pointing chevron.

- [ ] **Step 2: Add `StarredShipAlerts` to `App.tsx`**

In `src/App.tsx`, import the component:
```typescript
import { StarredShipAlerts } from './components/starred/StarredShipAlerts';
```

Add it right after `<NotificationContainer />` (line 327):
```typescript
<StarredShipAlerts />
```

This places it inside the `ShipsProvider` context (it needs access to `useShips()`), and also inside `Router` (it needs `useNavigate()`).

- [ ] **Step 3: Verify in browser**

1. Star a ship that has empty gear slots → alert panel should appear bottom-right
2. Click minimize → collapses to small badge with count
3. Click badge → expands again
4. Click a ship name → navigates to autogear with that ship pre-selected
5. Fill all slots on a starred ship → it should disappear from the panel
6. When no starred ships have empty slots → panel disappears entirely

- [ ] **Step 4: Commit**

```bash
git add src/components/starred/StarredShipAlerts.tsx src/App.tsx
git commit -m "feat: add persistent starred ship alert panel"
```

---

### Task 9: Post-Equip Suggestion List

**Files:**
- Create: `src/components/autogear/GearSuggestionTargets.tsx`
- Modify: `src/pages/manager/AutogearPage.tsx` — integrate post-equip suggestions

- [ ] **Step 1: Create the `GearSuggestionTargets` component**

```typescript
// src/components/autogear/GearSuggestionTargets.tsx
import React from 'react';
import { Ship } from '../../types/ship';
import { Button } from '../ui';
import { CloseIcon, StarIcon } from '../ui/icons';

export interface GearSuggestionTarget {
    ship: Ship;
    emptySlotCount: number;
    isDonor: boolean;
}

interface GearSuggestionTargetsProps {
    targets: GearSuggestionTarget[];
    onSelectShip: (ship: Ship) => void;
    onDismiss: () => void;
}

export const GearSuggestionTargets: React.FC<GearSuggestionTargetsProps> = ({
    targets,
    onSelectShip,
    onDismiss,
}) => {
    if (targets.length === 0) return null;

    return (
        <div className="card space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-theme-text">
                    Ships needing gear
                </h4>
                <button
                    onClick={onDismiss}
                    className="text-theme-text-secondary hover:text-theme-text p-1"
                    title="Dismiss"
                >
                    <CloseIcon className="h-4 w-4" />
                </button>
            </div>
            <div className="space-y-2">
                {targets.map(({ ship, emptySlotCount, isDonor }) => (
                    <div
                        key={ship.id}
                        className="flex items-center justify-between gap-2 p-2 bg-dark-lighter rounded"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            {ship.starred && (
                                <StarIcon className="text-yellow-400 h-3.5 w-3.5 flex-shrink-0" />
                            )}
                            <span className="text-sm text-theme-text truncate">{ship.name}</span>
                            <span className="text-xs text-theme-text-secondary whitespace-nowrap">
                                {emptySlotCount} empty
                            </span>
                            {isDonor && (
                                <span className="text-xs text-yellow-500 whitespace-nowrap">
                                    (donor)
                                </span>
                            )}
                        </div>
                        <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => onSelectShip(ship)}
                        >
                            Select
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
};
```

- [ ] **Step 2: Add state and imports to `AutogearPage.tsx`**

Add state for suggestion targets:
```typescript
const [suggestionTargets, setSuggestionTargets] = useState<GearSuggestionTarget[]>([]);
```

Import the new component and types:
```typescript
import { GearSuggestionTargets, GearSuggestionTarget } from '../../components/autogear/GearSuggestionTargets';
import { getEmptySlotCount, hasEmptySlots } from '../../utils/ship/missingGear';
```

- [ ] **Step 3: Capture donor ship IDs BEFORE equipping**

**Critical:** After `equipMultipleGear` runs, gear `shipId` values are already updated, so you cannot identify donor ships after the fact. Capture them before equipping.

In `handleEquipSuggestionsForShip` (line 627), the `gearMovements` array is already computed before equipping. Store the unique donor ship IDs in a ref or pass them to `applyGearSuggestionsForShip`.

Add state to hold pending donor ship IDs:
```typescript
const [pendingDonorShipIds, setPendingDonorShipIds] = useState<Set<string>>(new Set());
```

In `handleEquipSuggestionsForShip`, after building `gearMovements` (line 650) and before showing the confirm modal, capture donor ship IDs:
```typescript
const donorIds = new Set(gearMovements.map((m) => m.fromShip.id));
setPendingDonorShipIds(donorIds);
```

Also handle the no-movement path (line 670-671 where it calls `applyGearSuggestionsForShip` directly):
```typescript
} else {
    setPendingDonorShipIds(new Set());
    void applyGearSuggestionsForShip(shipId);
}
```

- [ ] **Step 4: Build suggestion targets after equipping**

In `applyGearSuggestionsForShip` (around line 675), after the success notification (line 711), build suggestion targets using the pre-captured donor IDs:

```typescript
// Build post-equip suggestion targets from pre-captured donor ship IDs
const targets: GearSuggestionTarget[] = [];

// Add donor ships (IDs captured before equipping)
pendingDonorShipIds.forEach((donorId) => {
    if (donorId === shipId) return; // skip the ship we just equipped
    const donorShip = getShipById(donorId);
    if (donorShip) {
        const emptyCount = getEmptySlotCount(donorShip);
        if (emptyCount > 0) {
            targets.push({ ship: donorShip, emptySlotCount: emptyCount, isDonor: true });
        }
    }
});

// Add starred ships with missing gear (excluding the just-equipped ship and already-listed donors)
ships.forEach((s) => {
    if (s.starred && s.id !== shipId && !pendingDonorShipIds.has(s.id) && hasEmptySlots(s)) {
        targets.push({ ship: s, emptySlotCount: getEmptySlotCount(s), isDonor: false });
    }
});

setSuggestionTargets(targets);
setPendingDonorShipIds(new Set());
```

Note: `getShipById` at this point returns data from the `localShips` array which has already been optimistically updated by `equipMultipleGear`, so `getEmptySlotCount` will reflect the gear removal from donor ships.

- [ ] **Step 5: Clear suggestion targets on new autogear run**

In the `handleAutogear` function (wherever `setShipResults({})` is called), add immediately after:
```typescript
setSuggestionTargets([]);
```

- [ ] **Step 6: Add the selection handler and render the component**

Add a handler for selecting a ship from the suggestion list:
```typescript
const handleSelectSuggestionTarget = (ship: Ship) => {
    handleShipSelect(ship, 0); // Replace the first selected ship
};
```

Render the component after the gear suggestions area (around line 860, after the `shipResults` mapping):

```typescript
{suggestionTargets.length > 0 && (
    <GearSuggestionTargets
        targets={suggestionTargets}
        onSelectShip={handleSelectSuggestionTarget}
        onDismiss={() => setSuggestionTargets([])}
    />
)}
```

- [ ] **Step 7: Verify in browser**

1. Select a ship in autogear, run optimization
2. Click "Equip All Suggestions" on a ship that pulls gear from others
3. After equipping, the suggestion list should appear showing donor ships and starred ships with missing gear
4. Click "Select" on a donor ship — it becomes the new autogear target
5. Click "Dismiss" — list disappears
6. Start a new autogear run — list clears

- [ ] **Step 8: Commit**

```bash
git add src/components/autogear/GearSuggestionTargets.tsx src/pages/manager/AutogearPage.tsx
git commit -m "feat: add post-equip suggestion list for donor and starred ships"
```

---

### Task 10: Final Verification & Lint

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --run`
Expected: All tests pass

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors (max-warnings: 0)

- [ ] **Step 3: Fix any lint issues**

Run: `npm run lint:fix` if needed, then verify with `npm run lint`

- [ ] **Step 4: End-to-end browser verification**

1. **Star toggle:** Star a ship from Ships page, Autogear ship selector, and Autogear suggestions. Verify filled/outline star toggles correctly and persists on refresh.
2. **Alert panel:** Star a ship with missing gear → panel appears. Minimize → badge shows. Fill all slots → panel disappears. Star a fully geared ship → no alert.
3. **Post-equip suggestions:** Run autogear that takes gear from other ships. After equipping, verify donor ships and starred ships with missing gear appear in the suggestion list. Click "Select" → ship becomes autogear target with saved config loaded.
4. **No regressions:** Equipment lock still works. Autogear still runs correctly. Notifications still appear.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -u
git commit -m "chore: lint fixes and final cleanup"
```
