import {
    CraftingMaterials,
    CraftingSuggestion,
    AutocraftPlan,
    AutocraftResult,
    CraftableSet,
    BoosterInventory,
    SubstatBooster,
    StarRarityDistribution,
} from '../../types/crafting';
import { GearSlotName, ShipTypeName } from '../../constants';
import { RarityName } from '../../constants/rarities';
import { SET_MATERIAL_REQUIREMENTS } from '../../constants/craftingProbabilities';
import { calculateCraftingProbabilities } from './probabilityCalculator';
import { CraftingInput, CraftingBoosters } from '../../types/crafting';
import { GEAR_SLOTS } from '../../constants/gearTypes';

// Crafting material requirements per item
const SLOT_ITEMS_PER_CRAFT = 25;
const SET_CORES_PER_CRAFT = 10;
const SET_MATERIALS_PER_CRAFT = 20;

interface MaterialInventory {
    slotItems: Record<GearSlotName, number>;
    setCores: Record<CraftableSet, Record<RarityName, number>>;
    setMaterials: {
        synth_alloy: Record<RarityName, number>;
        quantum_fiber: Record<RarityName, number>;
    };
    boosters: BoosterInventory;
}

/**
 * Creates a material inventory from CraftingMaterials (deep copy)
 */
function createMaterialInventory(materials: CraftingMaterials): MaterialInventory {
    return {
        slotItems: {
            weapon: materials.slotItems.weapon,
            hull: materials.slotItems.hull,
            generator: materials.slotItems.generator,
            sensor: materials.slotItems.sensor,
            software: materials.slotItems.software,
            thrusters: materials.slotItems.thrusters,
        },
        setCores: {
            omnicore: { ...materials.setCores.omnicore },
            swiftness: { ...materials.setCores.swiftness },
            recovery: { ...materials.setCores.recovery },
            exploit: { ...materials.setCores.exploit },
        },
        setMaterials: {
            synth_alloy: { ...materials.setMaterials.synth_alloy },
            quantum_fiber: { ...materials.setMaterials.quantum_fiber },
        },
        boosters: { ...materials.boosters },
    };
}

/**
 * Converts MaterialInventory back to CraftingMaterials format
 */
function inventoryToMaterials(inventory: MaterialInventory): CraftingMaterials {
    return {
        slotItems: {
            weapon: inventory.slotItems.weapon,
            hull: inventory.slotItems.hull,
            generator: inventory.slotItems.generator,
            sensor: inventory.slotItems.sensor,
            software: inventory.slotItems.software,
            thrusters: inventory.slotItems.thrusters,
        },
        setCores: {
            omnicore: { ...inventory.setCores.omnicore },
            swiftness: { ...inventory.setCores.swiftness },
            recovery: { ...inventory.setCores.recovery },
            exploit: { ...inventory.setCores.exploit },
        },
        setMaterials: {
            synth_alloy: { ...inventory.setMaterials.synth_alloy },
            quantum_fiber: { ...inventory.setMaterials.quantum_fiber },
        },
        boosters: { ...inventory.boosters },
    };
}

/**
 * Checks if we have enough materials for a craft
 */
function canCraft(
    inventory: MaterialInventory,
    slot: GearSlotName,
    set: CraftableSet,
    setCoreRarity: RarityName,
    setMaterialRarity: RarityName,
    useRankBooster: boolean,
    useRarityBooster: boolean,
    useSubstatBooster: SubstatBooster | undefined
): boolean {
    // Check slot item (need 25 per craft)
    if (inventory.slotItems[slot] < SLOT_ITEMS_PER_CRAFT) return false;

    // Check set core (need 10 per craft)
    if (inventory.setCores[set][setCoreRarity] < SET_CORES_PER_CRAFT) return false;

    // Check set material (need 20 per craft)
    const materialType = SET_MATERIAL_REQUIREMENTS[set];
    if (inventory.setMaterials[materialType][setMaterialRarity] < SET_MATERIALS_PER_CRAFT)
        return false;

    // Check boosters (need 1 per craft for each used)
    if (useRankBooster && inventory.boosters.rank < 1) return false;
    if (useRarityBooster && inventory.boosters.rarity < 1) return false;
    if (useSubstatBooster && inventory.boosters.substat[useSubstatBooster] < 1) return false;

    return true;
}

/**
 * Consumes materials for a craft
 */
function consumeMaterials(
    inventory: MaterialInventory,
    slot: GearSlotName,
    set: CraftableSet,
    setCoreRarity: RarityName,
    setMaterialRarity: RarityName,
    useRankBooster: boolean,
    useRarityBooster: boolean,
    useSubstatBooster: SubstatBooster | undefined
): void {
    inventory.slotItems[slot] -= SLOT_ITEMS_PER_CRAFT;
    inventory.setCores[set][setCoreRarity] -= SET_CORES_PER_CRAFT;
    const materialType = SET_MATERIAL_REQUIREMENTS[set];
    inventory.setMaterials[materialType][setMaterialRarity] -= SET_MATERIALS_PER_CRAFT;

    // Consume boosters (1 per craft for each used)
    if (useRankBooster) inventory.boosters.rank -= 1;
    if (useRarityBooster) inventory.boosters.rarity -= 1;
    if (useSubstatBooster) inventory.boosters.substat[useSubstatBooster] -= 1;
}

/**
 * Distributes materials across suggestions proportionally
 */
function distributeMaterials(
    materials: CraftingMaterials,
    suggestions: CraftingSuggestion[],
    selectedRoles: ShipTypeName[]
): AutocraftResult {
    const inventory = createMaterialInventory(materials);
    const plans: AutocraftPlan[] = [];
    const warnings: string[] = [];

    // Filter suggestions by selected roles
    const filteredSuggestions = suggestions.filter((s) =>
        selectedRoles.includes(s.role as ShipTypeName)
    );

    if (filteredSuggestions.length === 0) {
        warnings.push(
            'No suggestions available for selected roles. Crafting evenly across all slots and sets.'
        );
        // Fallback: craft evenly without suggestions
        return craftEvenly(inventory, warnings);
    }

    // Determine which boosters to use based on available inventory
    // Only use rank/rarity boosters for sensors/software/thrusters slots
    // Boosters are optional - we can craft without them
    const prioritySlots: GearSlotName[] = ['sensor', 'software', 'thrusters'];

    // Helper function to determine if we should use boosters for a slot
    const shouldUseBoosters = (slot: GearSlotName): { rank: boolean; rarity: boolean } => {
        if (!prioritySlots.includes(slot)) {
            return { rank: false, rarity: false };
        }
        return {
            rank: materials.boosters.rank > 0,
            rarity: materials.boosters.rarity > 0,
        };
    };

    // Calculate total priority for normalization
    const totalPriority = filteredSuggestions.reduce((sum, s) => sum + s.priority, 0);

    // Identify which sets are in suggestions (for small boost)
    const suggestedSets = new Set<CraftableSet>();
    filteredSuggestions.forEach((suggestion) => {
        suggestedSets.add(suggestion.suggestedSet);
    });

    // Set priority multiplier: suggested sets get 1.1x boost, others get 1.0x
    // This is a small boost to prioritize suggested sets while still spreading evenly
    const setPriorityMultiplier: Record<CraftableSet, number> = {
        omnicore: suggestedSets.has('omnicore') ? 1.1 : 1.0,
        swiftness: suggestedSets.has('swiftness') ? 1.1 : 1.0,
        recovery: suggestedSets.has('recovery') ? 1.1 : 1.0,
        exploit: suggestedSets.has('exploit') ? 1.1 : 1.0,
    };

    // Group suggestions by slot and set for better distribution
    const suggestionGroups = new Map<string, CraftingSuggestion[]>();
    filteredSuggestions.forEach((suggestion) => {
        const key = `${suggestion.slot}-${suggestion.suggestedSet}`;
        if (!suggestionGroups.has(key)) {
            suggestionGroups.set(key, []);
        }
        suggestionGroups.get(key)!.push(suggestion);
    });

    // Sort groups by average priority (highest first)
    const sortedGroups = Array.from(suggestionGroups.entries()).sort((a, b) => {
        const avgPriorityA = a[1].reduce((sum, s) => sum + s.priority, 0) / a[1].length;
        const avgPriorityB = b[1].reduce((sum, s) => sum + s.priority, 0) / b[1].length;
        return avgPriorityB - avgPriorityA;
    });

    // Distribute materials based on priority, but spread evenly across slots
    // Higher priority gets higher rarity materials, but we interleave by slot
    const rarityOrder: RarityName[] = ['legendary', 'epic', 'rare'];

    // Group craft options by slot, then sort by priority and rarity within each slot
    interface CraftOption {
        slot: GearSlotName;
        set: CraftableSet;
        setCoreRarity: RarityName;
        setMaterialRarity: RarityName;
        priority: number;
        rarityScore: number; // Higher for higher rarity combinations
    }

    // Group options by slot
    const optionsBySlot = new Map<GearSlotName, CraftOption[]>();

    // Generate all possible craft options for suggested slot/set combinations
    sortedGroups.forEach(([key, groupSuggestions]) => {
        const [slot, set] = key.split('-') as [GearSlotName, CraftableSet];
        const avgPriority =
            groupSuggestions.reduce((sum, s) => sum + s.priority, 0) / groupSuggestions.length;

        if (!optionsBySlot.has(slot)) {
            optionsBySlot.set(slot, []);
        }

        // Create options for all rarity combinations
        rarityOrder.forEach((setCoreRarity, coreIdx) => {
            rarityOrder.forEach((setMaterialRarity, matIdx) => {
                // Rarity score: higher rarity = higher score (legendary=2, epic=1, rare=0)
                const rarityScore =
                    rarityOrder.length - 1 - coreIdx + (rarityOrder.length - 1 - matIdx);
                optionsBySlot.get(slot)!.push({
                    slot,
                    set,
                    setCoreRarity,
                    setMaterialRarity,
                    priority: avgPriority,
                    rarityScore,
                });
            });
        });
    });

    // Sort options within each slot by priority first, then by rarity
    optionsBySlot.forEach((options) => {
        options.sort((a, b) => {
            // Primary sort: priority (higher first)
            if (Math.abs(a.priority - b.priority) > 0.01) {
                return b.priority - a.priority;
            }
            // Secondary sort: rarity (higher first)
            return b.rarityScore - a.rarityScore;
        });
    });

    // Define slot priorities: sensors/software/thrusters need both good main stat AND substats
    // so they should get priority. weapon/hull/generator have fixed main stats, only need substats.
    const slotPriorityMultiplier: Record<GearSlotName, number> = {
        sensor: 1.5, // Higher priority - needs good main stat + substats
        software: 1.5, // Higher priority - needs good main stat + substats
        thrusters: 1.5, // Higher priority - needs good main stat + substats
        weapon: 1.0, // Fixed main stat, only substats matter
        hull: 1.0, // Fixed main stat, only substats matter
        generator: 1.0, // Fixed main stat, only substats matter
    };

    // Track crafts made per slot and per set for balancing
    const craftsPerSlot = new Map<GearSlotName, number>();
    const craftsPerSet = new Map<CraftableSet, number>();
    const allSets: CraftableSet[] = ['omnicore', 'swiftness', 'recovery', 'exploit'];
    optionsBySlot.forEach((_, slot) => {
        craftsPerSlot.set(slot, 0);
    });
    allSets.forEach((set) => {
        craftsPerSet.set(set, 0);
    });

    // Calculate weighted total (accounting for slot priorities)
    const weightedTotal = Array.from(optionsBySlot.keys()).reduce((sum, slot) => {
        const slotItemCount = inventory.slotItems[slot];
        const priority = slotPriorityMultiplier[slot] || 1.0;
        return sum + slotItemCount * priority;
    }, 0);

    // Distribute crafts across slots, prioritizing slots that are furthest behind
    // This ensures even distribution while still prioritizing by suggestion priority and rarity
    let hasCrafted = true;
    let consecutiveNoCrafts = 0;
    const maxConsecutiveNoCrafts = optionsBySlot.size * 3; // Allow 3 full rounds without crafts before stopping

    while (hasCrafted && consecutiveNoCrafts < maxConsecutiveNoCrafts) {
        hasCrafted = false;
        consecutiveNoCrafts++;

        // Calculate which slot is most behind its expected ratio
        const totalCraftsSoFar = Array.from(craftsPerSlot.values()).reduce(
            (sum, count) => sum + count,
            0
        );

        // Find the slot that's most behind its expected ratio
        const slotPriorities: Array<{
            slot: GearSlotName;
            deficit: number;
            slotItemCount: number;
        }> = [];

        for (const slot of optionsBySlot.keys()) {
            const currentCrafts = craftsPerSlot.get(slot) || 0;
            const slotItemCount = inventory.slotItems[slot];
            const slotPriority = slotPriorityMultiplier[slot] || 1.0;

            if (slotItemCount <= 0) continue; // Skip slots with no items

            // Expected ratio based on weighted items (slot priority * item count)
            const weightedSlotItems = slotItemCount * slotPriority;
            const expectedRatio = weightedTotal > 0 ? weightedSlotItems / weightedTotal : 0;
            const currentRatio = totalCraftsSoFar > 0 ? currentCrafts / totalCraftsSoFar : 0;

            // Calculate deficit (how far behind this slot is)
            // Positive deficit means slot is behind, negative means ahead
            const deficit = expectedRatio - currentRatio;

            slotPriorities.push({
                slot,
                deficit,
                slotItemCount,
            });
        }

        // Sort by deficit (most behind first), then by slot priority
        slotPriorities.sort((a, b) => {
            // Primary: deficit (most behind first)
            if (Math.abs(a.deficit - b.deficit) > 0.001) {
                return b.deficit - a.deficit;
            }
            // Secondary: slot priority (higher priority first)
            const priorityA = slotPriorityMultiplier[a.slot] || 1.0;
            const priorityB = slotPriorityMultiplier[b.slot] || 1.0;
            return priorityB - priorityA;
        });

        // Try to craft from the slot that's most behind
        for (const { slot, deficit } of slotPriorities) {
            // Only craft if slot is behind (deficit > 0) or we're early in the process
            if (deficit <= -0.05 && totalCraftsSoFar > 10) continue; // Skip if significantly ahead

            const options = optionsBySlot.get(slot)!;

            // Calculate set distribution to balance across sets
            const totalCraftsBySet = Array.from(craftsPerSet.values()).reduce(
                (sum, count) => sum + count,
                0
            );
            const totalSetWeight = allSets.reduce(
                (sum, set) => sum + setPriorityMultiplier[set],
                0
            );

            // Find the best option that balances both slot and set distribution
            let bestOption: CraftOption | null = null;
            let bestScore = -Infinity;

            for (const option of options) {
                const currentSetCrafts = craftsPerSet.get(option.set) || 0;
                const expectedSetRatio = setPriorityMultiplier[option.set] / totalSetWeight;
                const currentSetRatio =
                    totalCraftsBySet > 0 ? currentSetCrafts / totalCraftsBySet : 0;
                const setDeficit = expectedSetRatio - currentSetRatio;

                // Score combines: set deficit (higher is better), option priority, and rarity
                // Prioritize sets that are behind, but still consider option priority
                const score =
                    setDeficit * 2 + option.priority / totalPriority + option.rarityScore / 10;

                if (score > bestScore) {
                    bestScore = score;
                    bestOption = option;
                }
            }

            // Use the best option if found
            if (!bestOption) continue;
            const option = bestOption;

            // Determine boosters for this specific slot
            const slotBoosters = shouldUseBoosters(option.slot);
            const useRankBooster = slotBoosters.rank;
            const useRarityBooster = slotBoosters.rarity;
            const useSubstatBooster = undefined; // Disabled for now

            // Create CraftingBoosters object for this plan
            const planBoosters: CraftingBoosters = {
                rank: useRankBooster ? true : undefined,
                rarity: useRarityBooster ? true : undefined,
                substat: undefined, // Disabled
            };

            // Try to craft with this option's rarity
            if (
                canCraft(
                    inventory,
                    option.slot,
                    option.set,
                    option.setCoreRarity,
                    option.setMaterialRarity,
                    useRankBooster,
                    useRarityBooster,
                    useSubstatBooster
                )
            ) {
                consumeMaterials(
                    inventory,
                    option.slot,
                    option.set,
                    option.setCoreRarity,
                    option.setMaterialRarity,
                    useRankBooster,
                    useRarityBooster,
                    useSubstatBooster
                );
                plans.push({
                    slot: option.slot,
                    set: option.set,
                    setCoreRarity: option.setCoreRarity,
                    setMaterialRarity: option.setMaterialRarity,
                    boosters: planBoosters,
                    count: 1,
                    role: filteredSuggestions.find(
                        (s) => s.slot === option.slot && s.suggestedSet === option.set
                    )?.role,
                    priority: option.priority,
                });
                craftsPerSlot.set(slot, (craftsPerSlot.get(slot) || 0) + 1);
                craftsPerSet.set(option.set, (craftsPerSet.get(option.set) || 0) + 1);
                hasCrafted = true;
                consecutiveNoCrafts = 0;
                break; // Move to next slot after crafting one item
            } else {
                // If exact rarity not available, try lower rarities (fallback)
                let crafted = false;
                for (let cIdx = 0; cIdx < rarityOrder.length && !crafted; cIdx++) {
                    for (let mIdx = 0; mIdx < rarityOrder.length && !crafted; mIdx++) {
                        const fallbackCore = rarityOrder[cIdx];
                        const fallbackMat = rarityOrder[mIdx];

                        // Determine boosters for this specific slot
                        const fallbackSlotBoosters = shouldUseBoosters(option.slot);
                        const fallbackUseRankBooster = fallbackSlotBoosters.rank;
                        const fallbackUseRarityBooster = fallbackSlotBoosters.rarity;
                        const fallbackUseSubstatBooster = undefined;

                        if (
                            canCraft(
                                inventory,
                                option.slot,
                                option.set,
                                fallbackCore,
                                fallbackMat,
                                fallbackUseRankBooster,
                                fallbackUseRarityBooster,
                                fallbackUseSubstatBooster
                            )
                        ) {
                            consumeMaterials(
                                inventory,
                                option.slot,
                                option.set,
                                fallbackCore,
                                fallbackMat,
                                fallbackUseRankBooster,
                                fallbackUseRarityBooster,
                                fallbackUseSubstatBooster
                            );

                            const fallbackPlanBoosters: CraftingBoosters = {
                                rank: fallbackUseRankBooster ? true : undefined,
                                rarity: fallbackUseRarityBooster ? true : undefined,
                                substat: undefined,
                            };

                            plans.push({
                                slot: option.slot,
                                set: option.set,
                                setCoreRarity: fallbackCore,
                                setMaterialRarity: fallbackMat,
                                boosters: fallbackPlanBoosters,
                                count: 1,
                                role: filteredSuggestions.find(
                                    (s) => s.slot === option.slot && s.suggestedSet === option.set
                                )?.role,
                                priority: option.priority,
                            });
                            craftsPerSlot.set(slot, (craftsPerSlot.get(slot) || 0) + 1);
                            craftsPerSet.set(option.set, (craftsPerSet.get(option.set) || 0) + 1);
                            crafted = true;
                            hasCrafted = true;
                            consecutiveNoCrafts = 0;
                            break; // Move to next slot after crafting one item
                        }
                    }
                    if (crafted) break;
                }
                if (crafted) break; // Move to next slot
            }

            // If we crafted from this slot, break and restart the loop
            // This ensures we recalculate priorities after each craft
            if (hasCrafted) break;
        }
    }

    // Second pass: Use remaining materials, spreading evenly across all slot/set combinations
    // Use the same booster logic from first pass
    // Create all possible craft options for remaining materials
    const allSlots = Object.keys(GEAR_SLOTS) as GearSlotName[];
    const allSetsForRemaining: CraftableSet[] = ['omnicore', 'swiftness', 'recovery', 'exploit'];

    // Use the same set priority multipliers from the first pass
    const remainingSetPriorityMultiplier = setPriorityMultiplier;

    interface RemainingCraftOption {
        slot: GearSlotName;
        set: CraftableSet;
        setCoreRarity: RarityName;
        setMaterialRarity: RarityName;
        rarityScore: number;
    }

    const remainingOptions: RemainingCraftOption[] = [];

    // Generate all possible craft options
    for (const slot of allSlots) {
        for (const set of allSetsForRemaining) {
            rarityOrder.forEach((setCoreRarity, coreIdx) => {
                rarityOrder.forEach((setMaterialRarity, matIdx) => {
                    const rarityScore =
                        rarityOrder.length - 1 - coreIdx + (rarityOrder.length - 1 - matIdx);
                    remainingOptions.push({
                        slot,
                        set,
                        setCoreRarity,
                        setMaterialRarity,
                        rarityScore,
                    });
                });
            });
        }
    }

    // Sort by rarity (higher first) to prioritize better materials
    remainingOptions.sort((a, b) => b.rarityScore - a.rarityScore);

    // Track crafts per slot/set combination for even distribution
    const craftsPerSlotSet = new Map<string, number>();
    const getSlotSetKey = (slot: GearSlotName, set: CraftableSet) => `${slot}-${set}`;

    // Distribute remaining materials evenly using round-robin
    let remainingHasCrafted = true;
    let remainingConsecutiveNoCrafts = 0;
    const maxRemainingConsecutiveNoCrafts = allSlots.length * allSetsForRemaining.length * 2;

    while (remainingHasCrafted && remainingConsecutiveNoCrafts < maxRemainingConsecutiveNoCrafts) {
        remainingHasCrafted = false;
        remainingConsecutiveNoCrafts++;

        // Calculate which slot/set combination is most behind
        const totalRemainingCrafts = Array.from(craftsPerSlotSet.values()).reduce(
            (sum, count) => sum + count,
            0
        );

        const slotSetPriorities: Array<{
            slot: GearSlotName;
            set: CraftableSet;
            deficit: number;
            slotItemCount: number;
        }> = [];

        // Calculate expected distribution for each slot/set combination
        // We want to balance both by slot (with priority) and by set (with small boost for suggested sets)
        const totalWeightedSlots = allSlots.reduce((sum, slot) => {
            const slotPriority = slotPriorityMultiplier[slot] || 1.0;
            const slotItemCount = inventory.slotItems[slot];
            return sum + (slotItemCount > 0 ? slotPriority : 0);
        }, 0);

        // Calculate total set weight (for even distribution with small boost for suggested sets)
        const totalSetWeight = allSetsForRemaining.reduce((sum, set) => {
            return sum + remainingSetPriorityMultiplier[set];
        }, 0);

        for (const slot of allSlots) {
            for (const set of allSetsForRemaining) {
                const key = getSlotSetKey(slot, set);
                const currentCrafts = craftsPerSlotSet.get(key) || 0;
                const slotItemCount = inventory.slotItems[slot];
                const slotPriority = slotPriorityMultiplier[slot] || 1.0;
                const setPriority = remainingSetPriorityMultiplier[set] || 1.0;

                if (slotItemCount <= 0) continue;

                // Expected ratio: weighted by slot priority AND set priority
                // Base distribution is even across sets, with small boost (1.1x) for suggested sets
                const slotWeight = slotPriority / totalWeightedSlots;
                const setWeight = setPriority / totalSetWeight;
                const expectedRatio = slotWeight * setWeight;
                const currentRatio =
                    totalRemainingCrafts > 0 ? currentCrafts / totalRemainingCrafts : 0;

                const deficit = expectedRatio - currentRatio;

                slotSetPriorities.push({
                    slot,
                    set,
                    deficit,
                    slotItemCount,
                });
            }
        }

        // Sort by deficit (most behind first), then by slot priority
        slotSetPriorities.sort((a, b) => {
            if (Math.abs(a.deficit - b.deficit) > 0.001) {
                return b.deficit - a.deficit;
            }
            const priorityA = slotPriorityMultiplier[a.slot] || 1.0;
            const priorityB = slotPriorityMultiplier[b.slot] || 1.0;
            return priorityB - priorityA;
        });

        // Try to craft from the slot/set combination that's most behind
        for (const { slot, set, deficit } of slotSetPriorities) {
            if (deficit <= -0.05 && totalRemainingCrafts > 10) continue;

            const key = getSlotSetKey(slot, set);

            // Try crafting from this slot/set, starting with highest rarity
            for (const option of remainingOptions) {
                if (option.slot !== slot || option.set !== set) continue;

                // Determine boosters for this specific slot
                const remainingSlotBoosters = shouldUseBoosters(option.slot);
                const remainingUseRankBooster = remainingSlotBoosters.rank;
                const remainingUseRarityBooster = remainingSlotBoosters.rarity;
                const remainingUseSubstatBooster = undefined;

                const remainingPlanBoosters: CraftingBoosters = {
                    rank: remainingUseRankBooster ? true : undefined,
                    rarity: remainingUseRarityBooster ? true : undefined,
                    substat: undefined,
                };

                if (
                    canCraft(
                        inventory,
                        option.slot,
                        option.set,
                        option.setCoreRarity,
                        option.setMaterialRarity,
                        remainingUseRankBooster,
                        remainingUseRarityBooster,
                        remainingUseSubstatBooster
                    )
                ) {
                    consumeMaterials(
                        inventory,
                        option.slot,
                        option.set,
                        option.setCoreRarity,
                        option.setMaterialRarity,
                        remainingUseRankBooster,
                        remainingUseRarityBooster,
                        remainingUseSubstatBooster
                    );
                    plans.push({
                        slot: option.slot,
                        set: option.set,
                        setCoreRarity: option.setCoreRarity,
                        setMaterialRarity: option.setMaterialRarity,
                        boosters: remainingPlanBoosters,
                        count: 1,
                    });
                    craftsPerSlotSet.set(key, (craftsPerSlotSet.get(key) || 0) + 1);
                    remainingHasCrafted = true;
                    remainingConsecutiveNoCrafts = 0;
                    break; // Craft one item, then recalculate priorities
                }
            }

            if (remainingHasCrafted) break; // Restart loop to recalculate priorities
        }
    }

    // Check for unused materials
    const unusedSlotItems = Object.entries(inventory.slotItems)
        .filter(([_, count]) => count > 0)
        .map(([slot]) => slot);
    if (unusedSlotItems.length > 0) {
        warnings.push(
            `Not enough set cores or materials to use all slot items: ${unusedSlotItems.join(', ')}`
        );
    }

    // Convert remaining inventory back to CraftingMaterials format
    const remainingMaterials = inventoryToMaterials(inventory);

    // Calculate expected results
    return calculateExpectedResults(plans, warnings, remainingMaterials);
}

/**
 * Crafts evenly when no suggestions are available
 */
function craftEvenly(inventory: MaterialInventory, warnings: string[]): AutocraftResult {
    const plans: AutocraftPlan[] = [];
    const allSlots = Object.keys(GEAR_SLOTS) as GearSlotName[];
    const allSets: CraftableSet[] = ['omnicore', 'swiftness', 'recovery', 'exploit'];
    const rarityOrder: RarityName[] = ['legendary', 'epic', 'rare'];

    // Only use rank/rarity boosters for sensors/software/thrusters slots
    const prioritySlots: GearSlotName[] = ['sensor', 'software', 'thrusters'];

    // Helper function to determine if we should use boosters for a slot
    const shouldUseBoosters = (slot: GearSlotName): { rank: boolean; rarity: boolean } => {
        if (!prioritySlots.includes(slot)) {
            return { rank: false, rarity: false };
        }
        return {
            rank: inventory.boosters.rank > 0,
            rarity: inventory.boosters.rarity > 0,
        };
    };

    // Craft evenly, starting with highest rarity
    for (const slot of allSlots) {
        for (const set of allSets) {
            for (const setCoreRarity of rarityOrder) {
                for (const setMaterialRarity of rarityOrder) {
                    // Determine boosters for this specific slot
                    const slotBoosters = shouldUseBoosters(slot);
                    const useRankBooster = slotBoosters.rank;
                    const useRarityBooster = slotBoosters.rarity;
                    const useSubstatBooster = undefined; // Disabled

                    const planBoosters: CraftingBoosters = {
                        rank: useRankBooster ? true : undefined,
                        rarity: useRarityBooster ? true : undefined,
                        substat: undefined,
                    };

                    while (
                        canCraft(
                            inventory,
                            slot,
                            set,
                            setCoreRarity,
                            setMaterialRarity,
                            useRankBooster,
                            useRarityBooster,
                            useSubstatBooster
                        )
                    ) {
                        consumeMaterials(
                            inventory,
                            slot,
                            set,
                            setCoreRarity,
                            setMaterialRarity,
                            useRankBooster,
                            useRarityBooster,
                            useSubstatBooster
                        );
                        plans.push({
                            slot,
                            set,
                            setCoreRarity,
                            setMaterialRarity,
                            boosters: planBoosters,
                            count: 1,
                        });
                    }
                }
            }
        }
    }

    // Convert remaining inventory back to CraftingMaterials format
    const remainingMaterials = inventoryToMaterials(inventory);

    // Calculate expected results
    return calculateExpectedResults(plans, warnings, remainingMaterials);
}

/**
 * Calculates expected results from crafting plans
 */
function calculateExpectedResults(
    plans: AutocraftPlan[],
    warnings: string[],
    remainingMaterials: CraftingMaterials
): AutocraftResult {
    // Group plans by their characteristics for aggregation
    const planGroups = new Map<string, AutocraftPlan>();
    plans.forEach((plan) => {
        const key = `${plan.slot}-${plan.set}-${plan.setCoreRarity}-${plan.setMaterialRarity}-${JSON.stringify(plan.boosters)}`;
        if (planGroups.has(key)) {
            planGroups.get(key)!.count++;
        } else {
            planGroups.set(key, { ...plan });
        }
    });

    // Calculate expected results
    const bySet: Record<CraftableSet, number> = {
        omnicore: 0,
        swiftness: 0,
        recovery: 0,
        exploit: 0,
    };
    const bySlot: Record<GearSlotName, number> = {
        weapon: 0,
        hull: 0,
        generator: 0,
        sensor: 0,
        software: 0,
        thrusters: 0,
    };
    const byRarity: Record<RarityName, number> = {
        rare: 0,
        epic: 0,
        legendary: 0,
    };
    const byStars: Record<'4_star' | '5_star' | '6_star', number> = {
        '4_star': 0,
        '5_star': 0,
        '6_star': 0,
    };
    const fullDistribution: Record<string, number> = {
        '4_star_rare': 0,
        '4_star_epic': 0,
        '4_star_legendary': 0,
        '5_star_rare': 0,
        '5_star_epic': 0,
        '5_star_legendary': 0,
        '6_star_rare': 0,
        '6_star_epic': 0,
        '6_star_legendary': 0,
    };

    // Per-set full distribution
    const bySetFullDistribution: Record<CraftableSet, Record<string, number>> = {
        omnicore: {
            '4_star_rare': 0,
            '4_star_epic': 0,
            '4_star_legendary': 0,
            '5_star_rare': 0,
            '5_star_epic': 0,
            '5_star_legendary': 0,
            '6_star_rare': 0,
            '6_star_epic': 0,
            '6_star_legendary': 0,
        },
        swiftness: {
            '4_star_rare': 0,
            '4_star_epic': 0,
            '4_star_legendary': 0,
            '5_star_rare': 0,
            '5_star_epic': 0,
            '5_star_legendary': 0,
            '6_star_rare': 0,
            '6_star_epic': 0,
            '6_star_legendary': 0,
        },
        recovery: {
            '4_star_rare': 0,
            '4_star_epic': 0,
            '4_star_legendary': 0,
            '5_star_rare': 0,
            '5_star_epic': 0,
            '5_star_legendary': 0,
            '6_star_rare': 0,
            '6_star_epic': 0,
            '6_star_legendary': 0,
        },
        exploit: {
            '4_star_rare': 0,
            '4_star_epic': 0,
            '4_star_legendary': 0,
            '5_star_rare': 0,
            '5_star_epic': 0,
            '5_star_legendary': 0,
            '6_star_rare': 0,
            '6_star_epic': 0,
            '6_star_legendary': 0,
        },
    };

    planGroups.forEach((plan) => {
        const craftingInput: CraftingInput = {
            slot: plan.slot,
            set: plan.set,
            setCoreRarity: plan.setCoreRarity,
            setMaterialRarity: plan.setMaterialRarity,
            boosters: plan.boosters,
        };

        const probabilities = calculateCraftingProbabilities(craftingInput);

        // Multiply by count
        bySet[plan.set] += plan.count;
        bySlot[plan.slot] += plan.count;

        // Calculate expected results based on probabilities
        byStars['4_star'] += probabilities.starDistribution['4_star'] * plan.count;
        byStars['5_star'] += probabilities.starDistribution['5_star'] * plan.count;
        byStars['6_star'] += probabilities.starDistribution['6_star'] * plan.count;

        byRarity.rare += probabilities.rarityDistribution.rare * plan.count;
        byRarity.epic += probabilities.rarityDistribution.epic * plan.count;
        byRarity.legendary += probabilities.rarityDistribution.legendary * plan.count;

        // Full distribution
        Object.keys(fullDistribution).forEach((key) => {
            const value =
                probabilities.fullDistribution[key as keyof typeof probabilities.fullDistribution] *
                plan.count;
            fullDistribution[key] += value;
            // Per-set distribution
            bySetFullDistribution[plan.set][key] += value;
        });
    });

    const totalItems = plans.length;

    return {
        plans: Array.from(planGroups.values()),
        expectedResults: {
            totalItems,
            bySet,
            bySlot,
            byRarity,
            byStars,
            fullDistribution: fullDistribution as unknown as StarRarityDistribution,
            bySetFullDistribution: bySetFullDistribution as unknown as Record<
                CraftableSet,
                StarRarityDistribution
            >,
        },
        remainingMaterials,
        warnings,
    };
}

/**
 * Main autocraft function
 */
export function autocraftMaterials(
    materials: CraftingMaterials,
    suggestions: CraftingSuggestion[],
    selectedRoles: ShipTypeName[]
): AutocraftResult {
    return distributeMaterials(materials, suggestions, selectedRoles);
}
