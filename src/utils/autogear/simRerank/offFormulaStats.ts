import type { Ship } from '../../../types/ship';
import type { ShipTypeName } from '../../../constants/shipTypes';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { CUSTOM_FORMULA_SEEDS } from '../customFormulaSeeds';
import { GEAR_SLOTS } from '../../../constants/gearTypes';
import { SUBSTAT_RANGES } from '../../../constants/statValues';

export type OffFormulaStat = 'hp' | 'defence' | 'shield' | 'security' | 'attack';
export type OffFormulaSeverity = 'severe' | 'substitution';

export interface OffFormulaFinding {
    /** The stat the effect READS. Not necessarily one gear can roll — `shield` is a pool the
     *  kit generates, not a gear stat. */
    stat: OffFormulaStat;
    produces: 'damage' | 'repair' | 'shield';
    /** Classified on `tunableStat` where there is one, because the lever is the gearing
     *  decision the player would act on. */
    severity: OffFormulaSeverity;
    /** The ability trigger the effect rides. `gatingStatFor` turns this into the stat an
     *  opponent must vary for the measurement to mean anything. */
    trigger: string;
    /** The gearable stat a tuning run bands to move this effect: `stat` itself when gear rolls
     *  it, otherwise the stat that PRODUCES `stat`. Absent when no gearable stat drives the
     *  effect at all — the finding still reports what the kit does, but there is nothing to
     *  measure and no lever to offer. */
    tunableStat?: OffFormulaStat;
}

/** An {@link OffFormulaFinding} a tuning run can actually act on. The panel takes this, so a
 *  finding with no gearable lever cannot be measured by construction. */
export type TunableOffFormulaFinding = OffFormulaFinding & { tunableStat: OffFormulaStat };

/** The stats gear can move, read off the two tables that decide it: each slot's main-stat pool
 *  and the substat roll table. Taken as a union rather than assumed equal — widening either
 *  table must widen this set. Implant slots declare an empty main-stat pool, so they contribute
 *  nothing here. `shield` appears in neither table: banding it could only ever report a value
 *  no build reaches. */
const GEARABLE_STATS: ReadonlySet<string> = new Set<string>([
    ...Object.values(GEAR_SLOTS).flatMap((slot) => slot.availableMainStats),
    ...Object.keys(SUBSTAT_RANGES),
]);

const isGearable = (stat: OffFormulaStat): boolean => GEARABLE_STATS.has(stat);

/**
 * Point every finding at the gearable stat a tuning run can band.
 *
 * A finding on a stat gear rolls is its own lever. A finding on a stat gear cannot roll is
 * actionable only when another finding PRODUCES that stat from a gearable one: the two collapse
 * into a single entry that keeps what the effect reads in `stat` and carries the lever in
 * `tunableStat`, and the producer is dropped because the collapsed entry already says what it
 * said. Severity is re-read on the lever — a chain whose root the role formula already rewards
 * is no divergence at all, so it drops out entirely. A finding with no gearable producer keeps
 * no `tunableStat`.
 */
function withGearableLevers(
    raw: OffFormulaFinding[],
    classify: (stat: OffFormulaStat) => OffFormulaSeverity | null
): OffFormulaFinding[] {
    const absorbed = new Set<number>();
    const resolved: OffFormulaFinding[][] = raw.map((finding, index) => {
        if (isGearable(finding.stat)) return [{ ...finding, tunableStat: finding.stat }];

        let hasGearableProducer = false;
        const chained: OffFormulaFinding[] = [];
        raw.forEach((producer, producerIndex) => {
            if (producerIndex === index) return;
            if (producer.produces !== finding.stat) return;
            if (!isGearable(producer.stat)) return;
            hasGearableProducer = true;
            absorbed.add(producerIndex);
            const severity = classify(producer.stat);
            if (severity) chained.push({ ...finding, severity, tunableStat: producer.stat });
        });

        return hasGearableProducer ? chained : [finding];
    });

    return resolved.flatMap((entries, index) => (absorbed.has(index) ? [] : entries));
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

    return withGearableLevers(findings, classify);
}
