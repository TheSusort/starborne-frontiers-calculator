/**
 * buildEquipmentAbilities
 *
 * Turns a ship's equipped gear sets + implants into a list of Ability objects
 * that the combat engine can consume.
 *
 * Gear-set abilities are resolved via GEAR_SET_ABILITIES (currently: Leech).
 * Implant abilities are resolved via IMPLANT_ABILITIES (currently: Bloodthirst,
 * Intrusion, Arcane Siege, Warpstrike).
 *
 * D-PR1 approach (registry, not text-parsing): effect values are baked from the
 * source data in implants.ts / gearSets.ts per the registries above. A variant's
 * `description` is used only as a PRESENCE gate (stat-only variants have none and are
 * skipped) — its text is NOT parsed. A future PR may add a text-parse path for
 * implants whose phrasing the skill parser can handle; until then, new effects need a
 * registry entry. Merged into the passive slot by buildShipAbilitiesWithEquipment.
 *
 * It is pure: no side effects, no throws out of the function.
 *
 * Modeling note: noCrit:true on the Leech set heal — a derived-from-damage leech
 * doesn't roll its own heal-crit; flagged as a modeling choice for reviewer confirmation.
 */

import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { BUFFS } from '../../constants/buffs';
import { parseBuffEffects, isStackable } from '../calculators/buffParser';
import { GearPiece } from '../../types/gear';
import {
    Ability,
    AbilityTarget,
    AbilityTrigger,
    Condition,
    HealAmpCondition,
    IncomingCondition,
    OutgoingCondition,
} from '../../types/abilities';
import { Ship } from '../../types/ship';

// ---------------------------------------------------------------------------
// Gear-set ability registry (D-PR1: Leech; D-PR3: Hardened)
// ---------------------------------------------------------------------------

const GEAR_SET_ABILITIES: Partial<Record<string, () => Omit<Ability, 'id'>>> = {
    LEECH: () => ({
        type: 'heal',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: 15, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
        autoFilled: true,
    }),
    // Hardened: reduce incoming direct-damage crits by 5% (crit-reduction family).
    HARDENED: () => ({
        type: 'incoming-reduction',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'incoming-crit',
            pct: 5,
            critFamily: true,
        },
        autoFilled: true,
    }),
};

// ---------------------------------------------------------------------------
// Implant ability registry (D-PR1: Bloodthirst; D-PR2: Intrusion, Arcane Siege, Warpstrike)
// ---------------------------------------------------------------------------
//
// Each entry maps an implant name to a per-rarity builder.  A builder returns
// an Ability (minus `id`) or undefined when the rarity is unsupported.

type ImplantAbilityBuilder = (
    rarity: string
) => Omit<Ability, 'id'> | Omit<Ability, 'id'>[] | undefined;

const BLOODTHIRST_HEAL_PCT: Record<string, number> = {
    uncommon: 12,
    epic: 17,
    legendary: 20,
};

const BLOODTHIRST_PROC_CHANCE: Record<string, number> = {
    uncommon: 0.12,
    epic: 0.17,
    legendary: 0.2,
};

const INTRUSION_PER_DEBUFF: Record<string, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
};

const ARCANE_SIEGE_PCT: Record<string, number> = {
    common: 3,
    uncommon: 6,
    rare: 10,
    epic: 15,
    legendary: 20,
};

const WARPSTRIKE_PCT: Record<string, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
};

// D-PR3: incoming-reduction implant value tables
const VOIDSHADE_PCT: Record<string, number> = {
    common: 4,
    uncommon: 8,
    rare: 12,
    epic: 16,
    legendary: 20,
};
const NEBULA_PCT: Record<string, number> = {
    common: 7,
    uncommon: 14,
    rare: 21,
    epic: 28,
    legendary: 35,
};
const HYPERION_PCT: Record<string, number> = {
    common: 7,
    uncommon: 14,
    rare: 21,
    epic: 28,
    legendary: 35,
};
const VORTEX_VEIL_PCT: Record<string, number> = {
    common: 6,
    uncommon: 12,
    rare: 18,
    epic: 24,
    legendary: 30,
};

// D-PR3: incoming-block implant value tables
const IRONCLAD_BLOCK: Record<string, { chance: number; pct: number }> = {
    common: { chance: 0.1, pct: 0.3 },
    rare: { chance: 0.14, pct: 0.4 },
    epic: { chance: 0.16, pct: 0.45 },
    legendary: { chance: 0.2, pct: 0.5 },
};
const SHADOWGUARD_CHANCE: Record<string, number> = { uncommon: 0.07, epic: 0.12, legendary: 0.16 };

// D-PR4: Insidiousness reactive-damage-on-debuff implant value tables
const INSIDIOUSNESS_MULT: Record<string, number> = {
    common: 60,
    uncommon: 70,
    rare: 80,
    epic: 90,
    legendary: 100,
};
const INSIDIOUSNESS_PROC: Record<string, number> = {
    common: 0.1,
    uncommon: 0.12,
    rare: 0.14,
    epic: 0.17,
    legendary: 0.21,
};

// D-PR4: outgoing-amplification implant value tables
const MENACE_AMP: Record<string, number> = {
    common: 20,
    uncommon: 25,
    rare: 30,
    epic: 35,
    legendary: 45,
};
const MENACE_PROC: Record<string, number> = {
    common: 0.08,
    uncommon: 0.09,
    rare: 0.1,
    epic: 0.11,
    legendary: 0.12,
};
// No common rarity for Giant Slayer
const GIANT_SLAYER_PROC: Record<string, number> = {
    uncommon: 0.12,
    rare: 0.14,
    epic: 0.16,
    legendary: 0.2,
};

// D-PR5: Second Wind reactive self-heal on crit-received value table
const SECOND_WIND_PROC: Record<string, number> = {
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};

// D-PR5: heal-amplification implant value tables
// No common rarity for Nourishment
const NOURISHMENT_AMP: Record<string, number> = { uncommon: 10, rare: 15, epic: 20, legendary: 30 };
// No common/uncommon rarity for Vivacious Repair
const VIVACIOUS_PROC: Record<string, number> = { rare: 0.21, epic: 0.26, legendary: 0.32 };

// D-PR7: on-death implant value tables
// Last Wish: repair all allies % of their max HP on death. No common variant.
const LAST_WISH_PCT: Record<string, number> = { uncommon: 14, rare: 19, epic: 25, legendary: 32 };
// Battlecry: grant all allies a named defensive buff on death. Per-rarity = DURATION only;
// magnitude is intrinsic to the buff tier. No uncommon variant.
const BATTLECRY_DURATION: Record<string, number> = { common: 1, rare: 2, epic: 2, legendary: 3 };
// Martyrdom: apply a named debuff to the killer on death. Only rare + legendary variants.
const MARTYRDOM_DURATION: Record<string, number> = { rare: 1, legendary: 2 };

// D-PR8: reactive self-buff implant value tables
// Ambush: start-of-round, if Stealthed, X% chance to gain Crit Power Up III for 1 turn.
const AMBUSH_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
// Alacrity: end-of-round, if not hit, X% chance to gain Speed Up III for 2 turns. No common variant.
const ALACRITY_PROC: Record<string, number> = {
    uncommon: 0.12,
    rare: 0.14,
    epic: 0.16,
    legendary: 0.2,
};

// D-PR9: Spearhead — after the charged skill, X% chance to grant all allies Attack Up I for 1 turn.
const SPEARHEAD_PROC: Record<string, number> = {
    common: 0.15,
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};

// D-PR9: Font of Power — when repairing another ally, X% chance to grant the repaired
// allies Power Infused Nanobots for 1 turn. Rare/epic/legendary only. D-PR10: the buff
// grants flat attack = 100% of the caster's attack (snapshotted at grant time).
const FONT_OF_POWER_PROC: Record<string, number> = {
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};

// D-PR11: Fortifying Shroud — start-of-turn proc chance to grant adjacent allies Defense Up I.
// No common variant.
const FORTIFYING_SHROUD_PROC_CHANCE: Record<string, number> = {
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};

// D-PR14: Bulwark — X% chance, when an adjacent ally is directly damaged, apply Provoke 1 turn, once per round.
const BULWARK_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
// D-PR14: Doomsayer — at end of round, if first to activate, X% chance to apply Concentrate Fire
// to the highest-attack enemy 1 turn. No common variant. (Proc from THIS table, not the
// description text — Doomsayer's legendary text has a "change"/"chance" typo.)
const DOOMSAYER_PROC: Record<string, number> = {
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
// D-PR16: Firewall — when debuffed, X% chance to gain Block Debuff (self) for 1 turn.
const FIREWALL_PROC: Record<string, number> = {
    uncommon: 0.08,
    rare: 0.1,
    epic: 0.12,
    legendary: 0.15,
};
const LOCKDOWN_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
const TENACITY_PROC: Record<string, number> = { rare: 0.1, epic: 0.12, legendary: 0.16 };
// D-PR16: Last Stand — when this unit becomes the last one standing, X% chance to gain Barrier
// AND Block Debuff (self) for 1 turn. All four rarities are uniform per the source data.
const LAST_STAND_PROC: Record<string, number> = {
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};

// D-PR16: Reactive Ward — X% chance, when directly damaged, to cleanse 1 debuff (2 if crit).
// No rare variant exists in implants.ts.
const REACTIVE_WARD_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    epic: 0.12,
    legendary: 0.16,
};

// D-PR6: incoming-heal-amplification implant value tables
// No common rarity for Exuberance
const EXUBERANCE_PROC: Record<string, number> = {
    uncommon: 0.17,
    rare: 0.2,
    epic: 0.24,
    legendary: 0.3,
};
const EXUBERANCE_AMP: Record<string, number> = { uncommon: 12, rare: 13, epic: 14, legendary: 15 };

// D-PR3: shared helper for incoming-reduction abilities
function mkReduction(
    pct: number | undefined,
    scope: 'direct' | 'dot',
    condition: IncomingCondition,
    critFamily: boolean
): Omit<Ability, 'id'> | undefined {
    if (pct === undefined) return undefined;
    return {
        type: 'incoming-reduction',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'incoming-reduction', scope, condition, pct, critFamily },
        autoFilled: true,
    };
}

// D-PR4: shared helper for outgoing-amplification abilities
function mkAmplification(
    ampPct: number | undefined,
    condition: OutgoingCondition,
    procChance: number | undefined
): Omit<Ability, 'id'> | undefined {
    if (ampPct === undefined || procChance === undefined) return undefined;
    return {
        type: 'outgoing-amplification',
        target: 'self',
        trigger: 'on-cast', // inert: the live condition lives in config, evaluated per-hit
        conditions: [],
        config: { type: 'outgoing-amplification', condition, ampPct, procChance },
        autoFilled: true,
    };
}

// D-PR5: shared helper for heal-amplification abilities
function mkHealAmp(
    ampPct: number | undefined,
    condition: HealAmpCondition,
    procChance?: number
): Omit<Ability, 'id'> | undefined {
    if (ampPct === undefined) return undefined;
    return {
        type: 'heal-amplification',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal-amplification', condition, ampPct, procChance },
        autoFilled: true,
    };
}

// D-PR7: build a reactive named-buff grant (e.g. Battlecry's on-death "Inc. Damage Down II").
// parsedEffects/stackability resolve from the canonical BUFFS entry. EMIT-ONLY for buffs whose
// effect the engine does not yet fold (self-side incoming-damage buffs) — the status is applied
// and logged but has no combat effect until that fold exists.
// D-PR8: generalised with optional `opts` for conditions + procChance (Battlecry call is byte-identical).
// D-PR16: `alsoGrantBuffNames` (Task 5) lets one ability co-grant extra named buffs ALONGSIDE
// the primary in the SAME application (one proc roll → all of them; Last Stand's Barrier + Block
// Debuff). Each extra resolves its own effects/stackability from BUFFS and inherits `duration`.
// Absent/empty → the `additionalBuffs` field is omitted → the single-buff path is byte-identical.
// Exported for the co-grant registry-shape test.
export function mkNamedBuffGrant(
    buffName: string,
    target: 'self' | 'ally' | 'all-allies' | 'adjacent-allies',
    trigger: AbilityTrigger,
    duration: number | undefined,
    opts?: { conditions?: Condition[]; procChance?: number; alsoGrantBuffNames?: string[] }
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    if (!buff) return undefined;
    const { stackable, maxStacks } = isStackable(buff.description);
    const additionalBuffs = (opts?.alsoGrantBuffNames ?? [])
        .map((n) => {
            const b = BUFFS.find((x) => x.name === n);
            if (!b) return undefined;
            const { stackable: extraStackable, maxStacks: extraMaxStacks } = isStackable(
                b.description
            );
            return {
                buffName: n,
                parsedEffects: parseBuffEffects(b.name, b.description),
                stacks: 1,
                isStackable: extraStackable,
                maxStacks: extraMaxStacks,
                duration,
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
    return {
        type: 'buff',
        target,
        trigger,
        conditions: opts?.conditions ?? [],
        ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
        config: {
            type: 'buff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            duration,
            ...(additionalBuffs.length ? { additionalBuffs } : {}),
        },
        autoFilled: true,
    };
}

// D-PR7: build a reactive named-debuff application (Martyrdom's on-death "Disable" on the killer).
// application:'apply' → lands unless affinity disadvantage (no landing roll), matching "Applies".
// Killer routing is supplied by the on-destroyed listener via eventCtx.counterTargetId.
// D-PR14: generalised with optional `opts` for target / procChance / conditions
// (Martyrdom call is byte-identical — all three opts default away).
function mkNamedDebuff(
    buffName: string,
    trigger: AbilityTrigger,
    duration: number | undefined,
    opts?: { target?: AbilityTarget; procChance?: number; conditions?: Condition[] }
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    if (!buff) return undefined;
    const { stackable, maxStacks } = isStackable(buff.description);
    return {
        type: 'debuff',
        target: opts?.target ?? 'enemy',
        trigger,
        conditions: opts?.conditions ?? [],
        ...(opts?.procChance !== undefined ? { procChance: opts.procChance } : {}),
        config: {
            type: 'debuff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            application: 'apply',
            duration,
        },
        autoFilled: true,
    };
}

const IMPLANT_ABILITIES: Partial<Record<string, ImplantAbilityBuilder>> = {
    BLOODTHIRST: (rarity) => {
        const pct = BLOODTHIRST_HEAL_PCT[rarity];
        const procChance = BLOODTHIRST_PROC_CHANCE[rarity];
        if (pct === undefined) return undefined;
        return {
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            conditions: [],
            procChance,
            config: {
                type: 'heal',
                pct,
                basis: 'damage-dealt',
            },
            autoFilled: true,
        };
    },
    // Intrusion: +N% outgoing direct damage per debuff on the target. Rides the modifier
    // fold as a pure scaling modifier (value 0 + scaling); the enemy-debuff condition is a
    // bare scaling source (no countComparator) so it scales, never gates.
    INTRUSION: (rarity) => {
        const perUnit = INTRUSION_PER_DEBUFF[rarity];
        if (perUnit === undefined) return undefined;
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'enemy-debuff', derivable: true }],
            scaling: { conditionIndex: 0, perUnit },
            config: {
                type: 'modifier',
                channel: 'outgoingDamage',
                value: 0,
                isMultiplicative: false,
            },
            autoFilled: true,
        };
    },
    // Arcane Siege: +X% outgoing direct damage while shielded. Flat value gated on the new
    // self-shield condition; dormant until sub-project H grants shields in the sim.
    ARCANE_SIEGE: (rarity) => {
        const value = ARCANE_SIEGE_PCT[rarity];
        if (value === undefined) return undefined;
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [{ subject: 'self-shield', derivable: true }],
            config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: false },
            autoFilled: true,
        };
    },
    // Warpstrike: +X% outgoing direct damage while self-debuffed (damage half), AND reduces
    // a random active debuff's duration by 1 turn on each damage-dealing turn (duration-reduction
    // half). Both halves are gated on the same self-debuff condition (>=1 debuff required).
    // Returns an array so the consumer stamps distinct ids (-0 / -1) for each half.
    WARPSTRIKE: (rarity) => {
        const value = WARPSTRIKE_PCT[rarity];
        if (value === undefined) return undefined;
        const selfDebuffGate = {
            subject: 'self-debuff' as const,
            derivable: true,
            countComparator: 'gte' as const,
            countThreshold: 1,
        };
        return [
            {
                type: 'modifier' as const,
                target: 'self' as const,
                trigger: 'on-cast' as const,
                conditions: [selfDebuffGate],
                config: {
                    type: 'modifier' as const,
                    channel: 'outgoingDamage' as const,
                    value,
                    isMultiplicative: false,
                },
                autoFilled: true,
            },
            {
                type: 'cleanse' as const,
                target: 'self' as const,
                trigger: 'on-deal-damage' as const,
                conditions: [selfDebuffGate],
                config: {
                    type: 'cleanse' as const,
                    count: 0,
                    mode: 'reduce-duration' as const,
                    durationTurns: 1,
                },
                autoFilled: true,
            },
        ];
    },
    // Reactive Ward: X% chance, when directly damaged, to cleanse 1 debuff (2 if the hit was
    // a critical). No rare variant exists in implants.ts.
    REACTIVE_WARD: (rarity) => {
        const pc = REACTIVE_WARD_PROC[rarity];
        if (pc === undefined) return undefined;
        return {
            type: 'cleanse' as const,
            target: 'self' as const,
            trigger: 'on-attacked' as const,
            conditions: [],
            procChance: pc,
            config: { type: 'cleanse' as const, count: 1, critCount: 2, mode: 'remove' as const },
            autoFilled: true,
        };
    },
    // D-PR4: reactive-damage-on-debuff implants
    // Insidiousness: X% chance to deal Y% damage when debuffing an enemy.
    INSIDIOUSNESS: (rarity) => {
        const m = INSIDIOUSNESS_MULT[rarity];
        const pc = INSIDIOUSNESS_PROC[rarity];
        if (m === undefined || pc === undefined) return undefined;
        return {
            type: 'damage',
            target: 'enemy',
            trigger: 'on-debuff-inflicted',
            conditions: [],
            procChance: pc,
            config: { type: 'damage', multiplier: m, hits: 1 },
            autoFilled: true,
        };
    },
    // D-PR4: outgoing-amplification implants
    // Menace: X% chance to amplify a crit hit's damage by Y%.
    MENACE: (rarity) => mkAmplification(MENACE_AMP[rarity], 'amplify-on-crit', MENACE_PROC[rarity]),
    // Giant Slayer: X% chance to amplify damage vs. a higher-attack enemy by 50%.
    // No common rarity.
    GIANT_SLAYER: (rarity) =>
        mkAmplification(50, 'amplify-vs-higher-attack', GIANT_SLAYER_PROC[rarity]),
    // D-PR3: incoming-reduction implants
    // Voidshade: reduce incoming direct damage by X% while stealthed.
    VOIDSHADE: (rarity) => mkReduction(VOIDSHADE_PCT[rarity], 'direct', 'self-stealth', false),
    // Nebula Nullifier: reduce incoming direct damage by X% while in stasis.
    NEBULA_NULLIFIER: (rarity) => mkReduction(NEBULA_PCT[rarity], 'direct', 'self-stasis', false),
    // Hyperion Gaze: reduce incoming crits from stealthed attackers by X% (crit-reduction family).
    HYPERION_GAZE: (rarity) =>
        mkReduction(HYPERION_PCT[rarity], 'direct', 'incoming-crit-by-stealthed', true),
    // Vortex Veil: reduce incoming Inferno/Corrosion DoT damage by X%.
    VORTEX_VEIL: (rarity) =>
        mkReduction(VORTEX_VEIL_PCT[rarity], 'dot', 'dot-inferno-corrosion', false),
    // D-PR3: incoming-block implants
    // Ironclad: X% chance to block Y% of each hit from the 2nd hit onward this round.
    // No uncommon rarity.
    IRONCLAD: (rarity) => {
        const b = IRONCLAD_BLOCK[rarity];
        if (!b) return undefined;
        return {
            type: 'incoming-block',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-block',
                condition: 'nth-hit-2plus',
                procChance: b.chance,
                blockPct: b.pct,
                oncePerRound: false,
            },
            autoFilled: true,
        };
    },
    // Second Wind: X% chance to repair 10% of max HP upon receiving a critical hit.
    // No common variant.
    SECOND_WIND: (rarity) => {
        const pc = SECOND_WIND_PROC[rarity];
        if (pc === undefined) return undefined;
        return {
            type: 'heal',
            target: 'self',
            trigger: 'on-attacked',
            triggerCritFilter: 'crit',
            conditions: [],
            procChance: pc,
            config: { type: 'heal', pct: 10, basis: 'hp' },
            autoFilled: true,
        };
    },
    // Shadowguard: X% chance to fully block a hit while stealthed (once per round).
    // Only uncommon/epic/legendary rarities.
    SHADOWGUARD: (rarity) => {
        const chance = SHADOWGUARD_CHANCE[rarity];
        if (chance === undefined) return undefined;
        return {
            type: 'incoming-block',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-block',
                condition: 'self-stealth',
                procChance: chance,
                blockPct: 1,
                oncePerRound: true,
            },
            autoFilled: true,
        };
    },
    // D-PR5: heal-amplification implants
    // Nourishment: +X% repair when targeting an ally with lower HP. Deterministic (no procChance).
    // No common rarity.
    NOURISHMENT: (rarity) => mkHealAmp(NOURISHMENT_AMP[rarity], 'target-hp-below-self'),
    // D-PR6: incoming-heal-amplification implants
    // Exuberance: X% chance to increase incoming repair by Y%. No common rarity.
    // Recipient-side fold is wired in a later task; this entry is inert until then.
    EXUBERANCE: (rarity) => {
        const amp = EXUBERANCE_AMP[rarity];
        const pc = EXUBERANCE_PROC[rarity];
        if (amp === undefined) return undefined;
        return {
            type: 'incoming-heal-amplification',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'incoming-heal-amplification', ampPct: amp, procChance: pc },
            autoFilled: true,
        };
    },
    // Vivacious Repair: X% chance to double the repair amount when targeting an ally below 25% HP.
    // No common/uncommon rarity.
    VIVACIOUS_REPAIR: (rarity) =>
        mkHealAmp(
            VIVACIOUS_PROC[rarity] !== undefined ? 100 : undefined,
            'target-below-25',
            VIVACIOUS_PROC[rarity]
        ),
    // D-PR7: on-death implants ----------------------------------------------------
    // Last Wish: "Upon death, repairs X% of all allies' max HP." Rides the reactive
    // heal executor on the on-destroyed trigger (Salvation precedent); basis 'target-hp'
    // repairs each ally % of its OWN max HP. Reactive heals never crit. Fully modeled.
    LAST_WISH: (rarity) => {
        const pct = LAST_WISH_PCT[rarity];
        if (pct === undefined) return undefined;
        return {
            type: 'heal',
            target: 'all-allies',
            trigger: 'on-destroyed',
            conditions: [],
            config: { type: 'heal', pct, basis: 'target-hp', noCrit: true },
            autoFilled: true,
        };
    },
    // Battlecry: "Upon death, grants all allies Inc. Damage Down II for N turns." EMIT-ONLY:
    // self-side "Inc. Damage Down" is not folded into incoming damage yet (victimEnemyBuffs reads
    // enemy-side only). The buff is applied + logged; lights up when self-side incoming folding lands.
    BATTLECRY: (rarity) =>
        mkNamedBuffGrant(
            'Inc. Damage Down II',
            'all-allies',
            'on-destroyed',
            BATTLECRY_DURATION[rarity]
        ),
    // Martyrdom: "Applies Disable for N turns on the enemy that killed this Unit." EMIT-ONLY:
    // Disable is not a modeled turn-effect yet (only Stasis skips turns) — the debuff is applied to
    // the killer + logged. Killer routing comes from the on-destroyed listener.
    MARTYRDOM: (rarity) => mkNamedDebuff('Disable', 'on-destroyed', MARTYRDOM_DURATION[rarity]),
    // D-PR8: Ambush — start-of-round, if Stealthed, X% chance to gain Crit Power Up III for 1 turn.
    // Gate is self-buff/Stealth (NOT self-stealth — that's an IncomingCondition). DORMANT until a
    // stealth source exists in the sim (Cloaking / sub-project H); entry + gate are correct now.
    AMBUSH: (rarity) => {
        const procChance = AMBUSH_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Crit Power Up III', 'self', 'start-of-round', 1, {
            conditions: [{ subject: 'self-buff', buffName: 'Stealth', derivable: true }],
            procChance,
        });
    },
    // D-PR8: Synaptic Resonance — gain Speed Up III for 1 turn when an enemy is directly repaired.
    // DETERMINISTIC (no procChance). LIVE today (enemies have real healing → on-enemy-repaired fires).
    // The "+X% next-crit critDamage" half is DEFERRED (stacking next-crit consumable, no seam).
    SYNAPTIC_RESONANCE: (_rarity) =>
        mkNamedBuffGrant('Speed Up III', 'self', 'on-enemy-repaired', 1),
    // D-PR8: Alacrity — at end of round, if not hit, X% chance to gain Speed Up III for 2 turns.
    ALACRITY: (rarity) => {
        const procChance = ALACRITY_PROC[rarity];
        if (procChance === undefined) return undefined; // no common variant
        return mkNamedBuffGrant('Speed Up III', 'self', 'end-of-round', 2, {
            conditions: [{ subject: 'not-hit-this-round', derivable: true }],
            procChance,
        });
    },
    // D-PR9: Spearhead — after using the charged skill, X% chance to grant all allies
    // Attack Up I for 1 turn. LIVE (Attack Up I folds into attack). Rides on-charged-cast.
    SPEARHEAD: (rarity) => {
        const procChance = SPEARHEAD_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Attack Up I', 'all-allies', 'on-charged-cast', 1, { procChance });
    },
    // D-PR9: Font of Power — on-own-repair-to-ally, grant repaired allies Power Infused
    // Nanobots (target:'ally' + eventCtx.repairedAllyIds routing). D-PR10: the buff grants
    // flat attack = 100% of the caster's attack, snapshotted at grant time.
    FONT_OF_POWER: (rarity) => {
        const procChance = FONT_OF_POWER_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Power Infused Nanobots', 'ally', 'on-own-repair-to-ally', 1, {
            procChance,
        });
    },
    // D-PR11: Fortifying Shroud — at the start of its own turn, X% chance to grant all
    // adjacent allies Defense Up I for 1 turn. The adjacent-allies target resolves to board
    // neighbours in the simulator and to all same-side allies in non-positional modes.
    // No common variant.
    FORTIFYING_SHROUD: (rarity) => {
        const procChance = FORTIFYING_SHROUD_PROC_CHANCE[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Defense Up I', 'adjacent-allies', 'start-of-turn', 1, {
            procChance,
        });
    },
    // D-PR14: Bulwark — X% chance, when an adjacent ally is directly damaged, apply Provoke
    // to that enemy for 1 turn, once per round. requireDamagedAllyAdjacent gates the trigger
    // to the specific case where the attacked ally is adjacent to the owner.
    BULWARK: (rarity) => {
        const procChance = BULWARK_PROC[rarity];
        if (procChance === undefined) return undefined;
        const base = mkNamedDebuff('Provoke', 'on-ally-attacked', 1, { procChance });
        if (!base) return undefined;
        return { ...base, oncePerRound: true, requireDamagedAllyAdjacent: true };
    },
    // D-PR14: Doomsayer — at end of round, if first to activate, X% chance to apply
    // Concentrate Fire to the enemy with highest attack for 1 turn. No common variant.
    DOOMSAYER: (rarity) => {
        const procChance = DOOMSAYER_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedDebuff('Concentrate Fire', 'end-of-round', 1, {
            procChance,
            target: 'enemy-highest-attack',
            conditions: [{ subject: 'first-activator', derivable: true }],
        });
    },
    // D-PR16: Firewall — when debuffed, X% chance to gain Block Debuff (self) for 1 turn.
    FIREWALL: (rarity) => {
        const procChance = FIREWALL_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Block Debuff', 'self', 'on-debuffed', 1, { procChance });
    },
    // D-PR16: Lockdown — when resisting a debuff, X% chance to grant Buff Protection to
    // all allies for 1 turn.
    LOCKDOWN: (rarity) => {
        const procChance = LOCKDOWN_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Buff Protection', 'all-allies', 'on-debuff-resisted', 1, {
            procChance,
        });
    },
    // D-PR16: Tenacity — upon directly receiving damage > 25% of max HP, X% chance to grant
    // Buff Protection to all allies for 2 turns. Models the per-ATTACK aggregate (the
    // `attacked` event excludes DoT/bomb → "directly receiving").
    TENACITY: (rarity) => {
        const procChance = TENACITY_PROC[rarity];
        if (procChance === undefined) return undefined;
        const base = mkNamedBuffGrant('Buff Protection', 'all-allies', 'on-attacked', 2, {
            procChance,
        });
        if (!base) return undefined;
        return { ...base, requireIncomingDamageFracOfMaxHp: 0.25 };
    },
    // D-PR16: Last Stand — when this unit becomes the last one standing, X% chance to gain
    // Barrier AND Block Debuff (self) for 1 turn. Rides on-ally-destroyed gated on last-standing
    // (fires on the ally death that leaves the owner sole survivor); both buffs on ONE proc roll.
    LAST_STAND: (rarity) => {
        const procChance = LAST_STAND_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, {
            procChance,
            conditions: [{ subject: 'last-standing', derivable: true }],
            alsoGrantBuffNames: ['Block Debuff'],
        });
    },
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resolve a ship's active gear-set effects + implant effects into Ability[].
 *
 * @param ship          The ship whose equipment and implants to inspect.
 * @param getGearPiece  Inventory lookup — maps a gear id to a GearPiece (or undefined).
 */
export function buildEquipmentAbilities(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined
): Ability[] {
    const abilities: Ability[] = [];

    // ------------------------------------------------------------------
    // 1. Active gear sets
    // ------------------------------------------------------------------
    // GEAR_SETS is a static constant — no runtime throws expected, so no per-set guard.
    const setCounts: Record<string, number> = {};
    for (const gearId of Object.values(ship.equipment ?? {})) {
        if (!gearId) continue;
        const piece = getGearPiece(gearId);
        if (!piece?.setBonus) continue;
        setCounts[piece.setBonus] = (setCounts[piece.setBonus] ?? 0) + 1;
    }

    for (const [setName, count] of Object.entries(setCounts)) {
        const minPieces = GEAR_SETS[setName]?.minPieces ?? 2;
        if (count < minPieces) continue;

        const builder = GEAR_SET_ABILITIES[setName];
        if (!builder) continue;

        const partial = builder();
        abilities.push({ id: `equip-set-${setName}`, ...partial });
    }

    // ------------------------------------------------------------------
    // 2. Implants
    // ------------------------------------------------------------------
    for (const gearId of Object.values(ship.implants ?? {})) {
        if (!gearId) continue;

        try {
            const piece = getGearPiece(gearId);
            if (!piece?.setBonus) continue;

            const implantName = piece.setBonus;
            const implantData = IMPLANTS[implantName];
            if (!implantData) continue;

            const variant = implantData.variants.find((v) => v.rarity === piece.rarity);
            if (!variant?.description) continue;

            // Try the per-implant builder first (handles cases the text parser can't).
            const builder = IMPLANT_ABILITIES[implantName];
            if (builder) {
                const res = builder(piece.rarity);
                if (!res) continue;
                const partials = Array.isArray(res) ? res : [res];
                partials.forEach((partial, i) => {
                    abilities.push({
                        ...partial,
                        // For single-ability implants, preserve the original id byte-exactly
                        // (suffix the unique gear-piece id so two copies of the same implant
                        // get distinct ability ids — the proc-rate gate keys on
                        // (owner, ability.id), so a shared id would collapse independent
                        // procs into one gate).
                        // For multi-ability implants (e.g. Warpstrike), append an index
                        // suffix so the two halves also get distinct ids.
                        id:
                            partials.length === 1
                                ? `equip-implant-${implantName}-${gearId}`
                                : `equip-implant-${implantName}-${gearId}-${i}`,
                    });
                });
                continue;
            }

            // For implants not in the registry: the description text could not be
            // reliably parsed for D-PR1 (the text parser lacks the "N% chance" proc-gate
            // stamping path for reactive triggers). Skip gracefully — no ability emitted,
            // no throw.
        } catch {
            // Per-piece errors never surface out of this function.
        }
    }

    return abilities;
}
