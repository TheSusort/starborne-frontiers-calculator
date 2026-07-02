import type { StatName, StatType } from '../types/stats';
import type { ShipRoleCategory } from './shipTypes';
import type { FactionName } from './factions';

/**
 * Squad Leaders — pre-fight stat-modifier data (combat-realism epic, sub-project F).
 *
 * Each of the 10 factions has exactly THREE squad leaders, one per rarity tier
 * (rare / epic / legendary). Each leader has a name and THREE upgrade stages, and
 * each stage carries a set of effects. Effects fall into three shapes:
 *
 *   1. Raw stat increases        → `kind: 'stat'`     (e.g. +20% Attack to all allies)
 *   2. Combat modifiers          → `kind: 'modifier'` (conditional damage, shield/round, heal mods)
 *   3. Enemy effects             → any of the above with `target: 'all-enemies'` and a NEGATIVE
 *                                  value (decreased enemy stats, reduced enemy damage/heal output)
 *
 * THIS FILE IS DATA-ONLY. No engine wiring lives here — sub-project F will read this const to
 * establish combat-entry base stats. The types mirror the existing combat vocabulary
 * (`Stat`, `ParsedBuffEffects` / `ModifierChannel`, `Condition`) so F can consume it directly.
 *
 * Fill-in convention:
 *   - Always populate `text` with the verbatim in-game tooltip line. It is the source of truth;
 *     the structured fields are best-effort and can be refined later when F models them.
 *   - `stages` are ADDITIVE DELTAS: stages[0] holds only what step I adds, stages[1] only what
 *     step II adds, stages[2] only what step III adds. Steps stack — a leader upgraded to step III
 *     has step I + II + III all active simultaneously.
 *   - `target: 'all-allies'` for a squad leader means "all allied units OF THE LEADER'S FACTION"
 *     (the leader is keyed under that faction below). Auras are faction-gated, not fleet-wide.
 *   - Use signed values: positive = buff to the target, negative = reduction.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SquadLeaderRarity = 'rare' | 'epic' | 'legendary';

/**
 * Who an effect lands on.
 * - 'all-allies'  : all allied units of the LEADER'S faction (auras are faction-gated).
 * - 'all-enemies' : every enemy unit (used for enemy stat / output reductions).
 * - 'self'        : reserved; squad leaders are not deployed units, so rarely used.
 */
export type SquadLeaderTarget = 'all-allies' | 'self' | 'all-enemies';

/**
 * Whether an effect is applied once at combat entry or accrues over the fight.
 * - 'static'    : set once before round 1, constant for the fight (most stat boosts). DEFAULT.
 * - 'per-round' : re-applied / accrues each round (e.g. "generate shield each round").
 */
export type SquadLeaderRecurrence = 'static' | 'per-round';

/**
 * Combat channels a `modifier` effect can push, beyond raw stats.
 * Mirrors `ModifierChannel` / `ParsedBuffEffects` in the combat code, plus shield generation.
 */
export type SquadLeaderModifierChannel =
    | 'outgoingDamage' // dealt damage; + = deals more
    | 'incomingDamage' // taken damage; on enemies + = they take more, on allies - = they take less
    | 'outgoingCritDamage' // crit damage dealt; + = bigger crits
    | 'incomingCritDamage' // crit damage taken; on enemies - = they take smaller crits
    | 'outgoingRepair' // healing/repair output; on enemies - = reduced enemy repair output
    | 'outgoingHeal' // alias of outgoingRepair (game term is "Repair"); kept for compatibility
    | 'incomingHeal' // healing/repair received
    | 'damageReduction' // flat % mitigation
    | 'shieldGeneration'; // shield granted (pair with recurrence: 'per-round' for shield/round)

/**
 * Optional gate for conditional effects (conditional damage/heal, "vs enemies with X", etc.).
 * `text` is required; structured fields mirror `Condition` in `src/types/abilities.ts` and are
 * filled in later when F models the gate.
 */
export interface SquadLeaderCondition {
    /** Verbatim condition text from the tooltip. Source of truth. */
    text: string;
    hpComparator?: 'below' | 'above';
    hpPercent?: number;
    hpSubject?: 'self' | 'ally' | 'enemy';
    /** Requires the subject to carry a named status, e.g. "Concentrate Fire". */
    statusName?: string;
    /** Narrows recipients to a ship role, e.g. only ATTACKER allies. */
    role?: ShipRoleCategory;
}

interface SquadLeaderEffectBase {
    /** Verbatim in-game text for this line. ALWAYS fill this. */
    text: string;
    target: SquadLeaderTarget;
    /** Present only for conditional effects. */
    condition?: SquadLeaderCondition;
    /** Defaults to 'static' when omitted. */
    recurrence?: SquadLeaderRecurrence;
}

export type SquadLeaderEffect =
    | (SquadLeaderEffectBase & {
          kind: 'stat';
          stat: StatName;
          /** Signed. Negative = decrease (use for enemy stat reductions). */
          value: number;
          valueType: StatType; // 'flat' | 'percentage'
      })
    | (SquadLeaderEffectBase & {
          kind: 'modifier';
          channel: SquadLeaderModifierChannel;
          /** Signed percentage unless the channel is noted otherwise. */
          value: number;
      })
    | (SquadLeaderEffectBase & {
          // Escape hatch: capture something not yet expressible above. Fill `text`; model later.
          kind: 'other';
      });

/** One squad leader: a name, its rarity tier, and its three additive upgrade steps. */
export interface SquadLeader {
    name: string;
    rarity: SquadLeaderRarity;
    /** stages[0] = step I, stages[1] = step II, stages[2] = step III. */
    stages: [SquadLeaderEffect[], SquadLeaderEffect[], SquadLeaderEffect[]];
}

// ---------------------------------------------------------------------------
// Data — fill in below. (name + 3 additive steps per leader; one per rarity per faction)
//
// Marauders is filled in as the worked reference. Note how:
//   - each stage holds ONLY that step's added effects (additive),
//   - 'all-allies' = all Marauder units,
//   - enemy reductions use target 'all-enemies' + negative values,
//   - "crit power" maps to the `critDamage` stat,
//   - "direct damage to secondary targets" is a conditional `outgoingDamage` modifier.
// ---------------------------------------------------------------------------

export const SQUAD_LEADERS: Record<FactionName, SquadLeader[]> = {
    ATLAS_SYNDICATE: [
        {
            name: 'Intern',
            rarity: 'rare',
            stages: [
                // I — +3% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Attack',
                    },
                ],
                // II — +2% Attack & +2% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Crit Power',
                    },
                ],
                // III — +3% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Crit Power',
                    },
                ],
            ],
        },
        {
            name: 'Broker',
            rarity: 'epic',
            stages: [
                // I — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // II — +8% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Crit Power',
                    },
                ],
                // III — Start combat shielded for 20% of max HP
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'shieldGeneration',
                        value: 20,
                        text: 'Start combat shielded for 20% of max HP',
                    },
                ],
            ],
        },
        {
            name: 'Negotiator',
            rarity: 'legendary',
            stages: [
                // I — +10% Attack & +10% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Crit Power',
                    },
                ],
                // II - start combat shielded for 25% of max HP
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'shieldGeneration',
                        value: 25,
                        text: 'Start combat shielded for 25% of max HP',
                    },
                ],
                // III - Enemy units lose 15 speed and 10% crit damage
                // ("crit damage" here is the crit-conditional damage MODIFIER — enemies'
                // crits deal 10% less — not the critDamage stat; that would be "Crit Power")
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'speed',
                        value: -15,
                        valueType: 'flat',
                        text: 'Enemy units lose 15 speed',
                    },
                    {
                        kind: 'modifier',
                        target: 'all-enemies',
                        channel: 'outgoingCritDamage',
                        value: -10,
                        text: 'Enemy units lose 10% crit damage',
                    },
                ],
            ],
        },
    ],
    BINDERBURG: [
        {
            name: 'Augmentor',
            rarity: 'rare',
            stages: [
                // I — +3% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% HP',
                    },
                ],
                // II — 2% HP & +10 security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 10,
                        valueType: 'flat',
                        text: '+10 Security',
                    },
                ],
                // III — +20 Security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 Security',
                    },
                ],
            ],
        },
        {
            name: 'Pollinator',
            rarity: 'epic',
            stages: [
                // I — +8% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% HP',
                    },
                ],
                // II — +8% Defense
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Defense',
                    },
                ],
                // III — Gain security equal to 0.8% of the units defense value
                // TODO: needs a derived-value shape (flat security from % of the unit's
                // OWN defence) before it can be structured; 'other' surfaces it as
                // unsimulated instead of mis-folding it as a % security increase.
                [
                    {
                        kind: 'other',
                        target: 'all-allies',
                        text: 'Gain security equal to of 0.8% defense',
                    },
                ],
            ],
        },
        {
            name: 'Swarmcaller',
            rarity: 'legendary',
            stages: [
                // I — +10% HP & +10% Defense
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Defense',
                    },
                ],
                // II — Gain security equal to 1.2% of the units defense value
                // TODO: needs a derived-value shape (flat security from % of the unit's
                // OWN defence) before it can be structured; 'other' surfaces it as
                // unsimulated instead of mis-folding it as a % security increase.
                [
                    {
                        kind: 'other',
                        target: 'all-allies',
                        text: 'Gain security equal to 1.2% of the units defense value',
                    },
                ],
                // III — Enemy units lose 30 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'hacking',
                        value: -30,
                        valueType: 'flat',
                        text: 'Enemy units lose 30 hacking',
                    },
                ],
            ],
        },
    ],
    EVERLIVING: [
        {
            name: 'Elixir',
            rarity: 'rare',
            stages: [
                // I — +3% Defense
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Defense',
                    },
                ],
                // II — +2% Defense & +2% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Defense',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% HP',
                    },
                ],
                // III — +3% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% HP',
                    },
                ],
            ],
        },
        {
            name: 'Soothsayer',
            rarity: 'epic',
            stages: [
                // I — +8% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% HP',
                    },
                ],
                // II — +20 Security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 Security',
                    },
                ],
                // III — +10% Outgoing repair
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingHeal',
                        value: 10,
                        text: '+10% Outgoing repair',
                    },
                ],
            ],
        },
        {
            name: 'Malachi',
            rarity: 'legendary',
            stages: [
                // I — +10% HP & +25 security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 25,
                        valueType: 'flat',
                        text: '+25 Security',
                    },
                ],
                // II — +15% Outgoing repair
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingHeal',
                        value: 15,
                        text: '+15% Outgoing repair',
                    },
                ],
                // III — Enemy ships get -15% Outgoing repair
                [
                    {
                        kind: 'modifier',
                        target: 'all-enemies',
                        channel: 'outgoingHeal',
                        value: -15,
                        text: 'Enemy ships get -15% Outgoing repair',
                    },
                ],
            ],
        },
    ],
    FRONTIER_LEGION: [
        {
            name: 'Corporal',
            rarity: 'rare',
            stages: [
                // I — +3% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Attack',
                    },
                ],
                // II — +2% Attack & +2% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Crit Power',
                    },
                ],
                // III — +3% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Crit Power',
                    },
                ],
            ],
        },
        {
            name: 'Lieutenant',
            rarity: 'epic',
            stages: [
                // I — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // II — +8% Defense Penetration
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defensePenetration',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Defense Penetration',
                    },
                ],
                // III — +5% attack for each other alive Legion ally
                // TODO: add an effect for this
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 5,
                        valueType: 'percentage',
                        text: '+5% attack for each other alive Legion ally',
                    },
                ],
            ],
        },
        {
            name: 'Colonel',
            rarity: 'legendary',
            stages: [
                // I — +10% Attack & +7.5% Defense Penetration
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defensePenetration',
                        value: 7.5,
                        valueType: 'percentage',
                        text: '+7.5% Defense Penetration',
                    },
                ],
                // II — +7.5% attack for each other alive Legion ally
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 7.5,
                        valueType: 'percentage',
                        text: '+7.5% attack for each other alive Legion ally',
                    },
                ],
                // III — Enemy units lose 15% attack
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'attack',
                        value: -15,
                        valueType: 'percentage',
                        text: 'Enemy units lose 15% attack',
                    },
                ],
            ],
        },
    ],
    GELECEK: [
        {
            name: 'Chimera',
            rarity: 'rare',
            stages: [
                // I — +5 Hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Hacking',
                    },
                ],
                // II — +5 Speed & +5 Hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Speed',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Hacking',
                    },
                ],
                // III - +5 speed
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Speed',
                    },
                ],
            ],
        },
        {
            name: 'Medusa',
            rarity: 'epic',
            stages: [
                // I — +20 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 Hacking',
                    },
                ],
                // II — +8% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% HP',
                    },
                ],
                // III — Repairs 5% HP after inflicting a debuff on an enemy
                // TODO: add an effect for this
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingHeal',
                        value: 5,
                        text: 'Repairs 5% HP after inflicting a debuff on an enemy',
                    },
                ],
            ],
        },
        {
            name: 'Cerberus',
            rarity: 'legendary',
            stages: [
                // I — +10% HP & +25 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 25,
                        valueType: 'flat',
                        text: '+25 Hacking',
                    },
                ],
                // II — Repairs 7.5% HP after inflicting a debuff on an enemy
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingHeal',
                        value: 7.5,
                        text: 'Repairs 7.5% HP after inflicting a debuff on an enemy',
                    },
                ],
                // III — Enemy units lose 30 security
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'security',
                        value: -30,
                        valueType: 'flat',
                        text: 'Enemy units lose 30 security',
                    },
                ],
            ],
        },
    ],
    MPL: [
        {
            name: 'Gold Digger',
            rarity: 'rare',
            stages: [
                // I — +3% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% HP',
                    },
                ],
                // II — +10 security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 10,
                        valueType: 'flat',
                        text: '+10 security',
                    },
                ],
                // III — +20 security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 security',
                    },
                ],
            ],
        },
        {
            name: 'Overseer',
            rarity: 'epic',
            stages: [
                // I — +8% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% HP',
                    },
                ],
                // II — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // III — -5% incoming direct damage (protection: MPL allies take 5% less)
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingDamage',
                        value: -5,
                        text: '-5% incoming direct damage',
                    },
                ],
            ],
        },
        {
            name: 'Midas',
            rarity: 'legendary',
            stages: [
                // I — +10% HP & +10% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                ],
                // II - -7.5% incoming direct damage (protection: MPL allies take 7.5% less)
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingDamage',
                        value: -7.5,
                        text: '-7.5% incoming direct damage',
                    },
                ],
                // III - Enemy units lose 15% crit rate
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'crit',
                        value: -15,
                        valueType: 'percentage',
                        text: 'Enemy units lose 15% crit rate',
                    },
                ],
            ],
        },
    ],
    MARAUDERS: [
        {
            name: 'Puppet',
            rarity: 'rare',
            stages: [
                // I — +5 Hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Hacking',
                    },
                ],
                // II — +5 Speed & +5 Hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Speed',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Hacking',
                    },
                ],
                // III — +5 Speed
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 Speed',
                    },
                ],
            ],
        },
        {
            name: 'Reaper',
            rarity: 'epic',
            stages: [
                // I — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // II — +8% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Crit Power',
                    },
                ],
                // III — +20% direct damage to secondary targets
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingDamage',
                        value: 20,
                        condition: { text: 'direct damage to secondary targets' },
                        text: '+20% direct damage to secondary targets',
                    },
                ],
            ],
        },
        {
            name: 'Brandisher',
            rarity: 'legendary',
            stages: [
                // I — +10% Attack & +10% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Crit Power',
                    },
                ],
                // II — +25% direct damage to secondary targets
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingDamage',
                        value: 25,
                        condition: { text: 'direct damage to secondary targets' },
                        text: '+25% direct damage to secondary targets',
                    },
                ],
                // III — Enemy units lose 15 Security and 10% Defence
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'security',
                        value: -15,
                        valueType: 'flat',
                        text: 'Enemy units lose 15 Security',
                    },
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'defence',
                        value: -10,
                        valueType: 'percentage',
                        text: 'Enemy units lose 10% Defence',
                    },
                ],
            ],
        },
    ],
    TERRAN_COMBINE: [
        {
            name: 'Prototype',
            rarity: 'rare',
            stages: [
                // I — +3% defence
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Defence',
                    },
                ],
                // II — +2% defence & +2% hp
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Defence',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% HP',
                    },
                ],
                // III — +3% hp
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% HP',
                    },
                ],
            ],
        },
        {
            name: 'Optimizer',
            rarity: 'epic',
            stages: [
                // I — +8% Defense
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Defence',
                    },
                ],
                // II — +20 Security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 Security',
                    },
                ],
                // III — -10% incoming crit damage (protection: Terran allies take 10%
                // smaller crits — a crit-conditional damage modifier, NOT the critDamage stat)
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingCritDamage',
                        value: -10,
                        text: '-10% incoming crit damage',
                    },
                ],
            ],
        },
        {
            name: 'Architect',
            rarity: 'legendary',
            stages: [
                // I — +10% Defense & +25 Security
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'defence',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Defence',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'security',
                        value: 25,
                        valueType: 'flat',
                        text: '+25 Security',
                    },
                ],
                // II — -15% incoming crit damage (protection: Terran allies take 15%
                // smaller crits — a crit-conditional damage modifier, NOT the critDamage stat)
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'incomingCritDamage',
                        value: -15,
                        text: '-15% incoming crit damage',
                    },
                ],
                // III — Enemy units lose 20% Defence
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'defence',
                        value: -20,
                        valueType: 'percentage',
                        text: 'Enemy units lose 20% Defence',
                    },
                ],
            ],
        },
    ],
    TIANCHAO: [
        {
            name: 'Infiltrator',
            rarity: 'rare',
            stages: [
                // I — +5 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 hacking',
                    },
                ],
                // II — +5 speed & +5 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 speed',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 hacking',
                    },
                ],
                // III — +5 speed
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'speed',
                        value: 5,
                        valueType: 'flat',
                        text: '+5 speed',
                    },
                ],
            ],
        },
        {
            name: 'Cipher',
            rarity: 'epic',
            stages: [
                // I — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // II — +20 hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 20,
                        valueType: 'flat',
                        text: '+20 hacking',
                    },
                ],
                // III — +10% outgoing crit damage while in Stealth.
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingCritDamage',
                        value: 10,
                        condition: { text: 'while in Stealth' },
                        text: '+10% outgoing crit damage while in Stealth.',
                    },
                ],
            ],
        },
        {
            name: 'Serpent',
            rarity: 'legendary',
            stages: [
                // I — +10% Attack & +25 Hacking
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hacking',
                        value: 25,
                        valueType: 'flat',
                        text: '+25 Hacking',
                    },
                ],
                // II — +15% outgoing crit damage while in Stealth.
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingCritDamage',
                        value: 15,
                        condition: { text: 'while in Stealth' },
                        text: '+15% outgoing crit damage while in Stealth.',
                    },
                ],
                // III — Enemy units lose 25% crit power
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'critDamage',
                        value: -25,
                        valueType: 'percentage',
                        text: 'Enemy units lose 25% crit power',
                    },
                ],
            ],
        },
    ],
    XAOC: [
        {
            name: 'Genghis',
            rarity: 'rare',
            stages: [
                // I — +3% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Attack',
                    },
                ],
                // II — +2% Attack & +2% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Attack',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 2,
                        valueType: 'percentage',
                        text: '+2% Crit Power',
                    },
                ],
                // III — +3% Crit Power
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'critDamage',
                        value: 3,
                        valueType: 'percentage',
                        text: '+3% Crit Power',
                    },
                ],
            ],
        },
        {
            name: 'Predator',
            rarity: 'epic',
            stages: [
                // I — +8% HP
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% HP',
                    },
                ],
                // II — +8% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 8,
                        valueType: 'percentage',
                        text: '+8% Attack',
                    },
                ],
                // III — +5% Outgoing direct damage
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingDamage',
                        value: 5,
                        text: '+5% Outgoing direct damage',
                    },
                ],
            ],
        },
        {
            name: 'Viper',
            rarity: 'legendary',
            stages: [
                // I — +10% HP & +10% Attack
                [
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'hp',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% HP',
                    },
                    {
                        kind: 'stat',
                        target: 'all-allies',
                        stat: 'attack',
                        value: 10,
                        valueType: 'percentage',
                        text: '+10% Attack',
                    },
                ],
                // II — +7.5% Outgoing direct damage
                [
                    {
                        kind: 'modifier',
                        target: 'all-allies',
                        channel: 'outgoingDamage',
                        value: 7.5,
                        text: '+7.5% Outgoing direct damage',
                    },
                ],
                // III — Enemy units lose 20 speed
                [
                    {
                        kind: 'stat',
                        target: 'all-enemies',
                        stat: 'speed',
                        value: -20,
                        valueType: 'flat',
                        text: 'Enemy units lose 20 speed',
                    },
                ],
            ],
        },
    ],
};
