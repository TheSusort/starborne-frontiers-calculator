import { AffinityName } from './ship';

export interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
    value: number;
}

export type DoTType = 'corrosion' | 'inferno' | 'bomb';

export interface DoTApplicationEntry {
    id: string;
    type: DoTType;
    tier: number; // 3/6/9 for corrosion, 15/30/45 for inferno, 100/200/300 for bomb
    stacks: number; // stacks applied per use
    duration: number; // rounds before expiry (corrosion/inferno), or countdown for bombs
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
}

export interface DPSShipConfig {
    id: string;
    shipId?: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    affinity?: AffinityName;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    startCharged: boolean;
    autoFilledFields?: Set<'activeMultiplier' | 'chargedMultiplier'>;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
    buffs: SelectedGameBuff[];
}

export type DPSShipConfigUpdateableField =
    | 'name'
    | 'attack'
    | 'crit'
    | 'critDamage'
    | 'defensePenetration'
    | 'affinity'
    | 'activeMultiplier'
    | 'chargedMultiplier'
    | 'chargeCount';

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
