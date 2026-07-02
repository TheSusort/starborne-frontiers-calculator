/**
 * Pre-fight stat-modifier layer (combat-realism sub-project F) — shared types.
 *
 * The layer runs ONCE in `simulateBattle`, after the placement plans are built and
 * BEFORE any actor/roster construction. Passes mutate each unit's `stats` (shared BY
 * REFERENCE with the caller's plan stats) in place, so roster maxHp, currentHp seeding,
 * turn order and landing math all inherit the modified values automatically. With no
 * pass input the layer is an exact no-op — the engine is untouched.
 */
import type { FactionName } from '../../../constants/factions';

/** The 10 numeric combat stats the pre-fight layer can modify. Structural — the battle
 *  simulator's private `DerivedCombatStats` satisfies it as-is. */
export interface PreFightStatBlock {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    shieldPenetration: number;
    hacking: number;
    security: number;
    defence: number;
    hp: number;
    speed: number;
}

/**
 * Pre-fight combat-modifier channels beyond raw stats. All values are ADDITIVE
 * percentage points (0 = inert): outgoing/incoming damage, crit-damage and heal
 * scaling, plus `startingShieldPctOfHp` (starting shield pool as % of max HP).
 *
 * The squad-leader pass accumulates these (F1); the battle simulator attaches the
 * block to each unit's engine actor (`CombatActor.preFight`) and the engine folds
 * every channel at its consumption site (F3): outgoingDamage/outgoingHeal/incomingHeal
 * into the self-buff totals, incomingDamage into the per-victim incoming channel,
 * incoming/outgoingCritDamage at the crit-family damage sites (crit-conditional damage
 * modifiers — NOT the Crit Power stat), startingShieldPctOfHp as the starting shieldPool.
 */
export interface PreFightCombatModifiers {
    outgoingDamage: number;
    outgoingCritDamage: number;
    incomingDamage: number;
    incomingCritDamage: number;
    outgoingHeal: number;
    incomingHeal: number;
    startingShieldPctOfHp: number;
}

/** A fresh all-zero (inert) modifier block. */
export function emptyPreFightModifiers(): PreFightCombatModifiers {
    return {
        outgoingDamage: 0,
        outgoingCritDamage: 0,
        incomingDamage: 0,
        incomingCritDamage: 0,
        outgoingHeal: 0,
        incomingHeal: 0,
        startingShieldPctOfHp: 0,
    };
}

/** True when at least one modifier channel is non-zero. The battle simulator attaches a
 *  unit's block to its engine actor ONLY in that case, so an all-zero block never rides
 *  along (keeps stat-only-leader runs structurally identical to no-modifier runs). */
export function hasAnyPreFightModifier(m: PreFightCombatModifiers): boolean {
    return Object.values(m).some((v) => v !== 0);
}

/** One placed unit as the pre-fight passes see it. */
export interface PreFightUnit {
    id: string;
    side: 'player' | 'enemy';
    faction: FactionName;
    /** Shared BY REFERENCE with the caller's plan stats — passes mutate it in place. */
    stats: PreFightStatBlock;
    /** Modifier-channel baseline accumulated by passes (consumed by the engine in F3). */
    modifiers: PreFightCombatModifiers;
    /** Verbatim effect texts that landed on this unit but are NOT simulated (yet). */
    unsimulated: string[];
}

/** A pre-fight pass: mutates the units of both sides in place. */
export type PreFightPass = (ctx: { player: PreFightUnit[]; enemy: PreFightUnit[] }) => void;

/** A side's squad-leader choice: faction + leader name + upgrade stage (I/II/III). */
export interface SquadLeaderSelection {
    faction: FactionName;
    name: string;
    stage: 1 | 2 | 3;
}
