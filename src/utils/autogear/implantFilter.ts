import { GearPiece } from '../../types/gear';
import { StatPriority, StatBonus } from '../../types/autogear';
import { Stat } from '../../types/stats';
import { STAT_NORMALIZERS } from '../../constants';
import { GearSlotName } from '../../constants/gearTypes';

/**
 * Score an implant by how well its stats (mainStat + subStats) match the
 * given priorities and statBonuses. Higher-priority stats get exponentially
 * higher weight; statBonuses contribute a secondary, smaller bump.
 *
 * Implants imported from game data store all stats in `subStats` with
 * `mainStat: null` (see importPlayerData.ts), so for implants this mostly
 * iterates subStats — but we include mainStat defensively in case a piece
 * comes from a different source.
 */
function scoreImplant(
    implant: GearPiece,
    priorities: StatPriority[],
    statBonuses: StatBonus[]
): number {
    const stats: Stat[] = [];
    if (implant.mainStat) stats.push(implant.mainStat);
    if (implant.subStats) stats.push(...implant.subStats);
    if (stats.length === 0) return 0;

    let total = 0;
    for (const stat of stats) {
        const normalizer = STAT_NORMALIZERS[stat.name] || 1;
        const normalizedValue = stat.value / normalizer;

        const priorityIndex = priorities.findIndex((p) => p.stat === stat.name);
        if (priorityIndex !== -1) {
            const priorityWeight = Math.pow(2, priorities.length - priorityIndex - 1);
            const explicitWeight = priorities[priorityIndex].weight ?? 1;
            total += normalizedValue * priorityWeight * explicitWeight;
        }

        const bonus = statBonuses.find((b) => b.stat === stat.name);
        if (bonus) {
            total += normalizedValue * (bonus.percentage / 100);
        }
    }
    return total;
}

/**
 * Filter implants to the best candidates per slot for GA optimization.
 *
 * For each slot we keep:
 *   (a) every currently-equipped implant (so the GA can decide to keep it),
 *   (b) the top K scorers, where K = max(20, ⌈slot_size × 0.25⌉), and
 *   (c) the best-scoring implant of each distinct setBonus — this preserves
 *       type diversity, which matters especially for major implants where
 *       the passive effect differs between types even when raw stats are
 *       similar.
 *
 * This replaces the previous "relevant types only, one best per type"
 * approach, which threw out all major implants (they weren't in the
 * hand-maintained type→stat map) and kept at most one candidate per
 * relevant minor type.
 *
 * @param inventory - Full inventory including implants and gear.
 * @param priorities - Stat priorities for relevance weighting.
 * @param equippedImplantIds - IDs currently equipped on the ship (always kept).
 * @param statBonuses - Optional secondary stat weights.
 */
export function filterTopImplantsPerSlot(
    inventory: GearPiece[],
    priorities: StatPriority[],
    equippedImplantIds: Set<string> = new Set(),
    statBonuses: StatBonus[] = []
): GearPiece[] {
    const gear: GearPiece[] = [];
    const implantsBySlot: Map<GearSlotName, GearPiece[]> = new Map();

    for (const item of inventory) {
        if (item.slot.startsWith('implant_')) {
            const list = implantsBySlot.get(item.slot) ?? [];
            list.push(item);
            implantsBySlot.set(item.slot, list);
        } else {
            gear.push(item);
        }
    }

    // Nothing to rank against — keep everything.
    if (priorities.length === 0 && statBonuses.length === 0) {
        return inventory;
    }

    const filteredImplants: GearPiece[] = [];

    for (const [slot, implants] of implantsBySlot) {
        const scored = implants
            .map((implant) => ({
                implant,
                score: scoreImplant(implant, priorities, statBonuses),
            }))
            .sort((a, b) => b.score - a.score);

        const kept = new Set<string>();
        const slotKeep: GearPiece[] = [];

        // (a) Always include equipped implants for this slot.
        for (const { implant } of scored) {
            if (equippedImplantIds.has(implant.id)) {
                slotKeep.push(implant);
                kept.add(implant.id);
            }
        }

        // (b) Top K scorers.
        const targetK = Math.max(20, Math.ceil(implants.length * 0.25));
        for (const { implant } of scored) {
            if (slotKeep.length >= targetK) break;
            if (kept.has(implant.id)) continue;
            slotKeep.push(implant);
            kept.add(implant.id);
        }

        // (c) Best-scoring implant per distinct setBonus, for type diversity.
        const seenTypes = new Set<string>();
        for (const { implant } of scored) {
            const type = implant.setBonus ?? 'UNKNOWN';
            if (seenTypes.has(type)) continue;
            seenTypes.add(type);
            if (kept.has(implant.id)) continue;
            slotKeep.push(implant);
            kept.add(implant.id);
        }

        filteredImplants.push(...slotKeep);

        if (implants.length > slotKeep.length) {
            // eslint-disable-next-line no-console
            console.log(`Implant filter [${slot}]: kept ${slotKeep.length}/${implants.length}`);
        }
    }

    return [...gear, ...filteredImplants];
}
