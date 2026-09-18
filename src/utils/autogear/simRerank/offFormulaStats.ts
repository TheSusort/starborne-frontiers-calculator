import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { CUSTOM_FORMULA_SEEDS } from '../customFormulaSeeds';

export type OffFormulaStat = 'hp' | 'defence' | 'shield' | 'security' | 'attack';
export type OffFormulaSeverity = 'severe' | 'substitution';

export interface OffFormulaFinding {
    stat: OffFormulaStat;
    produces: 'damage' | 'repair' | 'shield';
    severity: OffFormulaSeverity;
    /** The ability trigger the effect rides. `gatingStatFor` turns this into the stat an
     *  opponent must vary for the measurement to mean anything. */
    trigger: string;
}

/** Seed terms that stand for a COMBINATION of stats. They must never be expanded into their
 *  components when deciding whether a stat is rewarded: `effectiveHp` lets a build trade defence
 *  for HP at no scoring cost, so a skill scaling off Defence SPECIFICALLY is still mis-scored.
 *  Expanding them is what makes Panon and Madax invisible. */
const AGGREGATE_COMPONENTS: Record<string, readonly string[]> = {
    // crit and critDamage can never BE a finding — no carrier scales an effect off them — but
    // they are listed because this map documents what each aggregate stands for, and a future
    // carrier that does read them must not silently classify them as severe.
    directDamage: ['attack', 'crit', 'critDamage'],
    effectiveHp: ['hp', 'defence'],
};

/** `additional-damage.stat` and `heal`/`shield`.`basis` spell it the American way; `BaseStats`
 *  and `StatPriority.stat` spell it the British way (types/abilities.ts:722-726). */
const normalise = (stat: string): OffFormulaStat =>
    (stat === 'defense' ? 'defence' : stat) as OffFormulaStat;

export function gatingStatFor(trigger: string): 'hacking' | 'security' | 'defence' {
    // This unit RESISTING is gated by its own security against the enemy's hacking.
    if (trigger === 'on-debuff-resisted') return 'hacking';
    // An enemy resisting is gated by the enemy's security against this unit's hacking.
    if (trigger === 'on-own-debuff-resisted' || trigger === 'on-enemy-debuff-resisted') {
        return 'security';
    }
    // Ungated: no threshold to move, so an opponent can only vary mitigation.
    return 'defence';
}

export function detectOffFormulaStats(
    ship: Ship,
    configuredRole: ShipTypeName | null
): OffFormulaFinding[] {
    // Custom mode: the player wrote the formula, so there is no role objective to diverge from.
    if (!configuredRole) return [];

    const seed = CUSTOM_FORMULA_SEEDS[configuredRole];
    if (!seed) return [];

    const rewardedDirectly = new Set<string>();
    const rewardedViaAggregate = new Set<string>();
    for (const row of seed.rows) {
        const components = AGGREGATE_COMPONENTS[row.stat as string];
        if (components) {
            for (const c of components) rewardedViaAggregate.add(c);
        } else {
            rewardedDirectly.add(normalise(row.stat));
        }
    }

    const classify = (stat: OffFormulaStat): OffFormulaSeverity | null => {
        if (rewardedDirectly.has(stat)) return null;
        return rewardedViaAggregate.has(stat) ? 'substitution' : 'severe';
    };

    const findings: OffFormulaFinding[] = [];
    const add = (
        stat: OffFormulaStat,
        produces: OffFormulaFinding['produces'],
        trigger: string
    ): void => {
        const severity = classify(stat);
        if (!severity) return;
        if (findings.some((f) => f.stat === stat && f.produces === produces)) return;
        findings.push({ stat, produces, severity, trigger });
    };

    for (const slot of buildShipAbilities(ship).slots ?? []) {
        for (const ability of slot.abilities ?? []) {
            const config = ability.config as unknown as {
                type?: string;
                stat?: string;
                basis?: string;
                hpBasisPct?: number;
                shieldBasisPct?: number;
            };
            if (!config?.type) continue;
            const trigger = ability.trigger as string;

            if (config.type === 'additional-damage' && config.stat) {
                add(normalise(config.stat), 'damage', trigger);
            }

            if ((config.type === 'heal' || config.type === 'shield') && config.basis) {
                // Only the CASTER-stat bases describe a gearing decision. 'target-hp',
                // 'damage-dealt', 'damage-taken' and 'overheal' scale off something the
                // owner's own stat block does not control.
                if (['hp', 'attack', 'defense'].includes(config.basis)) {
                    add(
                        normalise(config.basis),
                        config.type === 'heal' ? 'repair' : 'shield',
                        trigger
                    );
                }
            }

            // Reactive damage whose raw comes from max HP or the current shield pool instead of
            // attack x multiplier. Invisible to an 'additional-damage' query, and the only way
            // Vindicator and Xcellence's real damage channels are seen at all.
            if (config.type === 'damage') {
                if (config.hpBasisPct) add('hp', 'damage', trigger);
                if (config.shieldBasisPct) add('shield', 'damage', trigger);
            }
        }
    }

    return findings;
}
