import { BaseStats } from '../../types/stats';
import { ShipTypeName } from '../../constants';
import type { BasisTerm, CustomFormula, CustomFormulaRow, RoleBasis } from '../../types/autogear';
import { calculateDamageReduction, calculateHealingPerHit } from '../autogear/scoring';
import {
    calculateDirectDamage,
    calculateEffectiveHP,
    resolveBasisValue,
} from '../autogear/statResolution';
import { customFormulaScore, isFormulaEmpty, usableBasis } from '../autogear/customFormula';
import { hostedBasisTerms } from '../autogear/offFormula/roleBasisHost';
import {
    ENEMY_ATTACK,
    ENEMY_COUNT,
    ENEMY_SECURITY,
    ENEMY_DEFENSE,
    BASE_HEAL_PERCENT,
} from '../../constants/simulation';
export interface SimulationSummary {
    // Common
    averageDamage?: number;
    highestHit?: number;
    lowestHit?: number;
    critRate?: number;

    // Defender specific
    effectiveHP?: number;
    survivedRounds?: number;
    damageReduction?: number;
    shieldPerRound?: number;
    healingPerHit?: number;
    hp?: number;
    hpRegen?: number;
    security?: number;

    // Debuffer specific
    hackSuccessRate?: number;
    hacking?: number;

    // Supporter specific
    averageHealing?: number;
    highestHeal?: number;
    lowestHeal?: number;

    // Supporter(Buffer) specific
    speed?: number;
    activeSets?: string[];

    // Supporter(Offensive) specific
    attack?: number;

    // Custom-formula ship (no role): the score `customFormulaScore` gave the build actually
    // scored on. `SimulationResults.tsx` renders the Custom section keyed on this field being
    // present, not on `role === null`.
    formulaScore?: number;
}

export const SIMULATION_ITERATIONS = 1000;

export function runSimulation(
    stats: BaseStats,
    role: ShipTypeName | null,
    activeSets?: string[],
    options?: { roleBasis?: RoleBasis; customFormula?: CustomFormula }
): SimulationSummary {
    if (role === null) {
        if (options?.customFormula && !isFormulaEmpty(options.customFormula)) {
            return runCustomFormulaSimulation(stats, options.customFormula);
        }
        return runDamageSimulation(stats);
    }

    // See `hostedBasisTerms`' doc (`roleBasisHost.ts`) for the hosting rule. `undefined` for
    // every non-hosting role, which makes every basis-aware branch below read exactly as it did
    // with no basis at all.
    const basisTerms = hostedBasisTerms(role, options?.roleBasis);

    switch (role) {
        case 'DEFENDER':
        case 'DEFENDER_SECURITY':
            return {
                ...runDefenderSimulation(stats),
                activeSets: activeSets,
            };
        case 'DEBUFFER':
        case 'DEBUFFER_BOMBER':
            return runDebufferSimulation(stats, basisTerms);
        case 'DEBUFFER_DEFENSIVE':
            return runDefensiveDebufferSimulation(stats);
        case 'DEBUFFER_DEFENSIVE_SECURITY':
            return runDefensiveSecurityDebufferSimulation(stats);
        case 'DEBUFFER_CORROSION':
            return runCorrosionDebufferSimulation(stats);
        case 'SUPPORTER':
            return runHealingSimulation(stats, basisTerms);
        case 'SUPPORTER_BUFFER':
            return {
                ...runDefenderSimulation(stats),
                speed: stats.speed,
                activeSets: activeSets,
            };
        case 'SUPPORTER_OFFENSIVE':
            return {
                speed: stats.speed,
                activeSets: activeSets,
                attack: stats.attack,
            };
        case 'SUPPORTER_SHIELD':
            return {
                hp: resolveBasisValue(stats, basisTerms, 'hp'),
            };
        default:
            return runDamageSimulation(stats, basisTerms);
    }
}

/**
 * A core row on `stat`, `kind: 'core'`, `direction: 'max'` — the shape `usableBasis` (and
 * `formulaRowTerm`) honours a basis on. The first such row for `stat`, or undefined when the
 * formula carries none.
 */
function findCoreMaxRow(
    formula: CustomFormula,
    stat: CustomFormulaRow['stat']
): CustomFormulaRow | undefined {
    return formula.rows.find(
        (row) => row.stat === stat && row.kind === 'core' && row.direction === 'max'
    );
}

/**
 * Results for a role-less Custom ship: the score it was actually ranked on, plus damage/EHP
 * read off the SAME basis a `directDamage`/`effectiveHp` core row scored — not the attack-based
 * iteration `runDamageSimulation` runs for a role. A Custom ship's damage/EHP is an analytic
 * expectation (mirrors `formulaRowTerm`), not a per-hit crit-roll simulation, because the
 * formula itself never rolls one.
 */
function runCustomFormulaSimulation(stats: BaseStats, formula: CustomFormula): SimulationSummary {
    const summary: SimulationSummary = {
        formulaScore: customFormulaScore(stats, formula),
    };

    const directDamageRow = findCoreMaxRow(formula, 'directDamage');
    if (directDamageRow) {
        summary.averageDamage = Math.round(
            calculateDirectDamage(stats, usableBasis(directDamageRow))
        );
    }

    const effectiveHpRow = findCoreMaxRow(formula, 'effectiveHp');
    if (effectiveHpRow) {
        summary.effectiveHP = Math.round(
            calculateEffectiveHP(
                stats.hp,
                stats.defence,
                stats.damageReduction ?? 0,
                usableBasis(effectiveHpRow),
                stats
            )
        );
    }

    return summary;
}

export function runDamageSimulation(stats: BaseStats, basis?: BasisTerm[]): SimulationSummary {
    let totalDamage = 0;
    let highest = 0;
    let lowest = Infinity;
    let critCount = 0;

    for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
        const { damage, isCrit } = calculateDamage(stats, basis);
        totalDamage += damage;
        highest = Math.max(highest, damage);
        lowest = Math.min(lowest, damage);
        if (isCrit) {
            critCount++;
        }
    }

    return {
        averageDamage: Math.round(totalDamage / SIMULATION_ITERATIONS),
        highestHit: Math.round(highest),
        lowestHit: Math.round(lowest),
        critRate: Math.round((critCount / SIMULATION_ITERATIONS) * 100) / 100,
    };
}

function runDefenderSimulation(stats: BaseStats): SimulationSummary {
    // Calculate damage reduction from defence stat
    const defenseReduction = calculateDamageReduction(stats.defence || 0);
    // Calculate effective HP from HP and defence-based damage reduction
    const effectiveHP = (stats.hp || 0) * (100 / (100 - defenseReduction));
    // Apply damageReduction stat (from gear/refits) as a separate multiplier
    const finalEffectiveHP = effectiveHP * (1 + (stats.damageReduction || 0) / 100);
    let survivalRounds = 0;
    // Calculate average damage taken per hit, now from multiple enemies
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;

    // Calculate shield generation
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;

    // Calculate healing per hit, now multiplied by number of enemies
    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;

    // Calculate survival rounds
    // If healing >= damage, technically infinite survival
    if (healingWithShieldPerRound >= damagePerRound) {
        survivalRounds = Number.MAX_SAFE_INTEGER;
    } else {
        // Recalculate effective survivability including shield and healing against multiple enemies
        survivalRounds = finalEffectiveHP / (damagePerRound - healingWithShieldPerRound);
    }
    return {
        effectiveHP: Math.round(finalEffectiveHP),
        damageReduction: Math.round(defenseReduction * 100) / 100,
        shieldPerRound: Math.round(shieldPerRound),
        healingPerHit: Math.round(healingPerHit),
        survivedRounds: survivalRounds,
        hp: stats.hp,
        hpRegen: stats.hpRegen,
        security: stats.security,
    };
}

function runDebufferSimulation(stats: BaseStats, basis?: BasisTerm[]): SimulationSummary {
    const hacking = stats.hacking || 0;
    const attack = stats.attack || 0;

    // Success rate is the difference between hacking and security as a percentage
    const hackSuccessRate = Math.min(100, Math.max(0, hacking - ENEMY_SECURITY));

    // Also run damage simulation as secondary output
    const damageSimulation = runDamageSimulation(stats, basis);

    return {
        hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
        hacking: hacking,
        attack: attack,
        averageDamage: damageSimulation.averageDamage,
        highestHit: damageSimulation.highestHit,
        lowestHit: damageSimulation.lowestHit,
        critRate: damageSimulation.critRate,
    };
}

function runDefensiveDebufferSimulation(stats: BaseStats): SimulationSummary {
    const hacking = stats.hacking || 0;
    const defenseReduction = calculateDamageReduction(stats.defence || 0);
    const effectiveHP = (stats.hp || 0) * (100 / (100 - defenseReduction));
    // Apply damageReduction stat (from gear/refits) as a separate multiplier
    const finalEffectiveHP = effectiveHP * (1 + (stats.damageReduction || 0) / 100);

    // Calculate hack success rate
    const hackSuccessRate = Math.min(100, Math.max(0, hacking - ENEMY_SECURITY));

    // Calculate survival rounds
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;
    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;
    const survivedRounds =
        healingWithShieldPerRound >= damagePerRound
            ? Number.MAX_SAFE_INTEGER
            : finalEffectiveHP / (damagePerRound - healingWithShieldPerRound);

    // Also run damage simulation as secondary output
    const damageSimulation = runDamageSimulation(stats);

    return {
        hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
        hacking: hacking,
        effectiveHP: Math.round(finalEffectiveHP),
        survivedRounds: survivedRounds,
        averageDamage: damageSimulation.averageDamage,
        highestHit: damageSimulation.highestHit,
        lowestHit: damageSimulation.lowestHit,
        critRate: damageSimulation.critRate,
    };
}

function runDefensiveSecurityDebufferSimulation(stats: BaseStats): SimulationSummary {
    const hacking = stats.hacking || 0;
    const security = stats.security || 0;
    const defenseReduction = calculateDamageReduction(stats.defence || 0);
    const effectiveHP = (stats.hp || 0) * (100 / (100 - defenseReduction));
    // Apply damageReduction stat (from gear/refits) as a separate multiplier
    const finalEffectiveHP = effectiveHP * (1 + (stats.damageReduction || 0) / 100);

    // Calculate hack success rate
    const hackSuccessRate = Math.min(100, Math.max(0, hacking - ENEMY_SECURITY));

    // Calculate survival rounds
    const damagePerRound = ENEMY_ATTACK * ENEMY_COUNT;
    const shieldPerRound = stats.shield
        ? Math.min((stats.hp || 0) * (stats.shield / 100), stats.hp || 0)
        : 0;
    const healingPerHit = stats.hpRegen ? calculateHealingPerHit(stats) : 0;
    const healingPerRound = healingPerHit * ENEMY_COUNT;
    const healingWithShieldPerRound = healingPerRound + shieldPerRound;
    const survivedRounds =
        healingWithShieldPerRound >= damagePerRound
            ? Number.MAX_SAFE_INTEGER
            : finalEffectiveHP / (damagePerRound - healingWithShieldPerRound);

    // Also run damage simulation as secondary output
    const damageSimulation = runDamageSimulation(stats);

    return {
        hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
        hacking: hacking,
        security: security,
        effectiveHP: Math.round(finalEffectiveHP),
        survivedRounds: survivedRounds,
        averageDamage: damageSimulation.averageDamage,
        highestHit: damageSimulation.highestHit,
        lowestHit: damageSimulation.lowestHit,
        critRate: damageSimulation.critRate,
    };
}

function runCorrosionDebufferSimulation(stats: BaseStats): SimulationSummary {
    const hacking = stats.hacking || 0;

    // Calculate hack success rate
    const hackSuccessRate = Math.min(100, Math.max(0, hacking - ENEMY_SECURITY));

    return {
        hackSuccessRate: Math.round(hackSuccessRate * 100) / 100,
        hacking: hacking,
    };
}

function runHealingSimulation(stats: BaseStats, basis?: BasisTerm[]): SimulationSummary {
    let totalHealing = 0;
    let highest = 0;
    let lowest = Infinity;
    let critCount = 0;

    const baseHealing = resolveBasisValue(stats, basis, 'hp') * BASE_HEAL_PERCENT;
    const healModifier = 1 + (stats.healModifier || 0) / 100;

    for (let i = 0; i < SIMULATION_ITERATIONS; i++) {
        const healing = calculateHealing(baseHealing, healModifier, stats);
        totalHealing += healing;
        highest = Math.max(highest, healing);
        lowest = Math.min(lowest, healing);
        if (healing > baseHealing) {
            critCount++;
        }
    }

    return {
        averageHealing: Math.round(totalHealing / SIMULATION_ITERATIONS),
        highestHeal: Math.round(highest),
        lowestHeal: Math.round(lowest),
        critRate: Math.round((critCount / SIMULATION_ITERATIONS) * 100) / 100,
    };
}

function calculateDamage(
    stats: BaseStats,
    basis?: BasisTerm[]
): { damage: number; isCrit: boolean } {
    const baseDamage = resolveBasisValue(stats, basis, 'attack');
    const critRoll = Math.random() * 100;
    const isCrit = critRoll <= (stats.crit || 0);

    // Calculate damage reduction based on defense penetration
    const defensePenetration = stats.defensePenetration || 0;
    const effectiveDefense = ENEMY_DEFENSE * (1 - defensePenetration / 100);
    const damageReduction = calculateDamageReduction(effectiveDefense);
    const damageMultiplier = 1 - damageReduction / 100;

    if (isCrit) {
        return {
            damage: baseDamage * (1 + (stats.critDamage || 0) / 100) * damageMultiplier,
            isCrit: true,
        };
    }
    return { damage: baseDamage * damageMultiplier, isCrit: false };
}

function calculateHealing(baseHealing: number, healModifier: number, stats: BaseStats): number {
    const critRoll = Math.random() * 100;
    const isCrit = critRoll <= (stats.crit || 0);

    let healing = baseHealing;
    if (isCrit) {
        healing = baseHealing * (1 + (stats.critDamage || 0) / 100);
    }

    return healing * healModifier;
}
