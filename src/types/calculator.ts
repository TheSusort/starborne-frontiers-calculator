import { AffinityName } from './ship';
import type { ShipSkills } from './abilities';

export type StackTrigger = 'per-round' | 'per-active' | 'per-charge';

export type SecondaryDamageStat = 'defense' | 'hp';

export interface SecondaryDamage {
    stat: SecondaryDamageStat;
    pct: number; // e.g. 80 for "80% of Defense"
}

export type ConditionalCondition =
    | 'self-buff' // derivable
    | 'enemy-debuff' // derivable
    | 'enemy-buff' // manual
    | 'adjacent-ally' // manual
    | 'enemy-adjacent' // manual
    | 'enemy-destroyed' // manual
    | 'always' // unconditional / always-true under sim assumptions (charge gains)
    | 'self-crit' // derivable from crit rate (charge gains)
    | 'enemy-type'; // derivable from the global enemy-type input (charge gains)

export interface ConditionalDamage {
    pct: number; // per-unit bonus % added to the skill multiplier
    condition: ConditionalCondition;
    derivable: boolean; // true → count from sim state; false → manual
    manualCount?: number; // used when !derivable (default 1)
    cap?: number; // optional total-bonus ceiling ("up to 100%")
    requiredEnemyType?: EnemyBaseClass; // for 'enemy-type' conditions (e.g. bonus vs Supporters)
}

export type EnemyBaseClass = 'Attacker' | 'Defender' | 'Debuffer' | 'Supporter';

export interface ChargeGain {
    amount: number; // charges per trigger (e.g. 1, 2)
    condition: ConditionalCondition;
    derivable: boolean; // true → read sim state; false → use manualCount
    manualCount?: number; // used when !derivable (default 1)
    requiredEnemyType?: EnemyBaseClass; // only for condition 'enemy-type'
    // Reactive event the charge gain fires on (set for inflict-driven charge gains).
    // When present, the gain is per-event (+amount each fire) rather than a per-standing
    // count condition, and `condition` is 'always'.
    trigger?: 'on-debuff-inflicted' | 'on-ally-debuff-inflicted';
}

export const CONDITIONAL_CONDITION_LABELS: Record<ConditionalCondition, string> = {
    'self-buff': 'per buff on this unit',
    'enemy-debuff': 'per debuff on the enemy',
    'enemy-buff': 'per buff on the enemy',
    'adjacent-ally': 'per adjacent ally',
    'enemy-adjacent': 'per unit adjacent to the enemy',
    'enemy-destroyed': 'per destroyed enemy',
    always: 'every round',
    'self-crit': 'on critical hit',
    'enemy-type': 'when enemy matches type',
};

export interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage' | 'defence' | 'hp';
    value: number;
}

export type DoTType = 'corrosion' | 'inferno' | 'bomb';

export interface DoTApplicationEntry {
    id: string;
    type: DoTType;
    tier: number; // 3/6/9 for corrosion, 15/30/45 for inferno, 100/200/300 for bomb
    stacks: number; // stacks applied per use
    duration: number; // rounds before expiry (corrosion/inferno), or countdown for bombs
    autoFilled?: boolean;
}

export type DoTApplicationConfig = DoTApplicationEntry[];

export const DEFAULT_DOT_CONFIG: DoTApplicationConfig = [];

export interface ParsedBuffEffects {
    // Attacker-side
    attack?: number; // multiplicative: +30 means ×1.30 on attack
    crit?: number; // additive on crit rate
    critDamage?: number; // additive on crit damage
    outgoingDamage?: number; // multiplicative on direct damage
    defensePenetration?: number; // additive with per-ship defPen value
    dotDamage?: number; // from Out. DoT buffs; multiplicative on corrosion+inferno
    outgoingHeal?: number; // multiplicative on outgoing healing (like outgoingDamage for DPS)
    hp?: number; // multiplicative on max HP (for secondary HP-based damage); future-proofing

    // Receiver-side (healer targets)
    incomingHeal?: number; // additive on incoming repair received

    // Enemy-side
    defense?: number; // modifier on enemyDefense: -30 means enemy defense × 0.70
    incomingDamage?: number; // positive = enemy takes more direct damage
    incomingDotDamage?: number; // from Inc. DoT buffs; positive = enemy takes more DoT

    speed?: number; // additive percentage modifier on speed (+30 = +30%)

    // Flat stats (not percentages)
    security?: number; // flat additive on security stat
}

export interface SelectedGameBuff {
    id: string; // unique instance id (counter-based)
    buffName: string; // matches BUFFS[].name
    stacks: number; // 1 by default; >1 for stackable buffs
    parsedEffects: ParsedBuffEffects; // effects for 1 stack
    isStackable: boolean;
    maxStacks?: number; // e.g. 10 for "up to 10 times"
    autoFilled?: boolean; // true when populated from skill text parsing
    skillSource?: 'active' | 'charge' | 'passive1' | 'passive2' | 'passive3';
    skillDuration?: number | 'recurring' | null;
    // For auto-filled enemy debuffs: the charge schedule of the ship that applies this debuff.
    // Used so the debuff fires on the applier's schedule, not the simulated ship's schedule.
    /** @deprecated Superseded by per-team-actor chargeCount/startCharged (TeamActorInput); ignored by the action-fed status engine. */
    sourceChargeCount?: number;
    /** @deprecated Superseded by per-team-actor chargeCount/startCharged (TeamActorInput); ignored by the action-fed status engine. */
    sourceStartCharged?: boolean;
    // For accumulating stackable buffs: how stacks are gained over rounds.
    // When set, `stacks` is the rate (stacks per trigger), not the total.
    stackTrigger?: StackTrigger;
    // For enemy debuffs: 'inflict' (resistible) vs 'apply' (guaranteed), parsed from the skill verb.
    application?: 'inflict' | 'apply';
    /** Parser ally-scope (team walk): granular target of the granting clause; absent on manual picks. */
    effectTarget?: 'self' | 'ally' | 'all-allies' | 'enemy';
}

export interface DPSShipConfig {
    id: string;
    shipId?: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    hacking?: number;
    affinity?: AffinityName;
    defence: number; // source stat for Defense-based secondary damage
    hp: number; // source stat for HP-based secondary damage
    speed: number; // turn-order speed; auto-filled from ship stats
    chargeCount: number;
    startCharged: boolean;
    allyChargePerRound?: number;
    shipSkills: ShipSkills;
}

export type DPSShipConfigUpdateableField =
    | 'name'
    | 'attack'
    | 'crit'
    | 'critDamage'
    | 'defensePenetration'
    | 'hacking'
    | 'affinity'
    | 'chargeCount'
    | 'defence'
    | 'hp'
    | 'speed';

export interface AttackerBuffTotals {
    attackBuff: number;
    critBuff: number;
    critDamageBuff: number;
}

export interface HealingBuffTotals {
    critBuff: number;
    critDamageBuff: number;
    outgoingHealBuff: number;
    incomingHealBuff: number;
}

export interface DefenseBuffTotals {
    defenseBuff: number;
    incomingDamageBuff: number;
    securityBuff: number;
}

export interface DefenseShipConfig {
    id: string;
    shipId?: string;
    name: string;
    hp: number;
    defense: number;
    security: number;
    effectiveHP?: number;
    damageReduction?: number;
    buffs: SelectedGameBuff[];
}

export interface HealerConfig {
    id: string;
    shipId?: string;
    name: string;
    hp: number;
    healPercent: number;
    healPercentAutoFilled?: boolean;
    chargedHealPercent: number;
    chargedHealPercentAutoFilled?: boolean;
    chargeCount: number;
    startCharged: boolean;
    crit: number;
    critDamage: number;
    healModifier: number;
    healModifierAutoFilled?: boolean;
    buffs: SelectedGameBuff[];
}

export type HealerConfigUpdateableField =
    | 'name'
    | 'hp'
    | 'healPercent'
    | 'chargedHealPercent'
    | 'chargeCount'
    | 'crit'
    | 'critDamage'
    | 'healModifier';

/** Shared stat block for walked team actors — covers every stat that influences damage,
 *  debuff landing, and secondary (Defense/HP-based) damage calculations. */
export interface CombatStatBlock {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    hacking: number;
    defence: number; // source stat for Defense-based secondary damage
    hp: number; // source stat for HP-based secondary damage
}

export interface TeamShipConfig {
    id: string;
    shipId?: string;
    buffs: SelectedGameBuff[]; // manual extra buffs granted to attacker → merge into global attackerBuffs
    enemyDebuffs: SelectedGameBuff[]; // manual extra enemy debuffs → merge into global enemyBuffs
    startCharged: boolean; // auto-filled via detectFullyCharged; user-editable
    speed: number; // turn-order speed; auto-filled from ship stats
    chargeCount: number; // charge threshold; auto-filled from skill rows
    /** Walked skills for this team actor (auto-filled on ship pick; editable per slot). */
    shipSkills?: ShipSkills;
    /** Combat stats for the walked team actor (auto-filled from the ship; editable). */
    stats?: CombatStatBlock;
    /** Affinity for the walked team actor — vs the enemy affinity yields its own modifiers. */
    affinity?: AffinityName;
}

/** A team ship as a real combat actor (Phase 2). Buff lists are the existing
 *  parsed SelectedGameBuff shapes, re-timed onto this actor's real turns. */
export interface TeamActorInput {
    id: string;
    /** Turn-order speed. Default 100. */
    speed: number;
    chargeCount: number;
    startCharged: boolean;
    /** Buffs granted to the attacker, keyed by skillSource to this actor's turns. */
    selfBuffs: SelectedGameBuff[];
    /** Debuffs inflicted on the enemy, keyed by skillSource to this actor's turns. */
    enemyDebuffs: SelectedGameBuff[];
    /** When present, this actor WALKS its parsed skills through runPlayerTurn (Task 4):
     *  its self-targeted buffs route to itself, enemy-targeted debuffs/DoTs to the enemy,
     *  and its damage reduces enemy HP (reported separately as teamDamage). Without it the
     *  actor stays a legacy scheduled-list source (byte-identical to pre-walk behaviour). */
    shipSkills?: ShipSkills;
    /** Combat stats for a walked team actor (auto-filled from the ship; required when
     *  shipSkills is present so its damage/DoT ticks scale with its OWN attack). */
    stats?: CombatStatBlock;
    /** Affinity for a walked team actor — vs the enemy affinity yields its own damage/crit
     *  modifiers (computeAffinityModifiers). Absent → neutral defaults. */
    affinity?: AffinityName;
}
