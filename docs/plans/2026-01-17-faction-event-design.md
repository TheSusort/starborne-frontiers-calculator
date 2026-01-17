# Faction Event Feature Design

## Overview

Add support for faction events in the recruitment calculator where ships from a specified faction have 20x the pull weight in specialist beacons.

## Requirements

- **Mechanic:** 19 extra copies of each faction ship added to pool (20x total weight)
- **Scope:** Specialist beacons only
- **Affinity:** Ignored during faction events - all ships of a rarity compete in one weighted pool
- **Rarities:** All (rare, epic, legendary)
- **Exclusivity:** Mutually exclusive with individual event ships
- **UI:** Separate section with toggle + faction dropdown

## Data Model

### New Interface

```typescript
export interface FactionEvent {
    faction: FactionName;  // from existing constants
    multiplier?: number;   // defaults to 20 if not specified
}
```

### Updated Function Signatures

```typescript
export const calculateShipProbability = (
    ship: Ship,
    beaconType: BeaconType,
    ships: Ship[],
    eventShips: EventShip[] = [],
    factionEvent?: FactionEvent  // new optional parameter
): number => { ... }
```

Same pattern applies to `calculateRecruitmentResults` and other public functions.

### Mutual Exclusivity

Enforced at UI layer - when faction event is enabled, event ships section is disabled/cleared, and vice versa.

## Calculation Logic

When a faction event is active for specialist beacons:

1. Get the rarity rate as normal (89% rare, 10% epic, 1.5% legendary)
2. Skip affinity splitting entirely
3. Calculate weighted pool for that rarity:
   - Count faction ships of that rarity → multiply by 20
   - Count non-faction ships of that rarity → multiply by 1
   - Total weighted pool = (faction_count × 20) + (non_faction_count × 1)
4. Ship probability = `rarityRate × shipWeight / totalWeightedPool`
   - Faction ship: `rarityRate × 20 / totalWeightedPool`
   - Non-faction ship: `rarityRate × 1 / totalWeightedPool`

### Example

5 legendary ships total, 2 from Tianchao faction:
- Weighted pool = (2 × 20) + (3 × 1) = 43
- Tianchao ship probability = 0.01515 × 20 / 43 ≈ 0.70% each
- Other ship probability = 0.01515 × 1 / 43 ≈ 0.035% each

Compare to normal (with affinity split of 30%):
- If 2 ships share an affinity: 0.01515 × 0.30 / 2 ≈ 0.23% each

## Functions to Modify

### Primary Changes in `recruitmentCalculator.ts`

1. **`calculateShipProbability`** - Add faction event branch:
   - If `factionEvent` is set AND `beaconType === 'specialist'`:
     - Skip affinity logic
     - Use weighted pool calculation
   - Otherwise: existing logic unchanged

2. **`calculateMultipleShipsProbability`** - Pass through `factionEvent` parameter

3. **`calculateRecruitmentResults`** - Accept and pass through `factionEvent`

### New Helper Function

```typescript
const calculateWeightedPool = (
    ships: Ship[],
    rarity: RarityName,
    factionEvent: FactionEvent
): { totalWeight: number; shipWeights: Map<string, number> }
```

### Unchanged Functions

- `getBeaconRates`
- `getRecruitableShips` / `getGeneralPoolShips`
- `getAffinityRate` (still exists but bypassed during faction events)
- `calculateExpectedPulls` (works with probability input)
- `calculatePullsForConfidence` (works with probability input)
- `calculateProbabilityWithPulls` (works with probability input)

## UI Design

### Event Configuration Section

```
┌─ Event Configuration ─────────────────────────┐
│                                               │
│  ○ Individual Event Ships                     │
│  ● Faction Event                              │
│                                               │
│  ┌─ Faction Event Settings ─────────────────┐ │
│  │  Faction: [Tianchao        ▼]            │ │
│  │  Boost:   20x (default)                  │ │
│  └──────────────────────────────────────────┘ │
│                                               │
└───────────────────────────────────────────────┘
```

### Behavior

- Radio buttons to switch between "Individual Event Ships" and "Faction Event"
- When "Faction Event" selected, show faction dropdown
- When switching modes, clear the other mode's configuration
- Faction dropdown uses existing `FACTIONS` constant

### State Shape

```typescript
const [eventMode, setEventMode] = useState<'individual' | 'faction'>('individual');
const [eventShips, setEventShips] = useState<EventShip[]>([]);
const [factionEvent, setFactionEvent] = useState<FactionEvent | undefined>();
```

## Testing

### Unit Tests

1. **Basic faction event probability:**
   - Faction ship gets 20x weight
   - Non-faction ship gets 1x weight
   - Probabilities sum correctly within each rarity

2. **Faction event only affects specialist beacons:**
   - Public/expert/elite beacons unchanged when faction event is set

3. **Affinity is ignored during faction events:**
   - Antimatter faction ships don't get the usual 10% affinity penalty
   - All ships of same rarity compete in single pool

4. **Custom multiplier:**
   - Test with multiplier other than 20

5. **Edge cases:**
   - Faction with no ships of a certain rarity
   - All ships in pool are from the boosted faction
   - Non-recruitable ships still excluded from pool

### Manual QA

- Toggle between individual/faction event modes
- Verify results table updates correctly
- Check that faction dropdown shows all 10 factions
