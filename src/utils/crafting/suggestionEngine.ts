import { CraftableSet, CraftingSuggestion, SlotRoleScore } from '../../types/crafting';
import { GEAR_SETS } from '../../constants/gearSets';
import { ShipTypeName } from '../../constants';
import { SET_MATERIAL_REQUIREMENTS } from '../../constants/craftingProbabilities';
import { calculatePriorityScore } from '../autogear/scoring';
import { BaseStats } from '../../types/stats';
import { PERCENTAGE_ONLY_STATS, PercentageOnlyStats } from '../../types/stats';

/**
 * Scores how well a craftable set fits a role using the actual scoring system
 * This uses the same test stats and scoring logic as the rest of the application
 */
function scoreSetForRole(set: CraftableSet, role: ShipTypeName): number {
    const setBonus = GEAR_SETS[set.toUpperCase() as keyof typeof GEAR_SETS];
    if (!setBonus || !setBonus.stats) return 0;

    // Use the same base stats as calculateGearStats for consistency
    const baseStats: BaseStats = {
        hp: 30000,
        attack: 8000,
        defence: 8000,
        hacking: 200,
        security: 200,
        speed: 150,
        crit: 0,
        critDamage: 150,
        healModifier: 0,
        defensePenetration: 0,
    };

    // Apply set bonus stats to base stats (matching statsCalculator logic)
    const statsWithSetBonus: BaseStats = { ...baseStats };
    setBonus.stats.forEach((stat) => {
        const isPercentageOnlyStat = PERCENTAGE_ONLY_STATS.includes(
            stat.name as PercentageOnlyStats
        );

        if (isPercentageOnlyStat) {
            // Percentage-only stats: add directly
            statsWithSetBonus[stat.name] = (statsWithSetBonus[stat.name] || 0) + stat.value;
        } else if (stat.type === 'percentage') {
            // Percentage stats that can be flat or percentage: multiply by base value
            const baseValue = baseStats[stat.name] || 0;
            const bonus = baseValue * (stat.value / 100);
            statsWithSetBonus[stat.name] = (statsWithSetBonus[stat.name] || 0) + bonus;
        } else {
            // Flat stats: add directly
            statsWithSetBonus[stat.name] = (statsWithSetBonus[stat.name] || 0) + stat.value;
        }
    });

    // Calculate set count (assuming we have the set active)
    const setCount: Record<string, number> = {
        [set.toUpperCase()]: setBonus.minPieces || 2,
    };

    // Use the actual scoring system
    return calculatePriorityScore(statsWithSetBonus, [], role, setCount);
}

/**
 * Generates crafting suggestions based on inventory analysis
 */
export function generateCraftingSuggestions(
    slotRoleScores: SlotRoleScore[],
    _roles: ShipTypeName[]
): CraftingSuggestion[] {
    const suggestions: CraftingSuggestion[] = [];
    const craftableSets: CraftableSet[] = ['omnicore', 'swiftness', 'recovery', 'exploit'];

    for (const slotRole of slotRoleScores) {
        if (!slotRole.needsCrafting) continue;

        // Score each craftable set for this role
        const setScores = craftableSets.map((set) => {
            const setBonus = GEAR_SETS[set.toUpperCase() as keyof typeof GEAR_SETS];
            const rawScore = scoreSetForRole(set, slotRole.role as ShipTypeName);
            const minPieces = setBonus?.minPieces || 2;

            // Normalize score by pieces needed - sets requiring more pieces should be penalized
            // This accounts for the fact that OMNICORE needs 4 pieces vs 2 for others
            // We divide by pieces needed to get a "score per piece" metric
            const normalizedScore = rawScore / minPieces;

            return {
                set,
                score: rawScore,
                normalizedScore,
                minPieces,
            };
        });

        // Sort by normalized score descending (score per piece)
        setScores.sort((a, b) => b.normalizedScore - a.normalizedScore);

        // Get the best set (based on normalized score)
        const bestSet = setScores[0];
        if (bestSet.score > 0) {
            // Calculate priority based on multiple factors
            const gapRatio =
                slotRole.median > 0
                    ? slotRole.top10Average / slotRole.median
                    : slotRole.top10Average; // If median is 0, use average directly

            // Priority factors:
            // - Normalized set score (score per piece, accounting for difficulty)
            // - Gap ratio (how much better top pieces are vs median)
            // - Piece count (fewer pieces = higher priority)
            const pieceCountFactor = Math.max(1, 50 / Math.max(1, slotRole.scores.length));
            // Use normalized score for priority to account for pieces needed
            const priority = bestSet.normalizedScore * gapRatio * pieceCountFactor;

            // Generate reasoning
            let reasoning: string;
            const setLabel = bestSet.set.charAt(0).toUpperCase() + bestSet.set.slice(1);
            const piecesNote =
                bestSet.minPieces > 2 ? ` (requires ${bestSet.minPieces} pieces)` : '';

            if (slotRole.scores.length < 30) {
                reasoning = `You have ${slotRole.scores.length} ${slotRole.slot} pieces for ${slotRole.role} role. More gear would help optimize your builds. ${setLabel} set bonuses align well with ${slotRole.role} role${piecesNote}.`;
            } else {
                const gapPercent = ((gapRatio - 1) * 100).toFixed(0);
                reasoning = `Average score (${slotRole.top10Average.toFixed(0)}) is ${gapPercent}% higher than median (${slotRole.median.toFixed(0)}), suggesting a need for more ${slotRole.slot} gear. ${setLabel} set bonuses align well with ${slotRole.role} role${piecesNote}.`;
            }

            suggestions.push({
                slot: slotRole.slot,
                role: slotRole.role,
                suggestedSet: bestSet.set,
                reasoning,
                priority,
                averageScore: slotRole.top10Average,
                medianScore: slotRole.median,
            });
        }
    }

    // Sort by priority descending
    return suggestions.sort((a, b) => b.priority - a.priority);
}

/**
 * Gets material requirements for a craftable set
 */
export function getMaterialRequirements(set: CraftableSet): 'synth_alloy' | 'quantum_fiber' {
    return SET_MATERIAL_REQUIREMENTS[set];
}
