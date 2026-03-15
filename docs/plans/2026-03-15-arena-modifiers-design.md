# Arena Season Modifiers

**Date:** 2026-03-15
**Status:** Draft

## Problem

PVP arena seasons apply temporary stat modifiers to ships based on conditions like faction, rarity, or role (e.g., "all epic defenders get +150% HP and +150% DEF"). These modifiers shift optimal gear choices, but autogear currently has no way to account for them. Users must manually reason about how arena modifiers change their builds.

## Solution

Admin-managed arena seasons with stackable modifier rules. Users opt-in per ship config in autogear. Modifiers are applied to total stats before scoring.

## Database Schema

### `arena_seasons`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | `gen_random_uuid()` |
| name | text, not null | e.g., "Season 12 - Tanky Epic" |
| active | boolean, default false | Only one active at a time |
| ends_at | timestamptz, null | When the season expires. Null = no expiry. Server resets at 01:00 UTC, so typical values are e.g., `2026-04-01T01:00:00Z` |
| created_at | timestamptz | `now()` |
| updated_at | timestamptz | `now()` |

### Auto-Expiry

A season is considered active when `active = true AND (ends_at IS NULL OR ends_at > now())`. The `getActiveSeason()` service function includes this check. When a season has expired, the UI treats it as inactive (checkbox hidden). No cron job needed — expiry is checked at read time.

### `arena_season_rules`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid, PK | `gen_random_uuid()` |
| season_id | uuid, FK → arena_seasons(id) ON DELETE CASCADE | Parent season |
| factions | text[] | Null/empty = all factions. Values: ATLAS_SYNDICATE, BINDERBURG, EVERLIVING, FRONTIER_LEGION, GELECEK, MPL, MARAUDERS, TERRAN_COMBINE, TIANCHAO, XAOC |
| rarities | text[] | Null/empty = all rarities. Values: common, uncommon, rare, epic, legendary |
| ship_types | text[] | Null/empty = all roles. Matches the autogear role, not ship's inherent type. Values: ATTACKER, DEFENDER, DEFENDER_SECURITY, DEBUFFER, DEBUFFER_DEFENSIVE, DEBUFFER_DEFENSIVE_SECURITY, DEBUFFER_BOMBER, DEBUFFER_CORROSION, SUPPORTER, SUPPORTER_BUFFER, SUPPORTER_OFFENSIVE, SUPPORTER_SHIELD |
| modifiers | jsonb, not null | Stat modifiers as percentages, e.g., `{"hp": 150, "defence": 150}`. Valid keys: hp, attack, defence, hacking, security, crit, critDamage, speed, healModifier, hpRegen, shield, defensePenetration, damageReduction |
| created_at | timestamptz | `now()` |

### RLS Policies

Both tables:
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- SELECT: `USING (true)` — public read for all users including anonymous
- INSERT/UPDATE/DELETE: authenticated users where `public.is_admin()` is true

### Season Activation

Atomic activation via a Supabase RPC function to avoid race conditions:

```sql
CREATE OR REPLACE FUNCTION activate_arena_season(season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE arena_seasons SET active = false, updated_at = now() WHERE active = true;
    UPDATE arena_seasons SET active = true, updated_at = now() WHERE id = season_id;
END;
$$;
```

A separate `deactivate_all_arena_seasons()` RPC for the "no active season" state.

### `updated_at` Trigger

```sql
CREATE TRIGGER update_arena_seasons_updated_at
    BEFORE UPDATE ON arena_seasons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

Uses the existing `update_updated_at_column()` function if available, otherwise creates one.

## Modifier Application

### Formula

For each stat with matching arena modifiers:
```
modifiedStat = totalStat * (1 + summedModifier / 100)
```

Example: Ship has 50,000 HP total. Arena modifier is +150% HP.
```
modifiedHP = 50000 * (1 + 150/100) = 50000 * 2.5 = 125,000
```

Negative modifiers are supported (e.g., `{"speed": -30}` → 70% speed).

### Rule Matching

A rule matches a ship if ALL of the following are true:
- `factions` is empty/null OR ship's faction is in the array
- `rarities` is empty/null OR ship's rarity is in the array
- `ship_types` is empty/null OR ship's assigned autogear role is in the array

### Stacking

All matching rules' modifiers are summed per stat before application:
```
Rule 1: All epic units → +50% HP
Rule 2: Epic defenders → +100% HP, +100% DEF
Ship: Epic faction-X defender
→ Summed: HP +150%, DEF +100%
→ modifiedHP = HP * 2.5, modifiedDEF = DEF * 2.0
```

### Where Applied

Arena modifier logic is extracted into a pure utility function for testability:

```typescript
// src/utils/autogear/arenaModifiers.ts
function matchesRule(rule, shipFaction, shipRarity, shipRole): boolean
function getMatchingModifiers(rules, shipFaction, shipRarity, shipRole): Record<string, number>
function applyArenaModifiers(stats, modifiers): BaseStats
```

In `calculateTotalScore()`, after `calculateTotalStats()` and before `calculatePriorityScore()`:

1. Check if arena modifiers are provided (non-null)
2. Apply `applyArenaModifiers(totalStats, precomputedModifiers)` to get modified stats
3. Pass modified stats to `calculatePriorityScore()`

The modifier matching (steps to find which rules apply to this ship) is done **once per ship** in AutogearPage before the optimization run, not per score calculation. Only the pre-computed summed modifiers `Record<string, number>` are passed into the scoring pipeline.

The modified stats are **only used for scoring** — they do not change displayed stats in the UI.

### Signature Changes

`calculateTotalScore()` gains an optional parameter:
```typescript
export function calculateTotalScore(
    ship: Ship,
    equipment: Partial<Record<GearSlotName, string>>,
    priorities: StatPriority[],
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined,
    shipRole?: ShipTypeName,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arenaModifiers?: Record<string, number> | null  // NEW — pre-computed summed modifiers
): number
```

All strategy files that call `calculateTotalScore` must pass through the new parameter.

### Cache Key

Append arena modifier state to the score cache key:
```
`${existingKey}|arena:${arenaModifiers ? JSON.stringify(arenaModifiers) : 'none'}`
```

Since modifiers don't change during an optimization run, this is constant per run.

## Service Layer

**File:** `src/services/arenaModifierService.ts`

### Public Functions
- `getActiveSeason(): Promise<ArenaSeason | null>` — fetch season where `active = true AND (ends_at IS NULL OR ends_at > now())`, with rules

### Admin Functions
- `getAllSeasons(): Promise<ArenaSeason[]>` — fetch all seasons with rules
- `createSeason(name: string): Promise<ArenaSeason | null>` — create new inactive season
- `updateSeason(id: string, name: string): Promise<void>` — update name
- `deleteSeason(id: string): Promise<void>` — delete season (cascades rules)
- `activateSeason(id: string): Promise<void>` — via RPC, atomic
- `deactivateAllSeasons(): Promise<void>` — via RPC, for "no active season" state
- `createRule(seasonId: string, rule: ArenaSeasonRuleInput): Promise<void>` — add rule to season
- `updateRule(id: string, rule: ArenaSeasonRuleInput): Promise<void>` — update rule
- `deleteRule(id: string): Promise<void>` — delete rule

## Types

**File:** `src/types/arena.ts`

```typescript
export interface ArenaSeason {
    id: string;
    name: string;
    active: boolean;
    ends_at: string | null;  // ISO timestamp, null = no expiry
    rules: ArenaSeasonRule[];
    created_at: string;
    updated_at: string;
}

export interface ArenaSeasonRule {
    id: string;
    season_id: string;
    factions: string[] | null;
    rarities: string[] | null;
    ship_types: string[] | null;
    modifiers: Record<string, number>;  // stat name → percentage
    created_at: string;
}

export interface ArenaSeasonRuleInput {
    factions: string[] | null;
    rarities: string[] | null;
    ship_types: string[] | null;
    modifiers: Record<string, number>;
}
```

## Admin Panel UI

### New "Arena" Tab

**Season List View:**
- Table showing all seasons: name, active status (toggle), end date, rule count, created date
- Expired seasons shown with a visual indicator (e.g., strikethrough or "Expired" badge)
- "Create Season" button opens inline form (name + end date + create button)
- Click season row to expand/view rules
- Delete button per season (with confirmation)
- "Deactivate All" button to clear active season

**Season Detail / Rules View:**
- Season name (editable)
- Active toggle
- List of rules, each showing:
  - Filter summary: "Epic Defenders from Eos" or "All units"
  - Modifier summary: "HP +150%, DEF +150%"
  - Edit/delete buttons
- "Add Rule" form:
  - Multi-select for factions (from FACTIONS constant)
  - Multi-select for rarities (from RARITIES constant)
  - Multi-select for ship types (from SHIP_TYPES constant)
  - Stat modifier pairs: stat select + percentage input, add multiple
  - Save button

## Autogear User-Facing UI

### Options Section

In `AutogearSettings.tsx`, add to the Options card:
```
<Checkbox
    id="useArenaModifiers"
    label="Apply arena modifiers"
    checked={useArenaModifiers}
    onChange={onUseArenaModifiersChange}
    helpLabel="Apply the active arena season's stat modifiers to scoring. Modifiers are applied to total stats before the autogear algorithm runs."
    disabled={!hasActiveSeason}
/>
```

When enabled and an active season exists, show a compact summary below the checkbox:
```
Arena: Season 12 - Tanky Epic (ends Apr 1)
  • All epic units: HP +50%
  • Epic defenders: HP +100%, DEF +100%
```

When no active season exists, the checkbox is hidden entirely. While loading the active season, the checkbox is also hidden (loading is fast, no spinner needed).

### Config Persistence

Add `useArenaModifiers?: boolean` to `SavedAutogearConfig` in `src/types/autogear.ts`. Defaults to `false`. Persisted per ship config like other autogear options.

## Files to Change

### New Files
- `supabase/migrations/YYYYMMDD_create_arena_seasons.sql` — schema, RLS, RPC functions, trigger
- `src/types/arena.ts` — type definitions
- `src/services/arenaModifierService.ts` — Supabase service layer
- `src/utils/autogear/arenaModifiers.ts` — pure utility: rule matching + modifier application
- `src/utils/autogear/__tests__/arenaModifiers.test.ts` — unit tests
- `src/components/admin/ArenaModifiersTab.tsx` — admin panel tab

### Modified Files
- `src/types/autogear.ts` — add `useArenaModifiers` to `SavedAutogearConfig`
- `src/utils/autogear/scoring.ts` — apply arena modifiers in `calculateTotalScore`, update cache key
- `src/pages/admin/AdminPanel.tsx` — add Arena tab
- `src/components/autogear/AutogearSettings.tsx` — add checkbox + season summary
- `src/pages/manager/AutogearPage.tsx` — fetch active season, compute matching modifiers per ship, pass to scoring
- `src/utils/autogear/strategies/GeneticStrategy.ts` — pass `arenaModifiers` through to `calculateTotalScore`

Note: Deprecated strategies (TwoPassStrategy, BeamSearchStrategy, SetFirstStrategy, BruteForceStrategy) do not need updating.

## Testing

- Unit test: `matchesRule()` — faction/rarity/role filters, empty = match all, partial matches
- Unit test: `getMatchingModifiers()` — multiple matching rules sum correctly, non-matching excluded
- Unit test: `applyArenaModifiers()` — formula `stat * (1 + mod/100)`, negative modifiers, no modifiers = unchanged stats
- Integration: autogear scoring with arena modifiers enabled vs disabled produces different results
