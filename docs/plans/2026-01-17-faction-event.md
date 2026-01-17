# Faction Event Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add faction event support to the recruitment calculator where ships from a specified faction have 20x pull weight in specialist beacons.

**Architecture:** Extend the existing `calculateShipProbability` function with an optional `factionEvent` parameter. When active, bypass affinity splitting and use weighted pool calculation. UI adds a mutually exclusive toggle between individual event ships and faction events.

**Tech Stack:** React, TypeScript, Vitest for testing

---

## Task 1: Add FactionEvent Interface and Export

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts:17-18` (after EventShip interface)

**Step 1: Add the FactionEvent interface**

Add after line 217 (after the `EventShip` interface):

```typescript
export interface FactionEvent {
    faction: FactionName;
    multiplier?: number; // Defaults to 20 if not specified
}
```

**Step 2: Add import for FactionName**

Modify the imports at the top of the file (line 1):

```typescript
import { Ship, AffinityName } from '../types/ship';
import { FactionName } from '../constants/factions';
```

**Step 3: Verify the file compiles**

Run: `npm run lint`
Expected: No errors related to FactionEvent

**Step 4: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): add FactionEvent interface"
```

---

## Task 2: Add Weighted Pool Helper Function

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts` (add helper function before calculateShipProbability)

**Step 1: Add the helper function**

Add before `calculateShipProbability` function (around line 220):

```typescript
/**
 * Calculate weighted pool for faction events
 * Faction ships get multiplier weight (default 20), non-faction ships get 1
 */
const calculateFactionEventPool = (
    ships: Ship[],
    rarity: RarityName,
    factionEvent: FactionEvent
): { totalWeight: number; getShipWeight: (ship: Ship) => number } => {
    const multiplier = factionEvent.multiplier ?? 20;
    const shipsOfRarity = ships.filter((s) => s.rarity === rarity);

    let totalWeight = 0;
    for (const ship of shipsOfRarity) {
        const weight = ship.faction === factionEvent.faction ? multiplier : 1;
        totalWeight += weight;
    }

    const getShipWeight = (ship: Ship): number => {
        return ship.faction === factionEvent.faction ? multiplier : 1;
    };

    return { totalWeight, getShipWeight };
};
```

**Step 2: Add RarityName import**

The file already imports from `../constants/rarities`, verify it includes `RarityName`.

**Step 3: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): add weighted pool helper for faction events"
```

---

## Task 3: Update calculateShipProbability Signature

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts:226-234`

**Step 1: Update function signature**

Change the function signature to add the optional factionEvent parameter:

```typescript
/**
 * Calculate the probability of getting a specific ship from a beacon
 * @param ship - The target ship
 * @param beaconType - Type of beacon
 * @param ships - All available ships
 * @param eventShips - Optional array of event ships with their rates (for specialist beacons)
 * @param factionEvent - Optional faction event (mutually exclusive with eventShips for specialist beacons)
 */
export const calculateShipProbability = (
    ship: Ship,
    beaconType: BeaconType,
    ships: Ship[],
    eventShips: EventShip[] = [],
    factionEvent?: FactionEvent
): number => {
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): add factionEvent param to calculateShipProbability"
```

---

## Task 4: Implement Faction Event Logic in calculateShipProbability

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts` (inside calculateShipProbability function)

**Step 1: Add faction event calculation branch**

Add after the event-only ship check (around line 258, after `if (rarityRate === 0) { return 0; }`):

```typescript
    // Handle faction event for specialist beacons
    if (factionEvent && beaconType === 'specialist') {
        // Use general pool ships (excludes non-recruitable and event-only ships)
        const generalPoolShips = getGeneralPoolShips(ships);
        const shipsOfRarity = generalPoolShips.filter((s) => s.rarity === ship.rarity);

        if (shipsOfRarity.length === 0) {
            return 0;
        }

        const { totalWeight, getShipWeight } = calculateFactionEventPool(
            generalPoolShips,
            ship.rarity,
            factionEvent
        );

        if (totalWeight === 0) {
            return 0;
        }

        // Probability = rarityRate * shipWeight / totalWeight
        const shipWeight = getShipWeight(ship);
        return (rarityRate * shipWeight) / totalWeight;
    }
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): implement faction event probability calculation"
```

---

## Task 5: Create Unit Tests for Faction Event Probability

**Files:**
- Create: `src/utils/__tests__/recruitmentCalculator.test.ts`

**Step 1: Create the test file with basic tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
    calculateShipProbability,
    getBeaconRates,
    FactionEvent,
} from '../recruitmentCalculator';
import { Ship } from '../../types/ship';

// Mock ships for testing
const createMockShip = (
    name: string,
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
    faction: string,
    affinity: 'chemical' | 'electric' | 'thermal' | 'antimatter' = 'chemical'
): Ship => ({
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    rarity,
    faction,
    type: 'attacker',
    affinity,
    baseStats: { hp: 1000, attack: 100, defence: 100, speed: 100, hacking: 100, security: 100 },
    equipment: {},
    implants: {},
    refits: [],
});

describe('recruitmentCalculator', () => {
    describe('calculateShipProbability with faction events', () => {
        const mockShips: Ship[] = [
            // Tianchao legendary ships
            createMockShip('Tianchao Ship 1', 'legendary', 'TIANCHAO', 'chemical'),
            createMockShip('Tianchao Ship 2', 'legendary', 'TIANCHAO', 'electric'),
            // Other faction legendary ships
            createMockShip('Other Ship 1', 'legendary', 'BINDERBURG', 'chemical'),
            createMockShip('Other Ship 2', 'legendary', 'GELECEK', 'thermal'),
            createMockShip('Other Ship 3', 'legendary', 'MARAUDERS', 'antimatter'),
        ];

        it('should give faction ships 20x weight during faction event', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];
            const otherShip = mockShips[2];

            const tianchaoProbability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );
            const otherProbability = calculateShipProbability(
                otherShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            // Tianchao ship should have 20x the probability of other ships
            expect(tianchaoProbability / otherProbability).toBeCloseTo(20, 1);
        });

        it('should only affect specialist beacons', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];

            // Expert beacon should not be affected by faction event
            const withFactionEvent = calculateShipProbability(
                tianchaoShip,
                'expert',
                mockShips,
                [],
                factionEvent
            );
            const withoutFactionEvent = calculateShipProbability(
                tianchaoShip,
                'expert',
                mockShips,
                []
            );

            expect(withFactionEvent).toBe(withoutFactionEvent);
        });

        it('should ignore affinity during faction events', () => {
            // Create ships with different affinities in same faction
            const shipsWithAffinities: Ship[] = [
                createMockShip('Faction A1', 'legendary', 'TIANCHAO', 'chemical'),
                createMockShip('Faction A2', 'legendary', 'TIANCHAO', 'antimatter'),
                createMockShip('Other B1', 'legendary', 'BINDERBURG', 'chemical'),
            ];

            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };

            // Both Tianchao ships should have equal probability regardless of affinity
            const chemicalProb = calculateShipProbability(
                shipsWithAffinities[0],
                'specialist',
                shipsWithAffinities,
                [],
                factionEvent
            );
            const antimatterProb = calculateShipProbability(
                shipsWithAffinities[1],
                'specialist',
                shipsWithAffinities,
                [],
                factionEvent
            );

            expect(chemicalProb).toBeCloseTo(antimatterProb, 10);
        });

        it('should support custom multiplier', () => {
            const factionEvent: FactionEvent = { faction: 'TIANCHAO', multiplier: 10 };
            const tianchaoShip = mockShips[0];
            const otherShip = mockShips[2];

            const tianchaoProbability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );
            const otherProbability = calculateShipProbability(
                otherShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            // Should use custom 10x multiplier
            expect(tianchaoProbability / otherProbability).toBeCloseTo(10, 1);
        });

        it('should calculate correct pool weights', () => {
            // 2 Tianchao ships * 20 = 40 weight
            // 3 other ships * 1 = 3 weight
            // Total = 43 weight
            // Legendary rate for specialist = 1/66 ≈ 0.01515

            const factionEvent: FactionEvent = { faction: 'TIANCHAO' };
            const tianchaoShip = mockShips[0];

            const probability = calculateShipProbability(
                tianchaoShip,
                'specialist',
                mockShips,
                [],
                factionEvent
            );

            const legendaryRate = 1 / 66;
            const expectedProbability = (legendaryRate * 20) / 43;

            expect(probability).toBeCloseTo(expectedProbability, 10);
        });
    });
});
```

**Step 2: Run the tests to verify they pass**

Run: `npm test src/utils/__tests__/recruitmentCalculator.test.ts`
Expected: All 5 tests pass

**Step 3: Commit**

```bash
git add src/utils/__tests__/recruitmentCalculator.test.ts
git commit -m "test(recruitment): add unit tests for faction event probability"
```

---

## Task 6: Update calculateMultipleShipsProbability

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts:339-359`

**Step 1: Update function signature and pass factionEvent**

```typescript
/**
 * Calculate probability of getting at least one of the target ships
 */
export const calculateMultipleShipsProbability = (
    targetShips: Ship[],
    beaconType: BeaconType,
    ships: Ship[],
    eventShips: EventShip[] = [],
    factionEvent?: FactionEvent
): number => {
    if (targetShips.length === 0) {
        return 0;
    }

    // Calculate probability of NOT getting any of the target ships
    let probabilityOfNotGettingAny = 1;

    for (const ship of targetShips) {
        const shipProbability = calculateShipProbability(ship, beaconType, ships, eventShips, factionEvent);
        probabilityOfNotGettingAny *= 1 - shipProbability;
    }

    // Probability of getting at least one = 1 - probability of getting none
    return 1 - probabilityOfNotGettingAny;
};
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): pass factionEvent to calculateMultipleShipsProbability"
```

---

## Task 7: Update calculateProbabilityOfAllShipsAfterPulls

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts:364-389`

**Step 1: Update function signature and pass factionEvent**

```typescript
/**
 * Calculate probability of having all target ships after N pulls
 */
export const calculateProbabilityOfAllShipsAfterPulls = (
    targetShips: Ship[],
    beaconType: BeaconType,
    ships: Ship[],
    numberOfPulls: number,
    eventShips: EventShip[] = [],
    factionEvent?: FactionEvent
): number => {
    if (targetShips.length === 0 || numberOfPulls === 0) {
        return 0;
    }

    // Probability of having all ships = product of (probability of having each ship)
    // P(having ship i in n pulls) = 1 - (1 - p_i)^n
    let probabilityOfHavingAll = 1;

    for (const ship of targetShips) {
        const shipProbability = calculateShipProbability(ship, beaconType, ships, eventShips, factionEvent);
        if (shipProbability === 0) {
            return 0; // If any ship is impossible, probability of having all is 0
        }
        const probabilityOfHavingThisShip = 1 - Math.pow(1 - shipProbability, numberOfPulls);
        probabilityOfHavingAll *= probabilityOfHavingThisShip;
    }

    return probabilityOfHavingAll;
};
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): pass factionEvent to calculateProbabilityOfAllShipsAfterPulls"
```

---

## Task 8: Update calculateRecruitmentResults

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts:637-700`

**Step 1: Update function signature and implementation**

```typescript
/**
 * Calculate recruitment results for all beacon types
 */
export const calculateRecruitmentResults = (
    targetShips: Ship[],
    ships: Ship[],
    eventShips: EventShip[] = [],
    mode: 'or' | 'and' = 'or',
    factionEvent?: FactionEvent
): RecruitmentResult[] => {
    const beaconTypes: BeaconType[] = ['public', 'specialist', 'expert', 'elite'];
    const targetShipNames = targetShips.map((s) => s.name);

    return beaconTypes.map((beaconType) => {
        // Only apply faction event to specialist beacons
        const activeFactionEvent = beaconType === 'specialist' ? factionEvent : undefined;

        // Probability per pull stays as OR (at least one) for both modes
        const probability = calculateMultipleShipsProbability(
            targetShips,
            beaconType,
            ships,
            eventShips,
            activeFactionEvent
        );

        // For AND mode, we need individual probabilities for each ship
        const individualProbabilities =
            mode === 'and'
                ? targetShips.map((ship) =>
                      calculateShipProbability(ship, beaconType, ships, eventShips, activeFactionEvent)
                  )
                : probability;

        // Event ships only affect specialist beacon calculations
        const expectedPulls = calculateExpectedPulls(
            mode === 'and' ? individualProbabilities : probability,
            beaconType,
            eventShips,
            targetShipNames,
            mode
        );
        const pullsFor90Percent = calculatePullsForConfidence(
            mode === 'and' ? individualProbabilities : probability,
            0.9,
            beaconType,
            eventShips,
            targetShipNames,
            mode,
            targetShips,
            ships
        );
        const pullsFor99Percent = calculatePullsForConfidence(
            mode === 'and' ? individualProbabilities : probability,
            0.99,
            beaconType,
            eventShips,
            targetShipNames,
            mode,
            targetShips,
            ships
        );

        return {
            beaconType,
            probability,
            expectedPulls,
            pullsFor90Percent,
            pullsFor99Percent,
        };
    });
};
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): pass factionEvent to calculateRecruitmentResults"
```

---

## Task 9: Export FactionEvent from recruitmentCalculator

**Files:**
- Modify: `src/utils/recruitmentCalculator.ts` (exports at top)

**Step 1: Verify FactionEvent is exported**

The interface should already be exported (we added `export interface FactionEvent`). Verify by checking the imports work in the page component later.

**Step 2: Run full lint check**

Run: `npm run lint`
Expected: No errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit if any changes needed**

```bash
git add src/utils/recruitmentCalculator.ts
git commit -m "feat(recruitment): ensure FactionEvent is exported"
```

---

## Task 10: Add UI State for Faction Event

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:13-25` (imports)
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:29-41` (state)

**Step 1: Update imports**

```typescript
import {
    calculateRecruitmentResults,
    getRecruitableShips,
    getNonRecruitableShips,
    BeaconType,
    EventShip,
    FactionEvent,
    calculateProbabilityWithPulls,
    calculateProbabilityOfAllShipsAfterPulls,
    groupShipsByRarity,
    getBeaconLabel,
    getBeaconDescription,
    getBeaconRarity,
} from '../../utils/recruitmentCalculator';
import { FACTIONS, FactionName } from '../../constants/factions';
```

**Step 2: Add state variables**

Add after the existing state declarations (around line 40):

```typescript
    const [eventMode, setEventMode] = useState<'individual' | 'faction'>('individual');
    const [factionEventFaction, setFactionEventFaction] = useState<FactionName | ''>('');
```

**Step 3: Add computed factionEvent**

Add after the eventShips useMemo (around line 81):

```typescript
    // Build faction event from state
    const factionEvent = useMemo<FactionEvent | undefined>(() => {
        if (eventMode !== 'faction' || !factionEventFaction) {
            return undefined;
        }
        return { faction: factionEventFaction };
    }, [eventMode, factionEventFaction]);
```

**Step 4: Verify the file compiles**

Run: `npm run lint`
Expected: No errors (may have unused variable warnings, that's OK)

**Step 5: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): add UI state for faction events"
```

---

## Task 11: Update Results Calculation to Use Faction Event

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:83-89` (results useMemo)

**Step 1: Update the results calculation**

```typescript
    // Calculate results
    const results = useMemo(() => {
        if (selectedShips.length === 0) {
            return [];
        }

        // Pass empty eventShips if faction event is active (mutually exclusive)
        const activeEventShips = eventMode === 'individual' ? eventShips : [];
        return calculateRecruitmentResults(selectedShips, allShips, activeEventShips, calculationMode, factionEvent);
    }, [selectedShips, allShips, eventShips, calculationMode, eventMode, factionEvent]);
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): use faction event in results calculation"
```

---

## Task 12: Add Event Mode Toggle UI

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:302-327` (inside CollapsibleAccordion)

**Step 1: Add event mode selector**

Replace the content inside `<CollapsibleAccordion isOpen={isEventSettingsOpen}>` starting at line 302:

```typescript
                        <CollapsibleAccordion isOpen={isEventSettingsOpen}>
                            <div className="space-y-6">
                                {/* Event Mode Toggle */}
                                <div className="flex items-center gap-4 mb-4">
                                    <span className="text-sm font-medium">Event Type:</span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant={eventMode === 'individual' ? 'primary' : 'secondary'}
                                            onClick={() => {
                                                setEventMode('individual');
                                                setFactionEventFaction('');
                                            }}
                                            size="sm"
                                        >
                                            Individual Ships
                                        </Button>
                                        <Button
                                            variant={eventMode === 'faction' ? 'primary' : 'secondary'}
                                            onClick={() => {
                                                setEventMode('faction');
                                                clearEventShips();
                                            }}
                                            size="sm"
                                        >
                                            Faction Event
                                        </Button>
                                    </div>
                                </div>

                                {/* Faction Event Settings */}
                                {eventMode === 'faction' && (
                                    <div className="bg-dark-lighter p-4 rounded-lg">
                                        <h3 className="text-lg font-semibold mb-2">Faction Event</h3>
                                        <p className="text-sm text-gray-400 mb-4">
                                            Ships from the selected faction have 20x the pull weight in
                                            the specialist beacon pool.
                                        </p>
                                        <div className="max-w-xs">
                                            <label className="block text-sm font-medium mb-2">
                                                Select Faction
                                            </label>
                                            <select
                                                className="w-full bg-dark border border-dark-border rounded px-3 py-2 text-white"
                                                value={factionEventFaction}
                                                onChange={(e) =>
                                                    setFactionEventFaction(e.target.value as FactionName)
                                                }
                                            >
                                                <option value="">-- Select Faction --</option>
                                                {Object.entries(FACTIONS).map(([key, faction]) => (
                                                    <option key={key} value={key}>
                                                        {faction.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        {factionEventFaction && (
                                            <p className="text-sm text-primary mt-4">
                                                {FACTIONS[factionEventFaction]?.name} ships will have 20x
                                                weight in specialist beacon pulls.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Individual Event Ship Selection (existing code) */}
                                {eventMode === 'individual' && (
                                    <>
                                        {/* Event Ship Selection */}
                                        <div>
                                            <h3 className="text-lg font-semibold mb-2">
                                                Event Ships (Epic & Legendary)
                                            </h3>
                                            <p className="text-sm text-gray-400 mb-4">
                                                Select ships for events. Each ship can have either a rate
                                                change or be guaranteed after a certain number of pulls
                                                (mutually exclusive).
                                            </p>

                                            {/* Event ships grouped by rarity (epic and legendary only) */}
                                            <ShipSelectionGrid
                                                ships={eventEligibleShips}
                                                selectedShipNames={eventShipNames}
                                                onToggleSelection={toggleEventShipSelection}
                                                shipsByRarity={eventShipsByRarity}
                                                rarities={['legendary', 'epic']}
                                                headingLevel="h4"
                                                headingSize="text-md"
                                                searchLabel="Search Event Ships"
                                                searchPlaceholder="Type to search epic and legendary ships..."
                                            />
                                        </div>

                                        {/* Event Ship Configuration */}
                                        {selectedEventShips.length > 0 && (
                                            <div>
                                                <h3 className="text-lg font-semibold mb-4">
                                                    Event Ship Configuration
                                                </h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {selectedEventShips.map((ship) => {
                                                        const rarityInfo = RARITIES[ship.rarity];
                                                        const hasRate =
                                                            eventShipRates[ship.name] !== undefined &&
                                                            eventShipRates[ship.name] > 0;
                                                        const hasThreshold =
                                                            eventShipThresholds[ship.name] !== undefined &&
                                                            eventShipThresholds[ship.name] > 0;

                                                        return (
                                                            <div key={ship.name} className="space-y-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span
                                                                        className={`font-semibold ${rarityInfo.textColor}`}
                                                                    >
                                                                        {ship.name}
                                                                    </span>
                                                                    <span className="text-sm text-gray-400">
                                                                        ({rarityInfo.label})
                                                                    </span>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <Input
                                                                        label="Rate Change (%)"
                                                                        type="number"
                                                                        min="0"
                                                                        max="100"
                                                                        value={
                                                                            eventShipRates[ship.name] || 0
                                                                        }
                                                                        onChange={(e) =>
                                                                            updateEventShipRate(
                                                                                ship.name,
                                                                                parseFloat(
                                                                                    e.target.value
                                                                                ) || 0
                                                                            )
                                                                        }
                                                                        disabled={hasThreshold}
                                                                        helpLabel={`Percentage chance that a ${ship.rarity} pull is ${ship.name} (usually 25% or 50%). Disabled if guaranteed threshold is set.`}
                                                                    />
                                                                    <Input
                                                                        label="Guaranteed After (Pulls)"
                                                                        type="number"
                                                                        min="1"
                                                                        value={
                                                                            eventShipThresholds[
                                                                                ship.name
                                                                            ] || 0
                                                                        }
                                                                        onChange={(e) =>
                                                                            updateEventShipThreshold(
                                                                                ship.name,
                                                                                parseInt(e.target.value) ||
                                                                                    0
                                                                            )
                                                                        }
                                                                        disabled={hasRate}
                                                                        helpLabel={`Number of specialist pulls needed to guarantee ${ship.name} (usually ${ship.rarity === 'legendary' ? '100-150' : '40'} pulls). Disabled if rate change is set.`}
                                                                    />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </CollapsibleAccordion>
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): add faction event toggle UI"
```

---

## Task 13: Update Beacon Inventory Results for Faction Events

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:562-654` (beacon inventory results section)

**Step 1: Update calculateProbabilityWithPulls and calculateProbabilityOfAllShipsAfterPulls calls**

In the results display section, update the probability calculations to pass the correct event data:

Find the section with `calculateProbabilityWithPulls` and `calculateProbabilityOfAllShipsAfterPulls` calls (around lines 580-610) and update:

```typescript
                                                            {calculationMode === 'or'
                                                                ? (
                                                                      calculateProbabilityWithPulls(
                                                                          result.probability,
                                                                          beaconInventory[
                                                                              result.beaconType
                                                                          ],
                                                                          result.beaconType,
                                                                          result.beaconType ===
                                                                              'specialist' && eventMode === 'individual'
                                                                              ? eventShips
                                                                              : [],
                                                                          selectedShips.map(
                                                                              (s) => s.name
                                                                          )
                                                                      ) * 100
                                                                  ).toFixed(2)
                                                                : (
                                                                      calculateProbabilityOfAllShipsAfterPulls(
                                                                          selectedShips,
                                                                          result.beaconType,
                                                                          allShips,
                                                                          beaconInventory[
                                                                              result.beaconType
                                                                          ],
                                                                          result.beaconType ===
                                                                              'specialist' && eventMode === 'individual'
                                                                              ? eventShips
                                                                              : [],
                                                                          result.beaconType === 'specialist'
                                                                              ? factionEvent
                                                                              : undefined
                                                                      ) * 100
                                                                  ).toFixed(2)}
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): update beacon inventory calculations for faction events"
```

---

## Task 14: Update Clear Event Ships Button Visibility

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:295-299`

**Step 1: Update button to show for faction events too**

Update the clear button in the header:

```typescript
                            {(eventShipNames.size > 0 || factionEventFaction) && (
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        clearEventShips();
                                        setFactionEventFaction('');
                                    }}
                                    size="sm"
                                >
                                    Clear Event Settings
                                </Button>
                            )}
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): update clear button for faction events"
```

---

## Task 15: Add Visual Indicator for Active Faction Event

**Files:**
- Modify: `src/pages/calculators/RecruitmentCalculatorPage.tsx:504` (results display)

**Step 1: Add faction event indicator in specialist beacon results**

In the results card for specialist beacon, add an indicator when faction event is active. Find the specialist beacon result card and add after the description:

```typescript
                                            {result.beaconType === 'specialist' &&
                                                factionEvent && (
                                                    <p className="text-sm text-primary mb-2">
                                                        Faction Event Active:{' '}
                                                        {FACTIONS[factionEvent.faction]?.name} (20x
                                                        boost)
                                                    </p>
                                                )}
```

**Step 2: Verify the file compiles**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/pages/calculators/RecruitmentCalculatorPage.tsx
git commit -m "feat(recruitment): add visual indicator for active faction event"
```

---

## Task 16: Run Full Test Suite and Manual Testing

**Files:**
- None (testing only)

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Start dev server and test manually**

Run: `npm start`

Manual test checklist:
- [ ] Toggle between Individual Ships and Faction Event modes
- [ ] Select a faction from dropdown
- [ ] Verify specialist beacon results change with faction event
- [ ] Verify other beacon types are unaffected
- [ ] Test switching back to individual mode clears faction
- [ ] Test with beacon inventory to see probabilities with pulls
- [ ] Verify clear button works for both modes

**Step 4: Commit any fixes if needed**

---

## Task 17: Update Documentation

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

**Step 1: Find the recruitment calculator section and add faction event documentation**

Search for existing recruitment calculator documentation and add:

```typescript
// In the relevant section about Recruitment Calculator:
<p>
    <strong>Faction Events:</strong> During faction events, ships from the
    selected faction have 20x the pull weight in specialist beacons. This
    bypasses the normal affinity split - all ships of the same rarity
    compete in a single weighted pool.
</p>
```

**Step 2: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: add faction event documentation"
```

---

## Summary

After completing all tasks, the faction event feature will:

1. Add `FactionEvent` interface with faction and optional multiplier
2. Extend `calculateShipProbability` to handle weighted pool calculation
3. Pass faction event through all calculation functions
4. Add UI toggle between individual event ships and faction events
5. Show faction dropdown when faction event mode is selected
6. Display active faction event indicator in results
7. Include unit tests for probability calculations
8. Update documentation

Total commits: ~15 small, focused commits
