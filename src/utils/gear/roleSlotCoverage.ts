import type { GearPiece } from '../../types/gear';
import type {
    BaseStats,
    FlexibleStats,
    PercentageOnlyStats,
    Stat,
    StatName,
    StatType,
} from '../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../types/stats';
import type { ShipTypeName } from '../../constants/shipTypes';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { GEAR_SLOT_ORDER, GEAR_SLOTS, type GearSlotName } from '../../constants/gearTypes';
import { SUBSTAT_RANGES } from '../../constants/statValues';
import { getBaseRoleStats } from '../../constants/roleBaseStats';
import { calculateRoleScore } from '../autogear/priorityScore';
import { calculateMainStatValue } from './mainStatValueFetcher';

/** Only fully-levelled gear counts as supply. */
export const COVERAGE_MIN_LEVEL = 16;

/** Top marginals sampled per (role, slot), zero-padded up to this size. */
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

/** Build a bare stat-carrying piece so `scorePieceForRole` can score one candidate stat. */
function scoreCandidateStat(stat: Stat, role: ShipTypeName): number {
    return scorePieceForRole(
        {
            id: 'ideal-candidate',
            slot: 'weapon',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [stat],
            setBonus: null,
        },
        role
    );
}

function makeStat(name: StatName, type: StatType, value: number): Stat {
    return type === 'percentage'
        ? { name, value, type: 'percentage' }
        : { name: name as FlexibleStats, value, type: 'flat' };
}

/**
 * The type a stat rolls as when it is this slot's main stat.
 *
 * Percentage-only stats (crit, critDamage, ...) are always percentage.
 * `hacking`, `security` and `speed` are always flat as a MAIN stat,
 * regardless of slot: imported game data rolls them flat even on the
 * percentage slots (sensor, software, thrusters), and `calculateMainStatValue`
 * sends them through their own flat-magnitude tables (`HACK_SEC_STATS`,
 * `SPD_STATS`); marking them percentage here would route them into
 * `PERCENTAGE_STATS` instead, which holds a magnitude for a different stat
 * family. Every other flexible stat (hp, attack, defence) rolls flat on the
 * three flat slots (weapon, hull, generator) and percentage on the three
 * percentage slots (sensor, software, thrusters).
 */
export function mainStatType(slot: GearSlotName, statName: StatName): StatType {
    if (PERCENTAGE_ONLY_STATS.includes(statName as PercentageOnlyStats)) return 'percentage';
    if (statName === 'hacking' || statName === 'security' || statName === 'speed') return 'flat';
    return slot === 'weapon' || slot === 'hull' || slot === 'generator' ? 'flat' : 'percentage';
}

/**
 * The best-scoring main stat this slot can carry for `role`, at level 16,
 * 6-star legendary. Ties broken by `availableMainStats` order.
 */
function pickIdealMainStat(role: ShipTypeName, slot: GearSlotName): Stat | null {
    let best: { stat: Stat; score: number } | null = null;
    for (const name of GEAR_SLOTS[slot].availableMainStats) {
        const type = mainStatType(slot, name);
        const stat = makeStat(
            name,
            type,
            calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL)
        );
        const score = scoreCandidateStat(stat, role);
        if (!best || score > best.score) best = { stat, score };
    }
    return best?.stat ?? null;
}

/**
 * The four best-scoring legendary-max substats for `role`, excluding
 * `excludeName` (the slot's chosen main stat). A stat with both a flat and a
 * percentage roll (e.g. attack) takes whichever variant scores higher — both
 * are legal rolls. Greedy per stat: each candidate is scored on its own, not
 * combined with the others first, since this is a normaliser and a monotone
 * approximation is enough (see the amendment brief for why an exhaustive
 * search over combinations is not worth its cost here).
 */
function pickIdealSubstats(role: ShipTypeName, excludeName: StatName | null): Stat[] {
    const scored: { stat: Stat; score: number }[] = [];
    for (const name of Object.keys(SUBSTAT_RANGES) as StatName[]) {
        if (name === excludeName) continue;
        const ranges = SUBSTAT_RANGES[name];
        let best: { stat: Stat; score: number } | null = null;
        for (const type of ['flat', 'percentage'] as StatType[]) {
            const range = ranges[type];
            if (!range) continue;
            const stat = makeStat(name, type, range.legendary.max);
            const score = scoreCandidateStat(stat, role);
            if (!best || score > best.score) best = { stat, score };
        }
        if (best) scored.push(best);
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 4).map((entry) => entry.stat);
}

interface IdealPiece {
    piece: GearPiece;
    /** `scorePieceForRole(piece, role)`. <= 0 means nothing this slot can carry helps this role. */
    idealMarginal: number;
}

/** (role, slot) never changes, so the ideal piece is computed once and cached. */
const idealPieceCache = new Map<string, IdealPiece>();

function getIdealPiece(role: ShipTypeName, slot: GearSlotName): IdealPiece {
    const key = `${role}:${slot}`;
    const cached = idealPieceCache.get(key);
    if (cached) return cached;

    const mainStat = pickIdealMainStat(role, slot);
    const subStats = pickIdealSubstats(role, mainStat?.name ?? null);
    const piece: GearPiece = {
        id: `ideal-${role}-${slot}`,
        slot,
        level: COVERAGE_MIN_LEVEL,
        stars: 6,
        rarity: 'legendary',
        mainStat,
        subStats,
        setBonus: null,
    };
    const result: IdealPiece = { piece, idealMarginal: scorePieceForRole(piece, role) };
    idealPieceCache.set(key, result);
    return result;
}

/**
 * How much of this (role, slot)'s ceiling the player's owned pieces cover,
 * in [0, 1], as `1 - priority`.
 *
 * `idealMarginal` is the marginal of a level-16, 6-star legendary piece built
 * from the best-scoring stats this slot can carry for this role — see
 * `getIdealPiece`. Comparing every player's pieces against the same ceiling,
 * rather than against each other, is what makes roles comparable: a role
 * whose score formula reads a rare stat and a role that reads common ones are
 * no longer judged by how bunched their own top pieces are.
 *
 * The mean is over the top `COVERAGE_SAMPLE_SIZE` marginals, zero-padded up
 * to that size — not divided by however many pieces exist. Owning fewer than
 * 20 pieces must not inflate the average: a single max-roll piece is not "20
 * max-roll pieces sampled once", it is 1 real value and 19 unfarmed slots.
 */
export function computePriority(marginals: number[], idealMarginal: number): number {
    if (idealMarginal <= 0) return 0;

    const sample = [...marginals].sort((a, b) => b - a).slice(0, COVERAGE_SAMPLE_SIZE);
    // Zero-padded up to COVERAGE_SAMPLE_SIZE: divide by the fixed sample
    // size, not by `sample.length`, so a thin sample is not treated as a
    // small-but-complete population.
    const mean = sample.reduce((sum, value) => sum + value, 0) / COVERAGE_SAMPLE_SIZE;

    const coverage = mean / idealMarginal;
    return Math.min(1, Math.max(0, 1 - coverage));
}

export interface CoverageCell {
    role: ShipTypeName;
    slot: GearSlotName;
    /** Level-16 pieces owned in this slot. Equipped pieces included. */
    count: number;
    /** 0 = fully covered, 1 = nothing usable owned (or nothing this slot can carry helps the role). */
    priority: number;
    /**
     * 1 = highest priority within this slot column. Competition ranking:
     * equal priority shares a rank, and the next distinct value's rank skips
     * ahead by the number of entries tied ahead of it (1,1,1,4,...). A
     * column where every role ties — e.g. an empty inventory — gives every
     * role rank 1.
     */
    rank: number;
}

export interface CoverageMatrix {
    cells: Record<ShipTypeName, Record<GearSlotName, CoverageCell>>;
    /** Roles, highest priority first. */
    roleOrder: ShipTypeName[];
    /** Each role's slots, highest priority first. */
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
 * Two `value()` results this close count as tied. Different role scoring
 * formulas run different arithmetic paths over bit-identical stat blocks, so
 * a conceptual tie can come back as e.g. `2.9e-16` instead of an exact `0`.
 * Priority is clamped to `[0, 1]`, so an absolute epsilon is the right
 * comparison — a relative one would blow up exactly where this noise
 * actually shows up, near zero.
 */
const TIE_EPSILON = 1e-9;

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
        const tiedWithPrevious =
            previous !== undefined && Math.abs(value(previous) - value(item)) <= TIE_EPSILON;
        ranks.set(item, tiedWithPrevious ? (ranks.get(previous) as number) : index + 1);
    });
    return ranks;
}

/**
 * Build the role x slot coverage matrix from the inventory.
 *
 * Ranking is per slot COLUMN, never across slots: the grid answers "which
 * role most needs THIS slot", and `computePriority` already normalises each
 * (role, slot) cell independently against its own ideal-piece ceiling, so
 * ranking within a column compares roles that are already on equal footing
 * for that slot without needing a cross-slot bridge.
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
            const { idealMarginal } = getIdealPiece(role, slot);
            cells[role][slot] = {
                role,
                slot,
                count: pieces.length,
                priority: computePriority(marginals, idealMarginal),
                rank: 0, // assigned below
            };
        }
    }

    // Rank each slot column independently with competition ranking: equal
    // priority shares a rank, and the next distinct value's rank skips ahead
    // by the number of entries tied ahead of it (1,1,1,4,...). A fully tied
    // column — e.g. an empty inventory — gives every role rank 1.
    for (const slot of GEAR_SLOT_ORDER) {
        const ranks = competitionRank(roles, (role) => cells[role][slot].priority, roles);
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
