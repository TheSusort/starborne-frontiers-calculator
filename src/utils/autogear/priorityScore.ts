import { BaseStats } from '../../types/stats';
import { CustomFormula, StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName, GEAR_SETS } from '../../constants';
import { ENEMY_ATTACK, ENEMY_COUNT, BASE_HEAL_PERCENT } from '../../constants/simulation';
import {
    calculateEffectiveHP,
    calculateCritMultiplier,
    calculateDPS,
    resolveLimitStatValue,
    MULTIPLIER_NORMALIZERS,
} from './statResolution';
import { customFormulaScore } from './customFormula';

export {
    calculateDamageReduction,
    calculateEffectiveHP,
    calculateCritMultiplier,
    calculateDirectDamage,
    resolveLimitStatValue,
    MULTIPLIER_NORMALIZERS,
} from './statResolution';

export function calculateHealingPerHit(stats: BaseStats): number {
    return (stats.hp || 0) * ((stats.hpRegen || 0) / 100) * calculateCritMultiplier(stats);
}

export function applyAdditiveBonuses(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 0;
    return statBonuses.reduce((total, bonus) => {
        if (bonus.mode === 'multiplier') return total;
        const statValue = resolveLimitStatValue(stats, bonus.stat);
        return total + statValue * (bonus.percentage / 100);
    }, 0);
}

// Returns the normalized multiplier sum from multiplier bonuses.
// Returns 0 when no multiplier bonuses exist.
// Used as: (baseScore + additiveBonus) * (1 + multiplierFactor)
// The (1 + ...) ensures the percentage controls the trade-off:
//   low % → base role score dominates; high % → stat weighs heavily
export function calculateMultiplierFactor(stats: BaseStats, statBonuses?: StatBonus[]): number {
    if (!statBonuses || statBonuses.length === 0) return 0;
    const multiplierBonuses = statBonuses.filter((b) => b.mode === 'multiplier');
    if (multiplierBonuses.length === 0) return 0;
    return multiplierBonuses.reduce((total, bonus) => {
        const statValue = resolveLimitStatValue(stats, bonus.stat);
        const normalizer = MULTIPLIER_NORMALIZERS[bonus.stat] || 1;
        return total + (statValue / normalizer) * (bonus.percentage / 100);
    }, 0);
}

function calculateAttackerScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const baseDPS = calculateDPS(stats, arcaneSiegeMultiplier);

    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (baseDPS + additiveBonus) * (1 + multiplierFactor);
}

function calculateDefenderScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const totalEffectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    // Calculate incoming damage per round
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;

    // Calculate healing and shield per round
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;

    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;

    // Calculate survival rounds
    if (healingWithShieldPerRound >= damagePerRound) {
        return Math.min(
            (Number.MAX_SAFE_INTEGER + additiveBonus) * (1 + multiplierFactor),
            Number.MAX_SAFE_INTEGER
        );
    }

    const survivalRounds = totalEffectiveHP / (damagePerRound - healingWithShieldPerRound);
    return Math.max((survivalRounds * 1000 + additiveBonus) * (1 + multiplierFactor), 0);
}

function calculateDefenderSecurityScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseDefenderScore = calculateDefenderScore(stats, statBonuses);
    const security = stats.security || 0;

    return baseDefenderScore * security;
}

function calculateDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    const dps = calculateDPS(stats, arcaneSiegeMultiplier);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    return (hacking * dps + additiveBonus) * (1 + multiplierFactor);
}

function calculateDefensiveDebufferScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const hacking = stats.hacking || 0;
    const effectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * effectiveHP + additiveBonus) * (1 + multiplierFactor);
}

function calculateDefensiveSecurityDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[]
): number {
    const hacking = stats.hacking || 0;
    const security = stats.security || 0;
    const effectiveHP = calculateEffectiveHP(
        stats.hp || 0,
        stats.defence || 0,
        stats.damageReduction || 0
    );
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);
    return (hacking * security + effectiveHP + additiveBonus) * (1 + multiplierFactor);
}

function calculateBomberDebufferScore(
    stats: BaseStats,
    statBonuses?: StatBonus[],
    arcaneSiegeMultiplier: number = 0
): number {
    const hacking = stats.hacking || 0;
    // For bomber debuffers, Arcane Siege affects attack-based damage
    const attack = stats.attack || 0;
    const attackWithMultiplier =
        arcaneSiegeMultiplier > 0 ? attack * (1 + arcaneSiegeMultiplier / 100) : attack;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    return (hacking * attackWithMultiplier + additiveBonus) * (1 + multiplierFactor);
}

function calculateCorrosionDebufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hacking = stats.hacking || 0;
    const decimation = setCount?.DECIMATION || 0;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    // Hacking is the primary stat (0-500 range) that inflicts the DoT
    // Decimation sets provide 10% damage increase each (max 3 sets = 30% total)
    // Formula: base_hacking * (1 + decimation_multiplier) + bonus_score
    const decimationMultiplier = decimation * 0.1; // 10% per piece
    const totalDamage = hacking * (1 + decimationMultiplier);

    return (totalDamage + additiveBonus) * (1 + multiplierFactor);
}

function calculateHealerScore(stats: BaseStats, statBonuses?: StatBonus[]): number {
    const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT; // 15% of HP

    // Use same crit calculation as DPS
    const critMultiplier = calculateCritMultiplier(stats);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    // Apply heal modifier after crit calculations
    const healModifier = stats.healModifier || 0;

    return (
        (baseHealing * critMultiplier * (1 + healModifier / 100) + additiveBonus) *
        (1 + multiplierFactor)
    );
}

function calculateBufferScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const effectiveHP = calculateEffectiveHP(stats.hp || 0, stats.defence || 0);
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    const speedScore = speed * 10; // Base weight for speed

    // Boost set scoring (4 pieces needed for set bonus)
    // Heavily reward having the full set
    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 45000; // Major bonus for complete set
    }

    // Add effective HP as a secondary consideration
    // Scale it down to not overshadow primary stats
    const ehpScore = Math.sqrt(effectiveHP) * 2;

    return (speedScore + boostScore + ehpScore + additiveBonus) * (1 + multiplierFactor);
}

function calculateOffensiveSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const speed = stats.speed || 0;
    const boostCount = setCount?.BOOST || 0;
    const attack = Math.sqrt(stats.attack || 0) * 2;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    let boostScore = 0;
    if (boostCount === 4) {
        boostScore = 45000; // Major bonus for complete set
    }

    return (speed * 10 + attack + boostScore + additiveBonus) * (1 + multiplierFactor);
}

function calculateShieldSupporterScore(
    stats: BaseStats,
    setCount?: Record<string, number>,
    statBonuses?: StatBonus[]
): number {
    const hp = stats.hp || 0;
    const additiveBonus = applyAdditiveBonuses(stats, statBonuses);
    const multiplierFactor = calculateMultiplierFactor(stats, statBonuses);

    return (hp + additiveBonus) * (1 + multiplierFactor);
}

/**
 * Sum of normalized violations for all hard-flagged priorities.
 * Returns 0 when all hard requirements are met (combo is "feasible").
 * Normalization divides by the limit so cross-stat comparisons are meaningful.
 */
export function calculateHardViolation(stats: BaseStats, priorities: StatPriority[]): number {
    let violation = 0;
    for (const p of priorities) {
        if (!p.hardRequirement) continue;
        const value = resolveLimitStatValue(stats, p.stat);
        if (p.minLimit && value < p.minLimit) {
            violation += (p.minLimit - value) / p.minLimit;
        }
        if (p.maxLimit && value > p.maxLimit) {
            violation += (value - p.maxLimit) / p.maxLimit;
        }
    }
    return violation;
}

export function calculatePriorityScore(
    stats: BaseStats,
    priorities: StatPriority[],
    shipRole?: ShipTypeName,
    setCount?: Record<string, number>,
    setPriorities?: SetPriority[],
    statBonuses?: StatBonus[],
    tryToCompleteSets?: boolean,
    arcaneSiegeMultiplier: number = 0,
    implantSetCount?: Record<string, number>,
    customFormula?: CustomFormula
): number {
    let penalties = 0;

    // Calculate penalties based on min/max limits
    for (const priority of priorities) {
        const statValue = resolveLimitStatValue(stats, priority.stat);

        if (priority.minLimit) {
            if (statValue < priority.minLimit) {
                // Calculate penalty as percentage below minimum
                const diff = (priority.minLimit - statValue) / priority.minLimit;
                penalties += diff * 100;
            }
        }

        if (priority.maxLimit) {
            if (statValue > priority.maxLimit) {
                // Calculate penalty as the percentage above maximum
                const diff = (statValue - priority.maxLimit) / priority.maxLimit;
                penalties += diff * 100;
            }
        }
    }

    // Calculate set requirement penalties
    if (setPriorities && setPriorities.length > 0) {
        for (const setPriority of setPriorities) {
            const gearCount = setCount?.[setPriority.setName] || 0;
            const implantCount = implantSetCount?.[setPriority.setName] || 0;
            const currentCount = setPriority.kind === 'implant' ? implantCount : gearCount;
            if (currentCount < setPriority.count) {
                // Calculate penalty as percentage below required count
                // Multiply by 2 to make set requirements more important
                const diff = (setPriority.count - currentCount) / setPriority.count;
                penalties += diff * 200;
            }
        }
    }

    // Penalize orphan pieces when tryToCompleteSets is enabled.
    // An orphan is a piece whose set doesn't have enough companions in the
    // loadout to activate (e.g. 1-of-2, 3-of-4). For each set we count
    // `count mod minPieces` — the leftover pieces that don't contribute to a
    // bonus. This keeps the penalty monotonic in orphan count and bounded
    // (max 6 orphans in a 6-slot loadout → 60% at weight 10), so the GA
    // always has a non-zero fitness gradient to work with.
    if (tryToCompleteSets && setCount) {
        let orphans = 0;
        for (const [setName, count] of Object.entries(setCount)) {
            const minPieces = GEAR_SETS[setName]?.minPieces || 2;
            orphans += count % minPieces;
        }
        penalties += orphans * 10;
    }

    // Get base score from role-specific calculation
    let baseScore = 0;
    if (shipRole) {
        switch (shipRole) {
            case 'ATTACKER':
                baseScore = calculateAttackerScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEFENDER':
                baseScore = calculateDefenderScore(stats, statBonuses);
                break;
            case 'DEFENDER_SECURITY':
                baseScore = calculateDefenderSecurityScore(stats, statBonuses);
                break;
            case 'DEBUFFER':
                baseScore = calculateDebufferScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEBUFFER_DEFENSIVE':
                baseScore = calculateDefensiveDebufferScore(stats, statBonuses);
                break;
            case 'DEBUFFER_DEFENSIVE_SECURITY':
                baseScore = calculateDefensiveSecurityDebufferScore(stats, statBonuses);
                break;
            case 'DEBUFFER_BOMBER':
                baseScore = calculateBomberDebufferScore(stats, statBonuses, arcaneSiegeMultiplier);
                break;
            case 'DEBUFFER_CORROSION':
                baseScore = calculateCorrosionDebufferScore(stats, setCount, statBonuses);
                break;
            case 'SUPPORTER':
                baseScore = calculateHealerScore(stats, statBonuses);
                break;
            case 'SUPPORTER_BUFFER':
                baseScore = calculateBufferScore(stats, setCount, statBonuses);
                break;
            case 'SUPPORTER_OFFENSIVE':
                baseScore = calculateOffensiveSupporterScore(stats, setCount, statBonuses);
                break;
            case 'SUPPORTER_SHIELD':
                baseScore = calculateShieldSupporterScore(stats, setCount, statBonuses);
                break;
        }
    } else {
        baseScore = customFormulaScore(stats, customFormula);
    }

    // Apply penalties as percentage reduction of base score
    return Math.max(0, baseScore * (1 - penalties / 100));
}

/**
 * Score a ship by role given fully-calculated stats.
 * Returns 0 for unrecognised roles.
 *
 * Note: set-bonus params (setCount, arcaneSiegeMultiplier) are omitted intentionally —
 * engineering stats are global per role and gear-set composition is out of scope here.
 * Sub-roles that reward full sets (SUPPORTER_BUFFER, DEBUFFER_CORROSION, etc.) will score
 * slightly lower than reality, but the relative ranking between engineering tracks is correct.
 * `statBonuses` pass through to the role formula regardless — they are not set-dependent.
 *
 * @see calculatePriorityScore - The role switch in that function mirrors the one here.
 * MAINTENANCE: When a new ShipTypeName is added, both switches must be updated.
 */
export function calculateRoleScore(
    role: ShipTypeName,
    stats: BaseStats,
    statBonuses?: StatBonus[]
): number {
    switch (role) {
        case 'ATTACKER':
            return calculateAttackerScore(stats, statBonuses);
        case 'DEFENDER':
            return calculateDefenderScore(stats, statBonuses);
        case 'DEFENDER_SECURITY':
            return calculateDefenderSecurityScore(stats, statBonuses);
        case 'DEBUFFER':
            return calculateDebufferScore(stats, statBonuses);
        case 'DEBUFFER_DEFENSIVE':
            return calculateDefensiveDebufferScore(stats, statBonuses);
        case 'DEBUFFER_DEFENSIVE_SECURITY':
            return calculateDefensiveSecurityDebufferScore(stats, statBonuses);
        case 'DEBUFFER_BOMBER':
            return calculateBomberDebufferScore(stats, statBonuses);
        case 'DEBUFFER_CORROSION':
            return calculateCorrosionDebufferScore(stats, undefined, statBonuses);
        case 'SUPPORTER':
            return calculateHealerScore(stats, statBonuses);
        case 'SUPPORTER_BUFFER':
            return calculateBufferScore(stats, undefined, statBonuses);
        case 'SUPPORTER_OFFENSIVE':
            return calculateOffensiveSupporterScore(stats, undefined, statBonuses);
        case 'SUPPORTER_SHIELD':
            return calculateShieldSupporterScore(stats, undefined, statBonuses);
        default:
            return 0;
    }
}

export interface StatBonusPreview {
    /** The bonus stat's value on these stats — derived stats resolved, not indexed. */
    statValue: number;
    /** Role score with `otherBonuses` applied and this bonus absent. */
    baseScore: number;
    /** Role score with `otherBonuses` AND this bonus applied. */
    newScore: number;
    /** False when no role is selected. `calculatePriorityScore` applies stat bonuses only
     *  inside the role formulas — with no role it scores from the custom formula, which
     *  takes none — so a bonus really does nothing in custom mode. */
    applies: boolean;
}

/**
 * What one stat bonus contributes to a ship's score, for display beside the bonus form.
 *
 * The figures are MARGINAL: `baseScore` already includes `otherBonuses`, so the delta is
 * the effect of the bonus being edited rather than of the whole set. Role base scores span
 * orders of magnitude (an attacker's is ~3,000 while a bomber's is ~1,250,000), which is why
 * the same percentage behaves so differently and why this is worth showing rather than
 * normalizing away.
 */
export function previewStatBonus(
    stats: BaseStats,
    role: ShipTypeName | null,
    bonus: StatBonus,
    otherBonuses: StatBonus[] = []
): StatBonusPreview {
    const statValue = resolveLimitStatValue(stats, bonus.stat);
    if (!role) {
        return { statValue, baseScore: 0, newScore: 0, applies: false };
    }
    return {
        statValue,
        baseScore: calculateRoleScore(role, stats, otherBonuses),
        newScore: calculateRoleScore(role, stats, [...otherBonuses, bonus]),
        applies: true,
    };
}
