import type { GearPiece } from '../../types/gear';
import type { BaseStats, PercentageOnlyStats, Stat } from '../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../types/stats';
import type { ShipTypeName } from '../../constants/shipTypes';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { GEAR_SLOT_ORDER, type GearSlotName } from '../../constants/gearTypes';
import { getBaseRoleStats } from '../../constants/roleBaseStats';
import { calculateRoleScore } from '../autogear/priorityScore';

/** Only fully-levelled gear counts as supply. */
export const COVERAGE_MIN_LEVEL = 16;

/** How deep into the quality tail the headroom gap looks. */
export const COVERAGE_SAMPLE_SIZE = 20;

/**
 * Add one gear stat to a stat block. This mirrors `addStatModifier` in
 * `src/utils/ship/statsCalculator.ts` — the canonical rule for every stat in
 * the app — which has exactly three cases and no per-stat special cases:
 * a percentage-only stat (crit, critDamage, ...) is stored as an integer and
 * adds directly; a percentage-typed flexible stat (including speed, hacking
 * and security) adds a share of the reference block; a flat stat adds its
 * value.
 */
function addStat(stat: Stat, target: BaseStats, reference: BaseStats): void {
    const isPercentageOnly = PERCENTAGE_ONLY_STATS.includes(stat.name as PercentageOnlyStats);
    if (isPercentageOnly) {
        target[stat.name] = (target[stat.name] ?? 0) + stat.value;
    } else if (stat.type === 'percentage') {
        target[stat.name] =
            (target[stat.name] ?? 0) + (reference[stat.name] ?? 0) * (stat.value / 100);
    } else {
        target[stat.name] = (target[stat.name] ?? 0) + stat.value;
    }
}

/** Baseline role scores never change, so compute each one once. */
const baselineScoreByRole = new Map<ShipTypeName, number>();

function getBaselineScore(role: ShipTypeName): number {
    const cached = baselineScoreByRole.get(role);
    if (cached !== undefined) return cached;
    const score = calculateRoleScore(role, getBaseRoleStats(role));
    baselineScoreByRole.set(role, score);
    return score;
}

/**
 * How much this piece raises the role's dummy baseline score.
 *
 * Deliberately NOT the dummy path in potentialCalculator: that one rebaselines
 * crit to `100 - the piece's own crit`, which is fair for a within-piece
 * before/after delta and useless across pieces (it neutralises crit entirely).
 *
 * Set bonuses and calibration are excluded. A set bonus is a constant added
 * to every piece carrying that set, so including it would make the gap
 * measure the set/non-set boundary rather than roll quality; calibration is
 * bound to one specific ship, and this scoring is role-generic.
 */
export function scorePieceForRole(piece: GearPiece, role: ShipTypeName): number {
    const baseline = getBaseRoleStats(role);
    const withPiece: BaseStats = { ...baseline };

    if (piece.mainStat) addStat(piece.mainStat, withPiece, baseline);
    for (const sub of piece.subStats ?? []) addStat(sub, withPiece, baseline);

    return calculateRoleScore(role, withPiece) - getBaselineScore(role);
}

/**
 * How much farming headroom a set of marginal scores implies, in [0, 1].
 *
 * 0 means the top of the distribution is filled in — the best piece is no
 * better than the next 19, so further drops will not move the needle.
 * 1 means all the quality sits in one piece (or there is no piece at all).
 *
 * Substats roll randomly, so the spread of the top order statistics shrinks
 * as the sample grows: this measures how deep into the tail the player has
 * already sampled, which raw counts cannot.
 */
export function computeHeadroom(marginals: number[]): number {
    const sample = [...marginals].sort((a, b) => b - a).slice(0, COVERAGE_SAMPLE_SIZE);
    if (sample.length <= 1) return 1;

    const best = sample[0];
    if (best <= 0) return 1;

    const rest = sample.slice(1);
    const restMean = rest.reduce((sum, value) => sum + value, 0) / rest.length;

    const gap = (best - restMean) / best;
    return Math.min(1, Math.max(0, gap));
}

export interface CoverageCell {
    role: ShipTypeName;
    slot: GearSlotName;
    /** Level-16 pieces owned in this slot. Equipped pieces included. */
    count: number;
    /** 0 = saturated, 1 = all the quality sits in one piece (or none owned). */
    headroom: number;
    /**
     * 1 = most headroom within this slot column. Competition ranking: equal
     * headroom shares a rank, and the next distinct value's rank skips ahead
     * by the number of entries tied ahead of it (1,1,1,4,...). A column
     * where every role ties — e.g. an empty inventory — gives every role rank 1.
     */
    rank: number;
}

export interface CoverageMatrix {
    cells: Record<ShipTypeName, Record<GearSlotName, CoverageCell>>;
    /** Roles, most headroom first. */
    roleOrder: ShipTypeName[];
    /** Each role's slots, most headroom first. */
    slotOrderByRole: Record<ShipTypeName, GearSlotName[]>;
}

/**
 * Ascending comparator by `key`; entries with an equal key keep their
 * relative order in `order` rather than the order `Array.sort` happens to
 * hand them in.
 */
function compareByThenOrder<T>(key: (item: T) => number, order: readonly T[]) {
    return (a: T, b: T): number => {
        const gap = key(a) - key(b);
        return gap !== 0 ? gap : order.indexOf(a) - order.indexOf(b);
    };
}

/**
 * Competition ranking ("1,1,1,4,..."): items with an equal `value` share the
 * same rank, and the next distinct value's rank skips ahead by the number of
 * items tied ahead of it. Highest `value` gets rank 1. `order` only decides
 * which equal-valued item is treated as "first" while building the ranking —
 * it never changes a rank number.
 */
export function competitionRank<T>(
    items: readonly T[],
    value: (item: T) => number,
    order: readonly T[]
): Map<T, number> {
    const sorted = [...items].sort(compareByThenOrder((item) => -value(item), order));
    const ranks = new Map<T, number>();
    sorted.forEach((item, index) => {
        const previous = sorted[index - 1];
        const tiedWithPrevious = previous !== undefined && value(previous) === value(item);
        ranks.set(item, tiedWithPrevious ? (ranks.get(previous) as number) : index + 1);
    });
    return ranks;
}

/**
 * Build the role x slot coverage matrix from the inventory.
 *
 * Ranking is per slot COLUMN, never across slots: flat slots (weapon, hull,
 * generator) have a fixed main stat, so their scores vary only by substat and
 * their gaps are inherently narrower than the percentage slots. Ranked raw,
 * they would read as permanently saturated for every player.
 */
export function buildCoverageMatrix(inventory: GearPiece[]): CoverageMatrix {
    const roles = Object.keys(SHIP_TYPES);

    const piecesBySlot = new Map<GearSlotName, GearPiece[]>();
    for (const slot of GEAR_SLOT_ORDER) piecesBySlot.set(slot, []);
    for (const piece of inventory) {
        if (piece.level < COVERAGE_MIN_LEVEL) continue;
        piecesBySlot.get(piece.slot)?.push(piece);
    }

    const cells = {} as Record<ShipTypeName, Record<GearSlotName, CoverageCell>>;
    for (const role of roles) {
        cells[role] = {};
        for (const slot of GEAR_SLOT_ORDER) {
            const pieces = piecesBySlot.get(slot) ?? [];
            const marginals = pieces.map((piece) => scorePieceForRole(piece, role));
            cells[role][slot] = {
                role,
                slot,
                count: pieces.length,
                headroom: computeHeadroom(marginals),
                rank: 0, // assigned below
            };
        }
    }

    // Rank each slot column independently with competition ranking: equal
    // headroom shares a rank, and the next distinct value's rank skips ahead
    // by the number of entries tied ahead of it (1,1,1,4,...). A fully tied
    // column — e.g. an empty inventory — gives every role rank 1.
    for (const slot of GEAR_SLOT_ORDER) {
        const ranks = competitionRank(roles, (role) => cells[role][slot].headroom, roles);
        for (const role of roles) cells[role][slot].rank = ranks.get(role) as number;
    }

    const meanRank = (role: ShipTypeName): number =>
        GEAR_SLOT_ORDER.reduce((sum, slot) => sum + cells[role][slot].rank, 0) /
        GEAR_SLOT_ORDER.length;

    const roleOrder = [...roles].sort(compareByThenOrder(meanRank, roles));

    const slotOrderByRole = {} as Record<ShipTypeName, GearSlotName[]>;
    for (const role of roles) {
        slotOrderByRole[role] = [...GEAR_SLOT_ORDER].sort(
            compareByThenOrder((slot) => cells[role][slot].rank, GEAR_SLOT_ORDER)
        );
    }

    return { cells, roleOrder, slotOrderByRole };
}
