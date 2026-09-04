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
import { UPGRADE_LEVELS } from './potentialCalculator';

/** Only fully-levelled gear counts as supply. */
export const COVERAGE_MIN_LEVEL = 16;

/**
 * Default top-marginals sample size per (role, slot), zero-padded up to this
 * size. `computePriority` and `buildCoverageMatrix` both take this as an
 * overridable `sampleSize` argument — this constant is only the fallback
 * when the caller does not pass one.
 */
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
 * A level-16, 6-star legendary piece carries `UPGRADE_LEVELS.legendary
 * .initialSubstats` distinct (name, type) substat slots, then
 * `UPGRADE_LEVELS.legendary.increases.length` further upgrade rolls land on
 * those SAME slots as the piece levels up — `simulateUpgrade` in
 * `potentialCalculator.ts` bumps an EXISTING substat's value with a fresh
 * roll off its own range table, it never adds a new substat past the
 * initial set. A slot that draws every increase tops out at
 * `(1 + LEGENDARY_SUBSTAT_INCREASES)` times its own single-roll legendary
 * max (e.g. a critDamage substat that lands all 4 increases reaches 5x its
 * 8% single-roll max — 40%).
 */
const LEGENDARY_SUBSTAT_SLOTS = UPGRADE_LEVELS.legendary.initialSubstats;
const LEGENDARY_SUBSTAT_INCREASES = UPGRADE_LEVELS.legendary.increases.length;

/**
 * Every (name, type) pair legal as a substat, excluding only the piece's own
 * main stat (name, type) — the exact rule `GearPieceForm` enforces
 * (`excludedStats={[{ name: mainStat.name, type: mainStat.type }]}`). The
 * OTHER type variant of the main stat's own name stays selectable: an
 * `attack`-flat weapon main stat can still carry an `attack`-percentage
 * substat, and both may sit on the same piece as two of its four slots.
 */
function candidateSubstatPairs(mainStat: Stat | null): { name: StatName; type: StatType }[] {
    const pairs: { name: StatName; type: StatType }[] = [];
    for (const name of Object.keys(SUBSTAT_RANGES) as StatName[]) {
        for (const type of Object.keys(SUBSTAT_RANGES[name]) as StatType[]) {
            if (mainStat && mainStat.name === name && mainStat.type === type) continue;
            pairs.push({ name, type });
        }
    }
    return pairs;
}

/** Every k-element subset of `items`, as arrays in `items`' relative order. */
function combinations<T>(items: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (items.length < k) return [];
    const [first, ...rest] = items;
    const withFirst = combinations(rest, k - 1).map((combo) => [first, ...combo]);
    return [...withFirst, ...combinations(rest, k)];
}

/** Every way to split `total` indistinguishable rolls across `slots` non-negative integer buckets. */
function distributeRolls(total: number, slots: number): number[][] {
    if (slots === 1) return [[total]];
    const result: number[][] = [];
    for (let take = 0; take <= total; take++) {
        for (const rest of distributeRolls(total - take, slots - 1)) {
            result.push([take, ...rest]);
        }
    }
    return result;
}

/**
 * The highest-scoring legal level-16, 6-star legendary substat block for
 * `role`, given the slot's chosen `mainStat`.
 *
 * Exhaustive, not greedy: every `LEGENDARY_SUBSTAT_SLOTS`-combination of
 * legal (name, type) pairs, crossed with every way to distribute
 * `LEGENDARY_SUBSTAT_INCREASES` upgrade rolls across those slots, is
 * assembled into a full piece and scored with `scorePieceForRole`; the
 * maximum is kept. A greedy per-slot assignment is not provably exact here —
 * several role formulas read crit x critDamage or an effective-HP product,
 * so a roll's marginal value on one slot depends on what already sits in the
 * others. `roleSlotCoverage.test.ts`'s "the ideal is a true ceiling"
 * property test is what would catch a shortfall against a legal piece this
 * search failed to try.
 */
function pickIdealSubstats(
    role: ShipTypeName,
    mainStat: Stat | null
): { stats: Stat[]; score: number } {
    const pairs = candidateSubstatPairs(mainStat);
    const combos = combinations(pairs, LEGENDARY_SUBSTAT_SLOTS);
    const rollDistributions = distributeRolls(LEGENDARY_SUBSTAT_INCREASES, LEGENDARY_SUBSTAT_SLOTS);

    let best: { stats: Stat[]; score: number } | null = null;
    for (const combo of combos) {
        for (const rolls of rollDistributions) {
            const stats = combo.map((pair, i) => {
                const max = SUBSTAT_RANGES[pair.name][pair.type].legendary.max;
                return makeStat(pair.name, pair.type, (1 + rolls[i]) * max);
            });
            const piece: GearPiece = {
                id: 'ideal-candidate',
                slot: 'weapon',
                level: COVERAGE_MIN_LEVEL,
                stars: 6,
                rarity: 'legendary',
                mainStat,
                subStats: stats,
                setBonus: null,
            };
            const score = scorePieceForRole(piece, role);
            if (!best || score > best.score) best = { stats, score };
        }
    }
    return best ?? { stats: [], score: 0 };
}

/**
 * `scorePieceForRole(piece, role)` for the ideal piece — see `getIdealMarginal`.
 * <= 0 means nothing this slot can carry helps this role.
 */
type IdealMarginal = number;

/** (role, slot) never changes, so the ideal marginal is computed once and cached. */
const idealMarginalCache = new Map<string, IdealMarginal>();

/**
 * The best-scoring level-16, 6-star legendary piece this slot can carry for
 * `role`: every main stat this slot can carry, crossed with
 * `pickIdealSubstats`' own exhaustive substat search FOR THAT MAIN STAT, is
 * scored, and the maximum kept. Main stat and substats are searched jointly,
 * not main-stat-first-then-substats: two main stat candidates can tie (or
 * nearly tie) on their own bare marginal while differing sharply once a real
 * substat block sits on top of them (e.g. a role that reads one stat
 * multiplicatively against a common one), so picking the main stat in
 * isolation can strand the search on the wrong branch.
 */
function pickIdealPiece(
    role: ShipTypeName,
    slot: GearSlotName
): { mainStat: Stat | null; subStats: Stat[]; score: number } {
    let best: { mainStat: Stat | null; subStats: Stat[]; score: number } | null = null;
    for (const name of GEAR_SLOTS[slot].availableMainStats) {
        const type = mainStatType(slot, name);
        const mainStat = makeStat(
            name,
            type,
            calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL)
        );
        const { stats: subStats, score } = pickIdealSubstats(role, mainStat);
        if (!best || score > best.score) best = { mainStat, subStats, score };
    }
    return best ?? { mainStat: null, subStats: pickIdealSubstats(role, null).stats, score: 0 };
}

export function getIdealMarginal(role: ShipTypeName, slot: GearSlotName): IdealMarginal {
    const key = `${role}:${slot}`;
    const cached = idealMarginalCache.get(key);
    if (cached !== undefined) return cached;

    const idealMarginal = pickIdealPiece(role, slot).score;
    idealMarginalCache.set(key, idealMarginal);
    return idealMarginal;
}

/**
 * How much of this (role, slot)'s ceiling the player's owned pieces cover,
 * in [0, 1], as `1 - priority`.
 *
 * `idealMarginal` is the marginal of a level-16, 6-star legendary piece built
 * from the best-scoring stats this slot can carry for this role — see
 * `getIdealMarginal`. Comparing every player's pieces against the same ceiling,
 * rather than against each other, is what makes roles comparable: a role
 * whose score formula reads a rare stat and a role that reads common ones are
 * no longer judged by how bunched their own top pieces are.
 *
 * The mean is over the top `sampleSize` marginals (default `COVERAGE_SAMPLE_SIZE`),
 * zero-padded up to that size — not divided by however many pieces exist.
 * Owning fewer pieces than `sampleSize` must not inflate the average: a
 * single max-roll piece is not "N max-roll pieces sampled once", it is 1 real
 * value and N-1 unfarmed slots.
 *
 * A real marginal above `idealMarginal` means the ideal-piece model is
 * under-estimating this ceiling, not that the slot is saturated:
 * `coverage = mean / idealMarginal` would exceed 1 and the
 * `Math.min(1, Math.max(0, 1 - coverage))` clamp below silently swallows the
 * overshoot into a plain 0% priority. Non-production throws so the defect is
 * loud; production only logs and lets the clamp degrade, matching
 * `scorePieceUpgrade.ts`'s missing-baseline pattern.
 */
export function computePriority(
    marginals: number[],
    idealMarginal: number,
    sampleSize: number = COVERAGE_SAMPLE_SIZE,
    context?: { role: ShipTypeName; slot: GearSlotName }
): number {
    if (idealMarginal <= 0) return 0;

    const exceedingMarginal = marginals.find((marginal) => marginal > idealMarginal);
    if (exceedingMarginal !== undefined) {
        const where = context ? ` for ${context.role}/${context.slot}` : '';
        const message =
            `computePriority: a real marginal (${exceedingMarginal}) exceeds idealMarginal ` +
            `(${idealMarginal})${where} — the ideal-piece model under-estimates this ceiling.`;
        if (process.env.NODE_ENV !== 'production') {
            throw new Error(message);
        }
        console.error(`[coverage] ${message}`);
    }

    const sample = [...marginals].sort((a, b) => b - a).slice(0, sampleSize);
    const mean = sample.reduce((sum, value) => sum + value, 0) / sampleSize;

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
 *
 * `sampleSize` (default `COVERAGE_SAMPLE_SIZE`) is forwarded to
 * `computePriority` for every cell — see that function's doc for what it
 * controls.
 */
export function buildCoverageMatrix(
    inventory: GearPiece[],
    sampleSize: number = COVERAGE_SAMPLE_SIZE
): CoverageMatrix {
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
            const idealMarginal = getIdealMarginal(role, slot);
            cells[role][slot] = {
                role,
                slot,
                count: pieces.length,
                priority: computePriority(marginals, idealMarginal, sampleSize, { role, slot }),
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
