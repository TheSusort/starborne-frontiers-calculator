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
    /** The ability trigger the effect rides (rendered by `triggerProse`). */
    trigger: string;
    /** The gearable stat that moves this effect: `stat` itself when gear rolls it, otherwise the
     *  stat that PRODUCES `stat`. Absent when no gearable stat drives the effect. The notice then
     *  reports the kit fact with no lever. */
    tunableStat?: OffFormulaStat;
    /** For a chained finding, the producing clause's percentage — the second factor of the
     *  coefficient product. FrontLine's damage is 75% of his shield and his shield is 25% of max
     *  HP, so the lever weight is 0.75 x 0.25. Absent when `stat` is its own lever. */
    leverPct?: number;
}

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

/** A carrier the walk found, before the role formula has been consulted. Every carrier is
 *  recorded, aligned or not: a chain can only be followed while both of its links are still
 *  present, so classification has to wait until the lever is known. Carries its own clause's
 *  percentage (`pct`) so a chained finding can report the producer's share of the coefficient
 *  product — `pct` never survives into the returned finding itself, only as `leverPct` on the
 *  finding it produces. */
type CarrierFinding = Omit<OffFormulaFinding, 'severity' | 'leverPct'> & { pct: number };
type ResolvedFinding = Omit<OffFormulaFinding, 'severity'>;

/**
 * Point every finding at the gearable stat that moves it.
 *
 * A finding on a stat gear rolls is its own lever. A finding on a stat gear cannot roll is
 * actionable only when another finding PRODUCES that stat from a gearable one: the two collapse
 * into a single entry that keeps what the effect reads in `stat` and carries the lever in
 * `tunableStat` plus the producer's own percentage in `leverPct` (the second factor of the
 * coefficient product — `stat`'s own pct is the first), and the producer is dropped because the
 * collapsed entry already says what it said. A finding with no gearable producer keeps no
 * `tunableStat` (and no `leverPct`).
 */
function withGearableLevers(raw: CarrierFinding[]): ResolvedFinding[] {
    const absorbed = new Set<number>();
    const resolved: ResolvedFinding[][] = raw.map((finding, index) => {
        if (isGearable(finding.stat)) {
            return [
                {
                    stat: finding.stat,
                    produces: finding.produces,
                    trigger: finding.trigger,
                    tunableStat: finding.stat,
                },
            ];
        }

        const chained: ResolvedFinding[] = [];
        raw.forEach((producer, producerIndex) => {
            if (producerIndex === index) return;
            if (producer.produces !== finding.stat) return;
            if (!isGearable(producer.stat)) return;
            absorbed.add(producerIndex);
            chained.push({
                stat: finding.stat,
                produces: finding.produces,
                trigger: finding.trigger,
                tunableStat: producer.stat,
                leverPct: producer.pct,
            });
        });

        return chained.length > 0
            ? chained
            : [{ stat: finding.stat, produces: finding.produces, trigger: finding.trigger }];
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
 *  and `StatPriority.stat` spell it the British way (types/abilities.ts:722-726). Exported so
 *  `basisDerivation.ts` shares one idiom rather than re-deriving it. */
export const normalise = (stat: string): OffFormulaStat =>
    (stat === 'defense' ? 'defence' : stat) as OffFormulaStat;

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

    const carriers: CarrierFinding[] = [];
    const add = (
        stat: OffFormulaStat,
        produces: OffFormulaFinding['produces'],
        trigger: string,
        pct: number
    ): void => {
        if (carriers.some((f) => f.stat === stat && f.produces === produces)) return;
        carriers.push({ stat, produces, trigger, pct });
    };

    for (const slot of buildShipAbilities(ship).slots ?? []) {
        for (const ability of slot.abilities ?? []) {
            const config = ability.config as unknown as {
                type?: string;
                stat?: string;
                basis?: string;
                pct?: number;
                hpBasisPct?: number;
                shieldBasisPct?: number;
            };
            if (!config?.type) continue;
            const trigger = ability.trigger as string;

            if (config.type === 'additional-damage' && config.stat) {
                add(normalise(config.stat), 'damage', trigger, config.pct ?? 0);
            }

            if ((config.type === 'heal' || config.type === 'shield') && config.basis) {
                // Only the CASTER-stat bases describe a gearing decision. 'target-hp',
                // 'damage-dealt', 'damage-taken' and 'overheal' scale off something the
                // owner's own stat block does not control.
                if (['hp', 'attack', 'defense'].includes(config.basis)) {
                    add(
                        normalise(config.basis),
                        config.type === 'heal' ? 'repair' : 'shield',
                        trigger,
                        config.pct ?? 0
                    );
                }
            }

            // Reactive damage whose raw comes from max HP or the current shield pool instead of
            // attack x multiplier. Invisible to an 'additional-damage' query, and the only way
            // Vindicator and Xcellence's real damage channels are seen at all.
            if (config.type === 'damage') {
                if (config.hpBasisPct) add('hp', 'damage', trigger, config.hpBasisPct);
                if (config.shieldBasisPct) add('shield', 'damage', trigger, config.shieldBasisPct);
            }
        }
    }

    // Severity is read on the LEVER, because the lever is the gearing decision the player would
    // act on. A chain whose root the role formula already rewards is no divergence at all and
    // drops out here.
    return withGearableLevers(carriers).flatMap((finding) => {
        const severity = classify(finding.tunableStat ?? finding.stat);
        return severity ? [{ ...finding, severity }] : [];
    });
}
