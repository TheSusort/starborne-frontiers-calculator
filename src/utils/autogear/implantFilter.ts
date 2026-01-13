import { GearPiece } from '../../types/gear';
import { StatPriority } from '../../types/autogear';
import { StatName } from '../../types/stats';
import { STAT_NORMALIZERS } from '../../constants';
import { GearSlotName } from '../../constants/gearTypes';

/**
 * Mapping of implant setBonus to the primary stat it provides.
 * This allows us to filter implants by relevance to stat priorities.
 */
const IMPLANT_TYPE_TO_STAT: Record<string, StatName> = {
    // Alpha (implant_minor_alpha)
    ONSLAUGHT_ALPHA: 'attack',
    BASTION: 'hp',
    GUARDIAN: 'defence',
    DEVASTATION: 'critDamage',
    OVERRIDE_ALPHA: 'hacking',

    // Gamma (implant_minor_gamma)
    PRECISION_GAMMA: 'crit',
    SENTRY: 'security',
    BARRIER: 'defence',
    OVERRIDE: 'hacking',
    HASTE_GAMMA: 'speed',

    // Sigma (implant_minor_sigma)
    PRECISION: 'crit',
    CITADEL: 'hp',
    HASTE: 'speed',
    STRIKE: 'attack',
    ONSLAUGHT: 'attack',
};

/**
 * Get the primary stat an implant type provides.
 */
export function getImplantTypeStat(setBonus: string | null): StatName | null {
    if (!setBonus) return null;
    return IMPLANT_TYPE_TO_STAT[setBonus] || null;
}

/**
 * Score an individual implant based on how well its substats match
 * the given stat priorities.
 *
 * Higher priority stats (earlier in list) get exponentially higher weights.
 * Stats not in priorities get zero weight.
 */
export function scoreImplantForPriorities(implant: GearPiece, priorities: StatPriority[]): number {
    if (!implant.subStats || implant.subStats.length === 0) {
        return 0;
    }

    let totalScore = 0;

    for (const stat of implant.subStats) {
        // Find if this stat is in priorities
        const priorityIndex = priorities.findIndex((p) => p.stat === stat.name);

        if (priorityIndex === -1) {
            // Stat not in priorities - contributes nothing
            continue;
        }

        // Normalize the stat value to make different stat types comparable
        const normalizer = STAT_NORMALIZERS[stat.name] || 1;
        const normalizedValue = stat.value / normalizer;

        // Weight by priority order - first priority is most important
        // Using exponential decay: 2^(n-index-1) where n is total priorities
        const priorityWeight = Math.pow(2, priorities.length - priorityIndex - 1);

        // Also consider explicit weight if provided
        const explicitWeight = priorities[priorityIndex].weight || 1;

        totalScore += normalizedValue * priorityWeight * explicitWeight;
    }

    return totalScore;
}

/**
 * Get the set of stats that are relevant based on priorities.
 * Returns the stat names from the priority list.
 */
function getRelevantStats(priorities: StatPriority[]): Set<StatName> {
    return new Set(priorities.map((p) => p.stat));
}

/**
 * Check if an implant type is relevant for the given priorities.
 * An implant type is relevant if it provides a stat that's in the priorities.
 */
function isImplantTypeRelevant(setBonus: string | null, relevantStats: Set<StatName>): boolean {
    const implantStat = getImplantTypeStat(setBonus);
    if (!implantStat) return false;
    return relevantStats.has(implantStat);
}

/**
 * Filter implants to keep only the best candidates per slot.
 *
 * Strategy:
 * 1. For each implant slot, group implants by their type (setBonus)
 * 2. Only consider implant types that provide stats in the priorities
 * 3. Keep the best implant of each relevant type per slot
 *
 * This ensures we have diversity of relevant implant types while
 * dramatically reducing the search space.
 *
 * @param inventory - Full inventory including implants
 * @param priorities - Stat priorities to determine relevance
 * @returns Filtered inventory with only best relevant implants per type per slot
 */
export function filterTopImplantsPerSlot(
    inventory: GearPiece[],
    priorities: StatPriority[]
): GearPiece[] {
    // Separate gear from implants
    const gear: GearPiece[] = [];
    const implantsBySlot: Map<GearSlotName, GearPiece[]> = new Map();

    for (const item of inventory) {
        if (item.slot.startsWith('implant_')) {
            const existing = implantsBySlot.get(item.slot as GearSlotName) || [];
            existing.push(item);
            implantsBySlot.set(item.slot as GearSlotName, existing);
        } else {
            gear.push(item);
        }
    }

    // If no priorities provided, return inventory unchanged
    if (priorities.length === 0) {
        return inventory;
    }

    const relevantStats = getRelevantStats(priorities);
    const filteredImplants: GearPiece[] = [];

    for (const [slot, implants] of implantsBySlot) {
        // Group implants by their type (setBonus)
        const implantsByType: Map<string, GearPiece[]> = new Map();

        for (const implant of implants) {
            const type = implant.setBonus || 'UNKNOWN';
            const existing = implantsByType.get(type) || [];
            existing.push(implant);
            implantsByType.set(type, existing);
        }

        // For each relevant type, keep only the best implant
        let keptCount = 0;
        const relevantTypes: string[] = [];

        for (const [type, typeImplants] of implantsByType) {
            // Skip types that don't provide relevant stats
            if (!isImplantTypeRelevant(type, relevantStats)) {
                continue;
            }

            relevantTypes.push(type);

            // Score all implants of this type
            const scored = typeImplants.map((implant) => ({
                implant,
                score: scoreImplantForPriorities(implant, priorities),
            }));

            // Sort by score descending and keep the best one
            scored.sort((a, b) => b.score - a.score);
            filteredImplants.push(scored[0].implant);
            keptCount++;
        }

        // Log for debugging
        if (implants.length > keptCount) {
            // eslint-disable-next-line no-console
            console.log(
                `Implant filter [${slot}]: kept ${keptCount}/${implants.length} ` +
                    `(relevant types: ${relevantTypes.join(', ') || 'none'})`
            );
        }
    }

    // Return gear + filtered implants
    return [...gear, ...filteredImplants];
}
