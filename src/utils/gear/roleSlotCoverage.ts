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
import { GEAR_SETS, type GearSetName } from '../../constants/gearSets';
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
 * Add this piece's SHARE of its set bonus to a stat block: the set's own
 * `stats`, each divided by the pieces needed to activate it (`minPieces`,
 * defaulting to 2 when absent — `GEAR_SETS[x]?.minPieces || 2` reads the same
 * default `potentialCalculator.ts` uses, but THAT module applies the FULL
 * bonus, only halved for a 4-piece set — a different, full-credit heuristic
 * for a different feature; do not conflate the two). A 2-piece set like
 * Abyssal Assault (`attack 15%`, `critDamage 5%`) credits each piece half
 * here; a 4-piece set credits a quarter. This is the piece's real marginal
 * contribution to a COMPLETED set, not the set's full bonus — the same
 * amortised amount applies whether the piece is real or the ideal, so the
 * coverage ratio stays honest about roll quality rather than rewarding set
 * membership outright.
 *
 * `GearSetName` also covers implant names (`ImplantName`), and one key,
 * `AMBUSH`, exists in both `GEAR_SETS` and `IMPLANTS` with different stats —
 * so this gates on `slot` being a real gear slot (`GEAR_SLOTS`, never an
 * `implant_*` slot) before it will touch `GEAR_SETS`, not just on the name
 * resolving to something. A set naming anything else not in `GEAR_SETS`, or
 * a `GEAR_SETS` entry with no `stats` (several set names describe a
 * proc/passive with no stat payload — see `gearSets.ts`), contributes
 * nothing.
 */
function addSetBonusShare(
    setBonus: GearSetName | null,
    slot: GearSlotName,
    target: BaseStats,
    reference: BaseStats
): void {
    if (!setBonus) return;
    if (!(slot in GEAR_SLOTS)) return;
    const set = GEAR_SETS[setBonus];
    if (!set?.stats?.length) return;

    const minPieces = set.minPieces || 2;
    for (const stat of set.stats) {
        addStat({ ...stat, value: stat.value / minPieces }, target, reference);
    }
}

/**
 * How much this piece raises the role's dummy baseline score.
 *
 * Deliberately NOT the dummy path in potentialCalculator: that one rebaselines
 * crit to `100 - the piece's own crit`, which is fair for a within-piece
 * before/after delta and useless across pieces (it neutralises crit entirely).
 *
 * Calibration is excluded: it is bound to one specific ship, and this scoring
 * is role-generic. The set bonus is credited at its amortised share — see
 * `addSetBonusShare`.
 */
export function scorePieceForRole(piece: GearPiece, role: ShipTypeName): number {
    const baseline = getBaseRoleStats(role);
    const withPiece: BaseStats = { ...baseline };

    if (piece.mainStat) addStat(piece.mainStat, withPiece, baseline);
    for (const sub of piece.subStats ?? []) addStat(sub, withPiece, baseline);
    addSetBonusShare(piece.setBonus, piece.slot, withPiece, baseline);

    return calculateRoleScore(role, withPiece) - getBaselineScore(role);
}

function makeStat(name: StatName, type: StatType, value: number): Stat {
    return type === 'percentage'
        ? { name, value, type: 'percentage' }
        : { name: name as FlexibleStats, value, type: 'flat' };
}

/**
 * Every type `statName` can legally roll as THIS slot's main stat.
 *
 * Percentage-only stats (crit, critDamage, ...) are always percentage.
 * `hacking`, `security` and `speed` are always flat as a MAIN stat, on every
 * slot that can carry them: no real inventory sample has ever produced a
 * percentage-typed one, `SUBSTAT_RANGES` (the same table `candidateSubstatPairs`
 * reads) has no `percentage` key for any of the three, and `calculateMainStatValue`
 * sends them through their own flat-magnitude tables (`HACK_SEC_STATS`,
 * `SPD_STATS`) — marking one percentage here would route it into
 * `PERCENTAGE_STATS` instead, which holds a magnitude for a different stat
 * family.
 *
 * Every other flexible stat (hp, attack, defence) rolls flat-only on the
 * three fixed slots (weapon, hull, generator) — real inventories never show
 * a percentage main stat there, matching each of those slots offering only
 * its own single stat name. On the three flexible slots (sensor, software,
 * thrusters) real inventories show BOTH types for the same (slot, name): a
 * software `hp:percentage` piece and a software `hp:flat` piece both exist.
 * So there both types are legal candidates and the ideal search tries both,
 * keeping whichever scores higher for the role — the same way it already
 * tries every legal (name, type) substat pair.
 */
export function mainStatTypesForSlot(slot: GearSlotName, statName: StatName): StatType[] {
    if (PERCENTAGE_ONLY_STATS.includes(statName as PercentageOnlyStats)) return ['percentage'];
    if (statName === 'hacking' || statName === 'security' || statName === 'speed') return ['flat'];
    if (slot === 'weapon' || slot === 'hull' || slot === 'generator') return ['flat'];
    return ['flat', 'percentage'];
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
 * Is `name` PREFERRED for `role`: does adding a large amount of it (any legal
 * type) to `role`'s bare baseline (no main stat, no set, no other substats)
 * change its role score by more than a small epsilon (`1e-9`)? This is the
 * derived stand-in for a hardcoded preferred-stats table (do not add one —
 * `DESIRED_STATS` in `gearSuggestions.ts` covers only a subset of `ShipTypeName`
 * and would silently mis-rank every role it omits): every real stat block a piece can ever
 * produce is `baseline` plus a sum of non-negative additions (main stat, set
 * share, substats — see `addStat`/`scorePieceForRole`), and every
 * `calculateRoleScore` formula is non-decreasing in every stat name it reads
 * (more attack/crit/hacking/... never lowers a role's score). So a name that
 * cannot move the score off the bare floor cannot move it off any RICHER
 * prefix either — this probe at the floor is safe to reuse for every
 * (mainStat, set) combination a search considers, not just the one it
 * happened to run against.
 *
 * The probe amount is the largest a single legendary substat slot can ever
 * reach: `(1 + LEGENDARY_SUBSTAT_INCREASES)` times its single-roll max, the
 * same ceiling `computeIdealSubstats` itself builds candidate stats from.
 */
function isNameLiveForRole(role: ShipTypeName, name: StatName): boolean {
    const baseline = getBaseRoleStats(role);
    const baselineScore = calculateRoleScore(role, baseline);
    for (const type of Object.keys(SUBSTAT_RANGES[name]) as StatType[]) {
        const max = SUBSTAT_RANGES[name][type].legendary.max;
        const probeValue = (1 + LEGENDARY_SUBSTAT_INCREASES) * max;
        const withProbe: BaseStats = { ...baseline };
        addStat(makeStat(name, type, probeValue), withProbe, baseline);
        if (Math.abs(calculateRoleScore(role, withProbe) - baselineScore) > 1e-9) return true;
    }
    return false;
}

/**
 * Per-role: every PREFERRED `SUBSTAT_RANGES` name — see `isNameLiveForRole`.
 * This is what keeps the substat combination search small (a role formula
 * reads only a handful of stat names, e.g. ATTACKER: attack/crit/critDamage,
 * so most of the 8 substat names are dead weight for it and never need to
 * enter the combination search at all) AND, since `computeIdealSubstats`,
 * what the MEAN half of the ceiling is averaged over: only allocations built
 * from these names count as "every roll in a preferred stat".
 */
const liveSubstatNamesByRole = new Map<ShipTypeName, Set<StatName>>();

function liveSubstatNamesFor(role: ShipTypeName): Set<StatName> {
    const cached = liveSubstatNamesByRole.get(role);
    if (cached) return cached;

    const live = new Set<StatName>();
    for (const name of Object.keys(SUBSTAT_RANGES) as StatName[]) {
        if (isNameLiveForRole(role, name)) live.add(name);
    }
    liveSubstatNamesByRole.set(role, live);
    return live;
}

/**
 * Every (name, type) PREFERRED pair legal as a substat for `role` — see
 * `isNameLiveForRole` for what "preferred" means — excluding only the
 * piece's own main stat (name, type) — the exact rule `GearPieceForm`
 * enforces (`excludedStats={[{ name: mainStat.name, type: mainStat.type }]}`).
 * The OTHER type variant of the main stat's own name stays selectable: an
 * `attack`-flat weapon main stat can still carry an `attack`-percentage
 * substat, and both may sit on the same piece as two of its four slots.
 *
 * Restricted to `liveSubstatNamesFor(role)`: a dead name would only ever tie
 * (never beat) a live one for a combination slot, so dropping it from the
 * search cannot change the best reachable score — see `isNameLiveForRole`.
 * When fewer than `LEGENDARY_SUBSTAT_SLOTS` live pairs remain, the ideal
 * piece necessarily carries a dead filler substat in its remaining slot(s)
 * (a real piece always has exactly `LEGENDARY_SUBSTAT_SLOTS` substats), but
 * that filler's identity cannot affect the score, so `computeIdealSubstats`
 * does not need to search which dead pair fills it.
 */
function candidateSubstatPairs(
    role: ShipTypeName,
    mainStat: Stat | null
): { name: StatName; type: StatType }[] {
    const live = liveSubstatNamesFor(role);
    const pairs: { name: StatName; type: StatType }[] = [];
    for (const name of Object.keys(SUBSTAT_RANGES) as StatName[]) {
        if (!live.has(name)) continue;
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
 * Does giving `role`'s baseline the WHOLE (un-amortised) `stats` of a set
 * change its role score at all? `ROLE_BASE_STATS` already carries realistic,
 * non-zero values for every stat name a role's formula actually reads (e.g.
 * DEFENDER's non-zero `security` baseline) — a name the formula never reads
 * cannot become "live" only because some OTHER gear also touches it. Proven
 * directly for a role like ATTACKER, whose score is `calculateDPS`, a
 * function of exactly attack/crit/critDamage/defensePenetration and nothing
 * else (`priorityScore.ts`) — every other stat name is provably inert for it
 * regardless of what carries it.
 */
function isSetLiveForRole(role: ShipTypeName, setName: GearSetName): boolean {
    const set = GEAR_SETS[setName];
    if (!set?.stats.length) return false;
    const baseline = getBaseRoleStats(role);
    const withSet: BaseStats = { ...baseline };
    for (const stat of set.stats) addStat(stat, withSet, baseline);
    return Math.abs(calculateRoleScore(role, withSet) - calculateRoleScore(role, baseline)) > 1e-9;
}

/**
 * Per-role: `null` (no set) plus every `GEAR_SETS` name that can possibly
 * move this role's score — see `isSetLiveForRole`. Pruning the obviously-dead
 * sets per role (e.g. FORTITUDE's pure `hp` bonus for ATTACKER) is what keeps
 * the (mainStat x set x substat-combo) ideal search below tractable: without
 * it, every one of the ~20 non-empty sets multiplies the whole substat search
 * for every role, most of which cannot possibly change that role's score.
 */
const idealSetCandidatesByRole = new Map<ShipTypeName, (GearSetName | null)[]>();

function idealSetCandidatesFor(role: ShipTypeName): (GearSetName | null)[] {
    const cached = idealSetCandidatesByRole.get(role);
    if (cached) return cached;

    const liveNames = Object.keys(GEAR_SETS).filter((name) => isSetLiveForRole(role, name));
    const candidates: (GearSetName | null)[] = [null, ...liveNames];
    idealSetCandidatesByRole.set(role, candidates);
    return candidates;
}

/**
 * The exhaustive level-16, 6-star legendary substat search for `role`, given
 * the slot's chosen `mainStat` and `setBonus`: both the MAX-scoring
 * allocation (`maxStats`/`maxScore` — the true ceiling, used only as
 * `computePriority`'s true-impossibility guard) and the MEAN score
 * (`meanScore`) over every allocation this search considers.
 *
 * The mean, not the max, is what `getIdealMarginal` divides by. A single
 * fixed best-in-slot composition adjudicates a trade-off (e.g. crit rate vs.
 * crit damage) that this per-slot search has no visibility into: which one
 * is actually best depends on what the OTHER five gear pieces and five
 * implants already supply (a crit-rate roll is worth a lot 20 points short
 * of the 100 crit cap and worth nothing once capped) — see #473. Averaging
 * over every allocation this search tries treats every one of those
 * trade-offs as equally live, rather than picking a winner the model has no
 * basis to pick. A real piece scoring above the mean is normal, not a
 * defect — only the max, a true ceiling, can never legally be beaten.
 *
 * Exhaustive over live pairs, not greedy: every `slotCount`-combination of
 * `candidateSubstatPairs` (already pruned to PREFERRED pairs — (name, type)
 * candidates that measurably move `role`'s score off its baseline, see
 * `isNameLiveForRole` — and capped at `LEGENDARY_SUBSTAT_SLOTS`), crossed
 * with every way to distribute `LEGENDARY_SUBSTAT_INCREASES` upgrade rolls
 * across those slots, is assembled into a full piece (carrying `setBonus`,
 * credited at its amortised share via `scorePieceForRole`) and scored; both
 * the maximum and the running mean are kept from this SAME pass, so the mean
 * costs nothing extra to compute and the search never runs twice. A greedy
 * per-slot assignment is not provably exact here — several role formulas
 * read crit x critDamage or an effective-HP product, so a roll's marginal
 * value on one slot depends on what already sits in the others, including
 * what the set bonus already contributes; only the DEAD-pair pruning above
 * is provably order-independent (see `isNameLiveForRole`).
 * `roleSlotCoverage.test.ts`'s "the ideal is a true ceiling" property test is
 * what would catch a shortfall against a legal piece this search failed to
 * try (checked against `maxScore`, the only quantity a real piece can never
 * legally exceed).
 *
 * A role with fewer than `LEGENDARY_SUBSTAT_SLOTS` preferred pairs (e.g.
 * `calculateCorrosionDebufferScore` reads `hacking` alone) still describes a
 * real piece, which always carries exactly `LEGENDARY_SUBSTAT_SLOTS`
 * substats: `slotCount = min(pairs.length, LEGENDARY_SUBSTAT_SLOTS)` fills
 * only the preferred slots and leaves the remainder unfilled here, because
 * ANY non-preferred filler substat scores identically — 0 marginal, by
 * definition of "preferred" (see `candidateSubstatPairs`). Both the mean and
 * the max are computed over this same reduced search, so neither is diluted
 * by having to pick which dead pair fills the leftover slot(s).
 */
function computeIdealSubstats(
    role: ShipTypeName,
    mainStat: Stat | null,
    setBonus: GearSetName | null
): { maxStats: Stat[]; maxScore: number; meanScore: number } {
    const pairs = candidateSubstatPairs(role, mainStat);

    // Fewer live pairs than substat slots: every slot is dead filler (see
    // `candidateSubstatPairs`), so the score is just the bare main
    // stat + set piece — no combination or roll search needed, and mean
    // trivially equals max (there is only one allocation to average).
    if (pairs.length === 0) {
        const piece: GearPiece = {
            id: 'ideal-candidate',
            slot: 'weapon',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat,
            subStats: [],
            setBonus,
        };
        const score = scorePieceForRole(piece, role);
        return { maxStats: [], maxScore: score, meanScore: score };
    }

    const slotCount = Math.min(pairs.length, LEGENDARY_SUBSTAT_SLOTS);
    const combos = combinations(pairs, slotCount);
    const rollDistributions = distributeRolls(LEGENDARY_SUBSTAT_INCREASES, slotCount);

    let maxStats: Stat[] = [];
    let maxScore = -Infinity;
    let sum = 0;
    let count = 0;
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
                setBonus,
            };
            const score = scorePieceForRole(piece, role);
            if (score > maxScore) {
                maxScore = score;
                maxStats = stats;
            }
            sum += score;
            count += 1;
        }
    }
    return { maxStats, maxScore, meanScore: count > 0 ? sum / count : 0 };
}

/**
 * Memoised `computeIdealSubstats`, keyed on (role, mainStat name+type+value,
 * setBonus) rather than (role, slot, ...): `calculateMainStatValue` ignores
 * slot, so the same (name, type) main stat option recurs across slots (e.g.
 * `attack` percentage is legal on sensor, software AND thrusters) and would
 * otherwise re-run this exhaustive search once per slot that offers it.
 */
const idealSubstatsCache = new Map<
    string,
    { maxStats: Stat[]; maxScore: number; meanScore: number }
>();

function pickIdealSubstats(
    role: ShipTypeName,
    mainStat: Stat | null,
    setBonus: GearSetName | null
): { maxStats: Stat[]; maxScore: number; meanScore: number } {
    const mainStatKey = mainStat ? `${mainStat.name}:${mainStat.type}:${mainStat.value}` : 'none';
    const key = `${role}:${mainStatKey}:${setBonus ?? 'none'}`;
    const cached = idealSubstatsCache.get(key);
    if (cached) return cached;

    const result = computeIdealSubstats(role, mainStat, setBonus);
    idealSubstatsCache.set(key, result);
    return result;
}

/**
 * The MEAN score (see `computeIdealSubstats`) for the ideal piece — the
 * metric's actual ceiling, what `computePriority` divides by. <= 0 means
 * nothing this slot can carry helps this role.
 */
type IdealMarginal = number;

/**
 * An ideal piece's composition, for display: the mainStat/subStats/setBonus
 * of the MAX-scoring allocation found for (role, slot) — a mean has no
 * single composition to show, so this shows the nearest concrete piece,
 * the true ceiling.
 *
 * `score` is the MEAN of every allocation the search considered for this
 * same (mainStat, setBonus) — this is `getIdealMarginal`'s return value, the
 * figure the coverage grid actually divides by. `maxScore` is the MAX for
 * the same combo — `getIdealMaxGuard`'s return value, a true impossibility
 * ceiling used only by `computePriority`'s tripwire, never by the coverage
 * math itself. `maxScore >= score` always: the mean can never exceed the
 * max of the same set of allocations it averages.
 */
export interface IdealPieceComposition {
    mainStat: Stat | null;
    subStats: Stat[];
    setBonus: GearSetName | null;
    score: number;
    maxScore: number;
}

/**
 * (role, slot) never changes, so the ideal piece — composition and score
 * together — is computed once and cached. `getIdealMarginal` and
 * `describeIdealPiece` both read THIS map, never `pickIdealPiece` directly,
 * so a score and a composition read for the same (role, slot) can never come
 * from two different searches.
 */
const idealPieceCache = new Map<string, IdealPieceComposition>();

function getCachedIdealPiece(role: ShipTypeName, slot: GearSlotName): IdealPieceComposition {
    const key = `${role}:${slot}`;
    const cached = idealPieceCache.get(key);
    if (cached) return cached;

    const piece = pickIdealPiece(role, slot);
    idealPieceCache.set(key, piece);
    return piece;
}

/**
 * The best-scoring level-16, 6-star legendary piece this slot can carry for
 * `role`: every main stat this slot can carry, in every legal type variant
 * (see `mainStatTypesForSlot`), crossed with every set
 * `idealSetCandidatesFor(role)` returns live, crossed with
 * `pickIdealSubstats`' own exhaustive substat search for that (main stat,
 * set) pair, is scored, and the combo with the highest MAX kept — main stat
 * and set stay a max, a deliberate choice a player makes when picking a
 * piece, unlike the four substat ROLLS a player does not choose (see
 * `computeIdealSubstats`). Main stat, set and substats are searched jointly,
 * not main-stat-first-then-substats: two candidates can tie (or nearly tie)
 * on their own bare marginal while differing sharply once a real substat
 * block sits on top of them (e.g. a role that reads one stat multiplicatively
 * against a common one), so picking any one of them in isolation can strand
 * the search on the wrong branch. A real piece carrying whichever set wins
 * here cannot score higher than `best.maxScore`: it is the same amortised
 * share, added through the same `scorePieceForRole`.
 *
 * The winning combo's `meanScore` (from the SAME `pickIdealSubstats` call,
 * not a second search) becomes `getIdealMarginal`'s return value — see
 * `IdealPieceComposition`'s doc for why `score` and `maxScore` diverge.
 */
function pickIdealPiece(role: ShipTypeName, slot: GearSlotName): IdealPieceComposition {
    let best: IdealPieceComposition | null = null;
    for (const name of GEAR_SLOTS[slot].availableMainStats) {
        for (const type of mainStatTypesForSlot(slot, name)) {
            const mainStat = makeStat(
                name,
                type,
                calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL)
            );
            for (const setBonus of idealSetCandidatesFor(role)) {
                const { maxStats, maxScore, meanScore } = pickIdealSubstats(
                    role,
                    mainStat,
                    setBonus
                );
                if (!best || maxScore > best.maxScore) {
                    best = { mainStat, subStats: maxStats, setBonus, score: meanScore, maxScore };
                }
            }
        }
    }
    if (best) return best;
    const { maxStats, maxScore, meanScore } = pickIdealSubstats(role, null, null);
    return { mainStat: null, subStats: maxStats, setBonus: null, score: meanScore, maxScore };
}

export function getIdealMarginal(role: ShipTypeName, slot: GearSlotName): IdealMarginal {
    return getCachedIdealPiece(role, slot).score;
}

/**
 * The MAX score (see `computeIdealSubstats`) for (role, slot)'s ideal piece —
 * a true ceiling no legal real piece can exceed. Used ONLY as
 * `computePriority`'s tripwire guard: the coverage math itself divides by
 * `getIdealMarginal` (the mean), never by this.
 */
export function getIdealMaxGuard(role: ShipTypeName, slot: GearSlotName): number {
    return getCachedIdealPiece(role, slot).maxScore;
}

/**
 * The composition of the level-16, 6-star legendary piece the coverage grid
 * shows for (role, slot): its main stat, its four substats at their FINAL
 * values (base roll plus whatever upgrade-roll increases `computeIdealSubstats`
 * awarded them) for the MAX-scoring allocation, its set bonus (`null` if none
 * beats carrying nothing), and both scores. The metric's actual ceiling —
 * what `getIdealMarginal(role, slot)` returns and the grid divides by — is
 * `.score`, the MEAN over every allocation the search considered for this
 * combo; a mean has no single composition, so this shows the MAX allocation
 * instead (`.maxScore`, `getIdealMaxGuard`'s return value) as the nearest
 * concrete piece. `.score` here and `getIdealMarginal(role, slot)` can never
 * disagree — both read `getCachedIdealPiece`.
 */
export function describeIdealPiece(role: ShipTypeName, slot: GearSlotName): IdealPieceComposition {
    return getCachedIdealPiece(role, slot);
}

/**
 * Test-only: clear every module-scope cache this file's ideal-piece search
 * populates, so the next `buildCoverageMatrix`/`getIdealMarginal` call is
 * genuinely cold. All of these caches are keyed on data that never changes
 * within a process (role base stats, gear sets, substat ranges), so nothing
 * outside a test needs to call this.
 */
export function resetIdealPieceCachesForTests(): void {
    baselineScoreByRole.clear();
    liveSubstatNamesByRole.clear();
    idealSetCandidatesByRole.clear();
    idealSubstatsCache.clear();
    idealPieceCache.clear();
}

/** `stat` as `name value` with a `%` suffix for a percentage stat, bare for flat. `null` prints as `none`. */
function formatStat(stat: Stat | null): string {
    if (!stat) return 'none';
    return `${stat.name} ${stat.value}${stat.type === 'percentage' ? '%' : ''}`;
}

/** An ideal piece's composition as one clause, for the `computePriority` tripwire message. */
function formatIdealComposition(piece: IdealPieceComposition): string {
    const subStats = piece.subStats.length ? piece.subStats.map(formatStat).join(', ') : 'none';
    return `main ${formatStat(piece.mainStat)}, subs [${subStats}], set ${piece.setBonus ?? 'none'}`;
}

/**
 * How much of this (role, slot)'s ceiling the player's owned pieces cover,
 * in [0, 1], as `1 - priority`.
 *
 * `idealMarginal` is the MEAN marginal — see `computeIdealSubstats` — over
 * every legal level-16, 6-star legendary substat allocation this slot's
 * best-for-role main stat and set can carry, restricted to allocations that
 * put every roll into one of the role's preferred stats. Comparing every
 * player's pieces against the same ceiling, rather than against each other,
 * is what makes roles comparable: a role whose score formula reads a rare
 * stat and a role that reads common ones are no longer judged by how bunched
 * their own top pieces are.
 *
 * The mean is over the top `sampleSize` marginals (default `COVERAGE_SAMPLE_SIZE`),
 * zero-padded up to that size — not divided by however many pieces exist.
 * Owning fewer pieces than `sampleSize` must not inflate the average: a
 * single max-roll piece is not "N max-roll pieces sampled once", it is 1 real
 * value and N-1 unfarmed slots.
 *
 * A real marginal above `idealMarginal` (the mean) is NORMAL and expected —
 * a real piece is one specific allocation, and a good one routinely beats
 * the average of all the allocations the mean spans — so it is not checked
 * here. `Math.min(1, Math.max(0, 1 - coverage))` below is what turns that
 * legitimate overshoot into a plain 0% priority, and that clamp is
 * load-bearing, not a guard against model error.
 *
 * `idealMaxGuard` (default `idealMarginal`, so a caller testing pure
 * coverage math need not pass one) is the TRUE ceiling — see
 * `getIdealMaxGuard` — no legal real piece can ever exceed it. A real
 * marginal above it is a genuine impossibility: the ideal-piece search
 * failed to try some legal allocation. Non-production throws so that defect
 * is loud; production only logs and lets the clamp degrade, matching
 * `scorePieceUpgrade.ts`'s missing-baseline pattern.
 */
export function computePriority(
    marginals: number[],
    idealMarginal: number,
    sampleSize: number = COVERAGE_SAMPLE_SIZE,
    context?: { role: ShipTypeName; slot: GearSlotName },
    idealMaxGuard: number = idealMarginal
): number {
    if (idealMarginal <= 0) return 0;

    const exceedingMarginal = marginals.find((marginal) => marginal > idealMaxGuard);
    if (exceedingMarginal !== undefined) {
        const where = context ? ` for ${context.role}/${context.slot}` : '';
        const idealComposition = context
            ? ` — ideal was ${formatIdealComposition(describeIdealPiece(context.role, context.slot))}`
            : '';
        const message =
            `computePriority: a real marginal (${exceedingMarginal}) exceeds the max-allocation ` +
            `guard (${idealMaxGuard})${where}${idealComposition} — the ideal-piece model failed ` +
            `to try some legal allocation that beats it.`;
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
export const TIE_EPSILON = 1e-9;

/**
 * Competition ranking ("1,1,1,4,..."): items with an equal `value` share the
 * same rank, and the next distinct value's rank skips ahead by the number of
 * items tied ahead of it. Highest `value` gets rank 1. `order` only decides
 * which equal-valued item is treated as "first" while building the ranking —
 * it never changes a rank number.
 *
 * Each item is compared against the value that opened its tie group, not its
 * immediate predecessor — comparing only pairwise-adjacent items lets a run
 * of small steps chain past `TIE_EPSILON` (e.g. `5`, `5 + 0.75 * TIE_EPSILON`,
 * `5 + 1.5 * TIE_EPSILON` would all merge into one rank even though the first
 * and last differ by more than the epsilon).
 */
export function competitionRank<T>(
    items: readonly T[],
    value: (item: T) => number,
    order: readonly T[]
): Map<T, number> {
    const sorted = [...items].sort(compareByThenOrder((item) => -value(item), order));
    const ranks = new Map<T, number>();
    let groupStart: T | undefined;
    sorted.forEach((item, index) => {
        const tiedWithGroupStart =
            groupStart !== undefined && Math.abs(value(groupStart) - value(item)) <= TIE_EPSILON;
        if (!tiedWithGroupStart) {
            groupStart = item;
        }
        ranks.set(item, tiedWithGroupStart ? (ranks.get(groupStart as T) as number) : index + 1);
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
            const idealMaxGuard = getIdealMaxGuard(role, slot);
            cells[role][slot] = {
                role,
                slot,
                count: pieces.length,
                priority: computePriority(
                    marginals,
                    idealMarginal,
                    sampleSize,
                    { role, slot },
                    idealMaxGuard
                ),
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
