import type { Ship } from '../../../types/ship';
import type { BasisTerm } from '../../../types/autogear';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { normalise, type OffFormulaStat } from './offFormulaStats';

export interface ExcludedCarrier {
    stat: OffFormulaStat;
    produces: 'damage' | 'repair' | 'shield';
    /** The clause's own percentage, for the notice copy. */
    pct: number;
    trigger: string;
}

export interface DerivedBasis {
    terms: BasisTerm[];
    excluded: ExcludedCarrier[];
    /** Turns per charged cast. 0 when the ship has no charged skill. */
    period: number;
}

/** Charge abilities targeted at somebody else do not bank toward this ship's charged skill. */
const OWN_TARGETED = (target: string): boolean =>
    !['ally', 'all-allies', 'lowest-hp-ally', 'enemy', 'all-enemies'].includes(target);

/**
 * Own-targeted `type: 'charge'` amounts summed over the named slots, counting every matching
 * ability as if it fired every round. A gated charge ability — one gated by an explicit
 * `Ability.conditions` array (a speed comparison, a self-HP threshold, an enemy-buff check, enemy
 * Stealth, a hit count) or by a reactive trigger that is itself the gate (`on-enemy-destroyed`,
 * `on-debuff-inflicted`, `on-ally-crit`, `on-enemy-repaired`) — fires less often than this counts
 * it. That makes the derived `chargePeriod` a LOWER BOUND on the ship's true period, so
 * `deriveBasis`'s charged-slot cast-frequency weight sits at or above its true share.
 */
function ownChargeGain(ship: Ship, slots: readonly string[]): number {
    let total = 0;
    for (const slot of buildShipAbilities(ship).slots ?? []) {
        if (!slots.includes(slot.slot)) continue;
        for (const ability of slot.abilities ?? []) {
            const config = ability.config as { type?: string; amount?: number };
            if (config?.type !== 'charge') continue;
            if (!OWN_TARGETED(ability.target)) continue;
            total += config.amount ?? 0;
        }
    }
    return total;
}

/**
 * Turns per charged cast, simulating the engine: `advanceChargeCadence` (combat/state.ts) resets
 * to 0 at the cap and otherwise adds 1 per own turn, and `playerTurn.ts` adds bonus charges on
 * ACTIVE rounds only, capped at chargeCount. Pinned against the engine by
 * `chargeCadence.integration.test.ts`.
 *
 * Returns 0 when the ship has no charged skill, which weights the active slot at 1.
 *
 * See `ownChargeGain`'s doc for why the counted charge gain (`g` below), and therefore this
 * period, is a lower bound rather than exact.
 */
export function chargePeriod(ship: Ship): number {
    const n = ship.chargeSkillCharge ?? 0;
    if (n <= 0) return 0;
    // Own-targeted charge gain from the ACTIVE and PASSIVE slots. The charged slot is excluded
    // because charges accrue on active rounds only.
    const g = ownChargeGain(ship, ['active', 'passive']);
    let c = 0;
    for (let t = 1; t <= 50; t++) {
        if (c >= n) return t;
        c = Math.min(c + 1 + g, n);
    }
    return 0;
}

/** A skill slot whose cast frequency the charge-period weighting can express. Passive fires on
 *  triggers whose frequency is not derivable from static data, so it never feeds a term. */
type CastSlot = 'active' | 'charged';

/** The three ability shapes a basis term reads, matching `offFormulaStats.ts`'s carrier walk. */
interface CarrierConfig {
    type?: string;
    multiplier?: number;
    hits?: number;
    hpBasisPct?: number;
    shieldBasisPct?: number;
    stat?: string;
    basis?: string;
    pct?: number;
}

/** Only a caster's own stat block describes a gearing decision. 'target-hp', 'damage-dealt',
 *  'damage-taken' and 'overheal' scale off something the owner's own stat block does not
 *  control (mirrors offFormulaStats.ts's carrier walk). */
const isCasterBasis = (basis: string | undefined): basis is 'hp' | 'attack' | 'defense' =>
    basis === 'hp' || basis === 'attack' || basis === 'defense';

/** Canonical output order for a derived basis's terms. `shield` never appears here — it is
 *  always resolved to the stat that produces the pool, or dropped. */
const STAT_ORDER: readonly OffFormulaStat[] = ['attack', 'hp', 'defence', 'security'];

/**
 * Player-facing tail for an excluded clause's sentence, e.g. `repairs 60% of max HP {prose}`.
 * Every `AbilityTrigger` that `excludedCarriers` can surface (a passive-slot additional-damage,
 * heal/shield-with-caster-basis, or damage.hpBasisPct/shieldBasisPct clause) needs an entry here
 * — `basisDerivation.test.ts`'s "every excluded trigger has prose" test walks the real corpus and
 * fails the moment a new trigger reaches this map unmapped, so this is expected to grow on a data
 * refresh rather than stay fixed. An unmapped trigger falls back to its raw name rather than
 * inventing English.
 */
export const TRIGGER_PROSE: Record<string, string> = {
    'pre-combat': 'at the start of the fight',
    'start-of-turn': 'at the start of its turn',
    'start-of-round': 'at the start of the round',
    'on-cast': 'on cast',
    'on-attacked': 'when it is attacked',
    'on-ally-attacked': 'when an ally is attacked',
    'on-destroyed': 'when it is destroyed',
    'on-cheat-death-activated': 'when it cheats death',
    'on-enemy-destroyed': 'when an enemy is destroyed',
    'on-enemy-purged': 'when it purges an enemy buff',
    'on-ally-purged': 'when a buff is purged from an ally',
    'on-debuff-inflicted': 'when it lands a debuff',
    'on-debuff-resisted': 'when it resists a debuff',
    'on-enemy-debuff-resisted': 'when an enemy resists a debuff',
    'on-ally-crit': 'when an ally crits',
    'on-ally-crit-dot': 'when an ally crits a damaged-over-time enemy',
    'on-ally-debuffed': 'when an ally is debuffed',
    'on-corrosion-spread': 'when Corrosion spreads',
    'on-enemy-dot-damage': 'when an enemy takes damage from a damage-over-time effect',
    'on-enemy-repaired': 'when an enemy repairs',
    'on-own-cleanse': 'when it cleanses a debuff',
    'on-own-shield-strip': 'when it strips Shield from an enemy',
    'on-stasis-applied': 'when it applies Stasis',
};

export const triggerProse = (trigger: string): string => TRIGGER_PROSE[trigger] ?? trigger;

/**
 * Per-cast-slot raw contributions toward a requested `produces`, plus the shield-chain's
 * producing half (a `shield`-ability's own caster basis), collected regardless of the requested
 * `produces` since it resolves a `shield` carrier found only under `produces: 'damage'`.
 *
 * Values are the ability's own percentage/multiplier numbers, not yet weighted by cast frequency
 * or divided by 100 — both happen once, after the two slots are combined.
 */
function collectCastRaw(
    ship: Ship,
    produces: 'damage' | 'repair' | 'shield'
): {
    raw: Record<CastSlot, Partial<Record<OffFormulaStat, number>>>;
    producing: Record<CastSlot, Partial<Record<OffFormulaStat, number>>>;
} {
    const raw: Record<CastSlot, Partial<Record<OffFormulaStat, number>>> = {
        active: {},
        charged: {},
    };
    const producing: Record<CastSlot, Partial<Record<OffFormulaStat, number>>> = {
        active: {},
        charged: {},
    };
    const bump = (
        bucket: Partial<Record<OffFormulaStat, number>>,
        stat: OffFormulaStat,
        value: number
    ) => {
        bucket[stat] = (bucket[stat] ?? 0) + value;
    };

    for (const skillSlot of buildShipAbilities(ship).slots ?? []) {
        const slot = skillSlot.slot;
        if (slot !== 'active' && slot !== 'charged') continue;

        for (const ability of skillSlot.abilities ?? []) {
            const config = ability.config as unknown as CarrierConfig;
            if (!config?.type) continue;

            // The cast-scaled attack multiplier. A config carrying hpBasisPct/shieldBasisPct is
            // the reactive path (Vindicator/Xcellence's on-resist channel), never an
            // attack-scaled cast, so it contributes nothing here.
            if (config.type === 'damage' && produces === 'damage') {
                if (!config.hpBasisPct && !config.shieldBasisPct) {
                    bump(raw[slot], 'attack', (config.multiplier ?? 0) * (config.hits ?? 1));
                }
            }

            if (config.type === 'additional-damage' && config.stat && produces === 'damage') {
                bump(raw[slot], normalise(config.stat), config.pct ?? 0);
            }

            if (config.type === 'heal' && produces === 'repair' && isCasterBasis(config.basis)) {
                bump(raw[slot], normalise(config.basis), config.pct ?? 0);
            }

            if (config.type === 'shield' && produces === 'shield' && isCasterBasis(config.basis)) {
                bump(raw[slot], normalise(config.basis), config.pct ?? 0);
            }

            // Shield-chain producing half: whatever generates the shield pool itself, tracked
            // independent of the requested `produces` (see doc comment above).
            if (config.type === 'shield' && isCasterBasis(config.basis)) {
                bump(producing[slot], normalise(config.basis), config.pct ?? 0);
            }
        }
    }

    return { raw, producing };
}

/** Weights the two cast slots by cast frequency and sums, still in raw percent/multiplier units. */
function combineSlots(
    bySlot: Record<CastSlot, Partial<Record<OffFormulaStat, number>>>,
    wActive: number,
    wCharged: number
): Partial<Record<OffFormulaStat, number>> {
    const stats = new Set<OffFormulaStat>([
        ...(Object.keys(bySlot.active) as OffFormulaStat[]),
        ...(Object.keys(bySlot.charged) as OffFormulaStat[]),
    ]);
    const combined: Partial<Record<OffFormulaStat, number>> = {};
    for (const stat of stats) {
        combined[stat] =
            (bySlot.active[stat] ?? 0) * wActive + (bySlot.charged[stat] ?? 0) * wCharged;
    }
    return combined;
}

/**
 * Every carrier whose ability lives in the PASSIVE slot, regardless of which `produces` a caller
 * later derives a basis for — the notice needs to name every excluded clause on the ship, not
 * only the one relevant to the basis currently being derived (Rikra's repair exclusion still
 * reports even when deriving a `damage` basis). Mirrors `offFormulaStats.ts`'s carrier walk,
 * restricted to the passive slot.
 */
function excludedCarriers(ship: Ship): ExcludedCarrier[] {
    const excluded: ExcludedCarrier[] = [];

    for (const skillSlot of buildShipAbilities(ship).slots ?? []) {
        if (skillSlot.slot !== 'passive') continue;

        for (const ability of skillSlot.abilities ?? []) {
            const config = ability.config as unknown as CarrierConfig;
            if (!config?.type) continue;
            const trigger = ability.trigger as string;

            if (config.type === 'additional-damage' && config.stat) {
                excluded.push({
                    stat: normalise(config.stat),
                    produces: 'damage',
                    pct: config.pct ?? 0,
                    trigger,
                });
            }

            if (config.type === 'heal' && isCasterBasis(config.basis)) {
                excluded.push({
                    stat: normalise(config.basis),
                    produces: 'repair',
                    pct: config.pct ?? 0,
                    trigger,
                });
            }

            if (config.type === 'shield' && isCasterBasis(config.basis)) {
                excluded.push({
                    stat: normalise(config.basis),
                    produces: 'shield',
                    pct: config.pct ?? 0,
                    trigger,
                });
            }

            if (config.type === 'damage') {
                if (config.hpBasisPct) {
                    excluded.push({
                        stat: 'hp',
                        produces: 'damage',
                        pct: config.hpBasisPct,
                        trigger,
                    });
                }
                if (config.shieldBasisPct) {
                    excluded.push({
                        stat: 'shield',
                        produces: 'damage',
                        pct: config.shieldBasisPct,
                        trigger,
                    });
                }
            }
        }
    }

    return excluded;
}

/**
 * Derives the weighted stat basis a ship's parsed kit actually scores `produces` on, blending the
 * active and charged slots by cast frequency (`chargePeriod`). Passive-slot carriers never
 * contribute a term — their trigger frequency is not derivable from static data — but every one
 * found is reported in `excluded` so the caller can say what was left out and why.
 */
export function deriveBasis(ship: Ship, produces: 'damage' | 'repair' | 'shield'): DerivedBasis {
    const period = chargePeriod(ship);
    const wActive = period === 0 ? 1 : (period - 1) / period;
    const wCharged = period === 0 ? 0 : 1 / period;

    const { raw, producing } = collectCastRaw(ship, produces);
    const combinedRaw = combineSlots(raw, wActive, wCharged);
    const combinedProducing = combineSlots(producing, wActive, wCharged);

    // `shield` is never a scorable stat on its own, only a pool another caster stat produces —
    // resolve it to that stat as the PRODUCT of both percentages. If no caster-basis producing
    // clause exists in the active/charged slots (found nowhere, like Quixilver, or found only in
    // a passive, like FrontLine — the general passive walk above reports that case separately),
    // the carrier is dropped with nothing to measure.
    const shieldRaw = combinedRaw.shield ?? 0;
    const finalWeights: Partial<Record<OffFormulaStat, number>> = {};
    for (const stat of STAT_ORDER) {
        const weight = (combinedRaw[stat] ?? 0) / 100;
        if (weight !== 0) finalWeights[stat] = weight;
    }
    if (shieldRaw !== 0) {
        for (const stat of Object.keys(combinedProducing) as OffFormulaStat[]) {
            const producingRaw = combinedProducing[stat] ?? 0;
            if (producingRaw === 0) continue;
            const chainWeight = (shieldRaw / 100) * (producingRaw / 100);
            finalWeights[stat] = (finalWeights[stat] ?? 0) + chainWeight;
        }
    }

    const terms: BasisTerm[] = STAT_ORDER.filter((stat) => (finalWeights[stat] ?? 0) !== 0).map(
        (stat) => ({ stat, weight: finalWeights[stat] as number })
    );

    return { terms, excluded: excludedCarriers(ship), period };
}
