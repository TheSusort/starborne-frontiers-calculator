import type { RarityName } from '../constants/rarities';
import {
    ABYSSAL_LEVEL,
    BOUNTY_LEVELS,
    Bounty,
    BountyDrop,
    BountyLevel,
    StarRank,
} from '../constants/bounties';

/** In-game sell price = BASE × star factor × rarity factor (fits every observed price exactly). */
const BASE_SELL_PRICE = 2700;
const STAR_PRICE_FACTOR: Record<StarRank, number> = { 1: 0.6, 2: 0.8, 3: 1, 4: 1.4, 5: 2, 6: 2.8 };
const RARITY_PRICE_FACTOR: Record<RarityName, number> = {
    common: 0.75,
    uncommon: 5 / 6,
    rare: 11 / 12,
    epic: 0.95,
    legendary: 1,
};

export function gearSellPrice(stars: StarRank, rarity: RarityName): number {
    return Math.round(BASE_SELL_PRICE * STAR_PRICE_FACTOR[stars] * RARITY_PRICE_FACTOR[rarity]);
}

export function setsAtLevel(bounty: Bounty, level: number): string[] {
    return level >= ABYSSAL_LEVEL ? [...bounty.sets, bounty.abyssalSet] : bounty.sets;
}

export function availableLevels(bounty: Bounty): BountyLevel[] {
    return BOUNTY_LEVELS.filter((l) => l.level < ABYSSAL_LEVEL || bounty.abyssalAvailable);
}

export interface SellRules {
    /** Auto-sell star ranks (in-game filter). */
    stars: number[];
    /** Auto-sell rarities (in-game filter). */
    rarities: RarityName[];
    /** Sets the player always sells. */
    sets: string[];
    /** Percent of the remaining gear the player sells anyway. */
    generalSellPct: number;
}

/** In-game auto-sell is an OR filter: matching star rank OR rarity sells; so does a dumped set. */
export function isAutoSold(drop: BountyDrop, set: string, rules: SellRules): boolean {
    return (
        rules.stars.includes(drop.stars) ||
        rules.rarities.includes(drop.rarity) ||
        rules.sets.includes(set)
    );
}

export type RankMetric = 'run' | 'energy' | 'minute';

export interface LevelResult {
    level: number;
    energy: number;
    fixedCredits: number;
    /** Expected credits per run from selling gear. */
    saleCredits: number;
    total: number;
    perEnergy: number;
    /** Null when no fight duration is known. */
    perMinute: number | null;
    keptGearPerRun: number;
}

/** Credit bonuses (`extraCreditsPct`) scale the fixed bounty credits only, never gear sales. */
export function evaluateLevel(
    level: BountyLevel,
    bounty: Bounty,
    rules: SellRules,
    extraCreditsPct: number,
    secondsPerFight: number | null,
    overheadSeconds: number
): LevelResult {
    const sets = setsAtLevel(bounty, level.level);
    const generalSell = rules.generalSellPct / 100;
    let saleCredits = 0;
    let keptGearPerRun = 0;
    for (const drop of level.drops) {
        const pSold =
            sets.reduce((s, set) => s + (isAutoSold(drop, set, rules) ? 1 : generalSell), 0) /
            (sets.length || 1);
        const pDrop = drop.chance / 100;
        saleCredits += pDrop * pSold * gearSellPrice(drop.stars, drop.rarity);
        keptGearPerRun += pDrop * (1 - pSold);
    }
    const fixedCredits = Math.round(level.credits * (1 + extraCreditsPct / 100));
    const total = fixedCredits + saleCredits;
    const cycleSeconds =
        secondsPerFight && secondsPerFight > 0 ? secondsPerFight + overheadSeconds : 0;
    return {
        level: level.level,
        energy: level.energy,
        fixedCredits,
        saleCredits,
        total,
        perEnergy: total / level.energy,
        perMinute: cycleSeconds > 0 ? (total * 60) / cycleSeconds : null,
        keptGearPerRun,
    };
}

export function metricValue(r: LevelResult, metric: RankMetric): number | null {
    if (metric === 'run') return r.total;
    if (metric === 'energy') return r.perEnergy;
    return r.perMinute;
}

export function bestLevels(results: LevelResult[], metric: RankMetric): LevelResult[] {
    return results
        .filter((r) => metricValue(r, metric) !== null)
        .sort((a, b) => (metricValue(b, metric) as number) - (metricValue(a, metric) as number));
}
