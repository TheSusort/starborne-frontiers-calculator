import { BaseStats, LimitableStat } from '../../types/stats';

// Defense reduction curve approximation based on the graph
export function calculateDamageReduction(defense: number): number {
    const a = 88.3505;
    const b = 4.5552;
    const c = 1.3292;

    return a * Math.exp(-Math.pow((b - Math.log10(defense)) / c, 2));
}

export function calculateEffectiveHP(
    hp: number,
    defense: number,
    damageReductionPercent: number = 0
): number {
    const defenseReduction = calculateDamageReduction(defense);
    // Calculate effective HP from HP and defence-based damage reduction
    const effectiveHpFromDefense = hp * (100 / (100 - defenseReduction));
    // Apply damageReduction stat (from gear/refits) as a separate multiplier
    return effectiveHpFromDefense * (1 + damageReductionPercent / 100);
}

/**
 * Resolve a `LimitableStat` for a build, for use as a priority limit or a stat bonus.
 * Base stats pass through; derived stats (effectiveHp, directDamage) are computed from the
 * build's stats on the fly.
 */
export function resolveLimitStatValue(stats: BaseStats, stat: LimitableStat): number {
    if (stat === 'effectiveHp') {
        return calculateEffectiveHP(stats.hp, stats.defence, stats.damageReduction ?? 0);
    }
    if (stat === 'directDamage') {
        return calculateDirectDamage(stats);
    }
    return stats[stat] || 0;
}

// Defense penetration lookup table with known values at 15k defense
const DEFENSE_PENETRATION_LOOKUP: Record<number, number> = {
    0: 81.45,
    7: 80.31,
    14: 79,
    20: 77.72,
    21: 77.49,
    27: 76,
    34: 74,
    41: 71.66,
};

// Default defense value for calculations
const DEFAULT_DEFENSE = 15000;

export function calculateDPS(stats: BaseStats, arcaneSiegeMultiplier: number = 0): number {
    const attack = stats.attack || 0;
    const critMultiplier = calculateCritMultiplier(stats);
    const defensePenetration = stats.defensePenetration || 0;

    // Get damage reduction from lookup table or calculate it
    let damageReduction: number;
    if (DEFENSE_PENETRATION_LOOKUP[defensePenetration] !== undefined) {
        damageReduction = DEFENSE_PENETRATION_LOOKUP[defensePenetration];
    } else {
        // Fallback to full calculation for unknown values
        const effectiveDefense = DEFAULT_DEFENSE * (1 - defensePenetration / 100);
        damageReduction = calculateDamageReduction(effectiveDefense);
    }

    // Calculate base DPS with damage reduction
    const baseDPS = attack * critMultiplier * (1 - damageReduction / 100);

    // Apply Arcane Siege multiplier if applicable (multiplier is a percentage, e.g., 20 for 20%)
    if (arcaneSiegeMultiplier > 0) {
        return baseDPS * (1 + arcaneSiegeMultiplier / 100);
    }

    return baseDPS;
}

/**
 * The offensive twin of `calculateEffectiveHP`: one number combining attack, crit rate,
 * crit power and defense penetration, for use as the `directDamage` derived stat.
 *
 * Deliberately omits `arcaneSiegeMultiplier`. That is gear-set dependent, and a derived
 * stat is resolved from a stat block alone — the same reason `calculateRoleScore` takes no
 * set params.
 */
export function calculateDirectDamage(stats: BaseStats): number {
    return calculateDPS(stats);
}

export function calculateCritMultiplier(stats: BaseStats): number {
    const crit = stats.crit >= 100 ? 1 : stats.crit / 100;
    return 1 + (crit * (stats.critDamage || 0)) / 100;
}

// Normalizers for multiplier mode so that 50% means roughly
// "this stat weighs about as much as the base role score"
// regardless of the stat's raw value range.
//
// Each entry sits at roughly the stat's GEARED value, not its bare-chassis value
// (attack 10,000 against a bare 6,250; hp 50,000 against a bare 22,000). The two derived
// entries follow the same reading — `derivedStatBonuses.test.ts` pins them.
//
// Keyed `LimitableStat`, not `keyof BaseStats`, so derived stats are expressible. It must
// stay a `Partial<Record<LimitableStat, …>>` — a `Record<string, number>` would drop the
// compile-time key check.
export const MULTIPLIER_NORMALIZERS: Partial<Record<LimitableStat, number>> = {
    hp: 50000,
    attack: 10000,
    defence: 7000,
    hacking: 200,
    security: 75,
    crit: 80,
    critDamage: 130,
    speed: 130,
    effectiveHp: 120000,
    directDamage: 6000,
    // Neither stat rolls on a slot, so its geared value is what the sets grant. Heal
    // modifier: Repair's 20% plus Recovery's 10%. Shield regen: 4% per Shield set
    // activation, and a set activates per whole `minPieces`, so a four-piece build reaches
    // exactly 8 — the achievable values are 0, 4, 8 and 12, never a figure between them.
    healModifier: 30,
    shield: 8,
};
