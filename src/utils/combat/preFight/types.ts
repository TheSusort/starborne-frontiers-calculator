/**
 * Pre-fight stat-modifier layer — shared types.
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
 * percentage points (0 = inert): attack, outgoing/incoming damage, crit-damage and heal
 * scaling, plus `startingShieldPctOfHp` (starting shield pool as % of max HP).
 *
 * The squad-leader pass accumulates these; the battle simulator attaches the block to each
 * unit's engine actor (`CombatActor.preFight`) and the engine folds every channel at its
 * consumption site:
 *   - attackPct: into the additive attack-buff term of every effective-attack fold (R200), so
 *     it adds with Attack Up/Down rather than pre-multiplying the base. A reader that wants the
 *     pre-buff attack sheet reads `leaderScaledAttack`.
 *   - outgoingDamage: its own `(1 + x/100)` factor on direct hits, outside the Out. Damage
 *     buff sum (R199).
 *   - outgoingHeal/incomingHeal: into the heal-buff totals.
 *   - incomingDamage: a separate factor composed in `hitReductionFor`.
 *   - incoming/outgoingCritDamage: at the crit-family damage sites (crit-conditional damage
 *     modifiers — NOT the Crit Power stat).
 *   - startingShieldPctOfHp: the starting shieldPool.
 */
export interface PreFightCombatModifiers {
    /** Squad-leader attack %, summed over both leaders (own buff, opposing debuff). */
    attackPct: number;
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
        attackPct: 0,
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
 *  along (a leader whose effects are all stat effects other than attack % leaves the run
 *  structurally identical to a no-leader run). */
export function hasAnyPreFightModifier(m: PreFightCombatModifiers): boolean {
    return Object.values(m).some((v) => v !== 0);
}

/**
 * The pre-fight attack sheet: base attack with the squad-leader attack % applied, floored at 0.
 * `stats.attack` itself stays the un-scaled base, because the effective-attack folds add the
 * leader % to the attack buffs (R200). Every reader that is not one of those folds and wants
 * "attack before any buff" — pre-combat stat grants, a pre-first-turn attack basis — reads
 * this instead of `stats.attack`.
 */
export function leaderScaledAttack(
    attack: number,
    modifiers: Pick<PreFightCombatModifiers, 'attackPct'> | undefined
): number {
    return Math.max(0, attack * (1 + (modifiers?.attackPct ?? 0) / 100));
}

/** One placed unit as the pre-fight passes see it. */
export interface PreFightUnit {
    id: string;
    side: 'player' | 'enemy';
    /** Raw `Ship.faction` — `string`, not `FactionName`, since it is threaded straight through
     *  from the ship without narrowing. An unrecognised faction simply matches no squad leader's
     *  faction, which is the correct "no ally to grant to" outcome. */
    faction: string;
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
