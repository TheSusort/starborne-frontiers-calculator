# Engineering Preview Upgrade Feature

## Overview

Add a "Preview Upgrade" tab to the Engineering page that lets users see how the next engineering level would affect a selected ship's stats and role score.

## User Flow

1. User navigates to Engineering page → Preview Upgrade tab
2. Selects a ship using ShipSelector
3. Selects a role (including subtypes like Debuffer_Bomber)
4. Sees 4 radio buttons for the base role's engineering stats
5. Clicks a stat to see: new stats with changes, role score delta, upgrade cost
6. Can toggle between stats to compare which upgrade provides best value

## Component Structure

```
EngineeringStatsPage (existing)
├── Tab: "Engineering Stats" (existing content)
└── Tab: "Preview Upgrade" (new)
    └── EngineeringPreviewTab
        ├── ShipSelector (existing component)
        ├── RoleSelector (new reusable component)
        ├── EngineeringStatRadioGroup (4 radio buttons)
        └── PreviewPanel
            ├── StatList (with comparisonStats)
            ├── RoleScoreDisplay (current → new with delta)
            └── UpgradeCost display
```

## New Files

1. `src/components/ui/RoleSelector.tsx` - Reusable role dropdown
2. `src/components/engineering/EngineeringPreviewTab.tsx` - Main preview tab
3. `src/constants/engineeringStats.ts` - Stats per role + cost table

## Engineering Stats by Role

| Role | Stats |
|------|-------|
| Supporter | hacking, hp, security, defence |
| Attacker | hacking, defence, critDamage, attack |
| Debuffer | attack, security, hp, hacking |
| Defender | defence, hp, hacking, security |

## Stat Increments per Level

- Percentage stats (hp, defence, attack, critDamage): +1% per level
- Flat stats (hacking, security): +2 per level

## Upgrade Cost Table (Cumulative)

```
Level 0:  0       Level 10: 5,900    Level 20: 147,200
Level 1:  100     Level 11: 8,400
Level 2:  250     Level 12: 11,600
Level 3:  450     Level 13: 16,000
Level 4:  700     Level 14: 22,000
Level 5:  1,050   Level 15: 30,200
Level 6:  1,500   Level 16: 42,200
Level 7:  2,100   Level 17: 57,200
Level 8:  3,000   Level 18: 77,200
Level 9:  4,200   Level 19: 107,200
```

Cost for next level = `cumulative[level+1] - cumulative[level]`

## RoleSelector Component

**Props:**
```typescript
interface RoleSelectorProps {
  value: ShipTypeName | null;
  onChange: (role: ShipTypeName) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}
```

**Options grouped by base role:**
- Attacker
- Defender → Defender (Security)
- Debuffer → Debuffer (Defensive), Debuffer (Defensive Security), Debuffer (Bomber), Debuffer (Corrosion)
- Supporter → Supporter (Buffer), Supporter (Offensive), Supporter (Shield)

## State Management

```typescript
// EngineeringPreviewTab state
const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
const [selectedRole, setSelectedRole] = useState<ShipTypeName | null>(null);
const [selectedStat, setSelectedStat] = useState<StatName | null>(null);
```

**Derived values (computed):**
- `baseRole` - Extract from selectedRole
- `engineeringStatsForRole` - Current engineering stats for base role
- `currentLevel` - Level of selectedStat from engineering stats
- `previewStats` - Ship stats with +1 level to selectedStat
- `currentScore` - Role score with current stats
- `previewScore` - Role score with preview stats
- `upgradeCost` - From cost table

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Ship Selector Button]     [Role Dropdown]             │
├─────────────────────────────────────────────────────────┤
│  ┌─ Select stat to preview upgrade ──────────────────┐  │
│  │  ○ Hacking (Level 5 → 6)           Cost: 450      │  │
│  │  ○ Defence (Level 3 → 4)           Cost: 250      │  │
│  │  ○ Crit Power (Level 8 → 9)        Cost: 1100     │  │
│  │  ○ Attack (Level 10 → 11)          Cost: 2500     │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Preview ─────────────────────────────────────────┐  │
│  │  Role Score: 12,450 → 12,892 (+442)               │  │
│  │                                                   │  │
│  │  HP          45,000                               │  │
│  │  Attack      5,150 (+50)                          │  │
│  │  ...etc (StatList with comparison)                │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Empty States

- No ship selected: "Select a ship to preview engineering upgrades"
- No role selected: "Select a role to see available upgrades"
- No engineering stats for role: "No engineering stats configured for [Role]. Add them in the Engineering Stats tab."

## Key Functions Used

- `calculateTotalStats()` - Get ship stats with engineering applied
- `calculatePriorityScore()` - Get role score (pass shipRole for role-specific scoring)
- `getEngineeringStatsForShipType()` - Get current engineering config
