/**
 * buildEquipmentAbilities
 *
 * Turns a ship's equipped gear sets + implants into a list of Ability objects
 * that the combat engine can consume.
 *
 * Gear-set abilities are resolved via GEAR_SET_ABILITIES (see the registry below
 * for the current set). Implant abilities are resolved via IMPLANT_ABILITIES (see
 * the registry below for the current set).
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

const GEAR_SET_ABILITIES: Partial<
    Record<string, (count: number) => Omit<Ability, 'id'> | undefined>
> = {
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
    // Cloaking: at the start of combat (round 1, before any ship acts), gain Stealth
    // for 2 turns, once per battle. Rides start-of-round (drained before the first turn
    // — engine round-started drain point (a)) + oncePerCombat. First in-engine source
    // of the 'Stealth' buff: lights up the positional targeting filter, the D-PR3
    // self-stealth / incoming-crit-by-stealthed conditions, and the D-PR8 Ambush gate.
    CLOAKING: () =>
        mkNamedBuffGrant('Stealth', 'self', 'start-of-round', 2, { oncePerCombat: true }),
    // Decimation (2pc set): +10% DoT damage per complete set, max 3 sets (6 pieces) = +30%.
    // Standing passive → modeled as a dotDamage modifier that folds into dotMult via
    // effectiveDamageStatsOf.selfDotDamageModifier (engine + DPS calc both honor it).
    DECIMATION: (count) => {
        const minPieces = GEAR_SETS.DECIMATION?.minPieces ?? 2;
        const sets = Math.floor(count / minPieces); // 1/2/3 at 2/4/6 pieces
        return {
            type: 'modifier',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'modifier',
                channel: 'dotDamage',
                value: sets * 10,
                isMultiplicative: false,
            },
            autoFilled: true,
        };
    },
    // Burner (4pc set): applies Inferno 1 (tier 15) for 2 turns when the ship attacks.
    // `on-cast` is NOT a LIVE_TRIGGER — passive-slot on-cast DoTs are never applied by the
    // engine (the cast path only gathers DoTs from the FIRED skill, and the reactive executor
    // only runs for LIVE_TRIGGERS). So Burner rides `on-deal-damage` (a LIVE_TRIGGER that fires
    // once per turn the owner deals direct damage), draining through the reactive DoT executor
    // (triggers.ts) which pushes the inferno entry to the attack target (ctx.enemy.id) with
    // sourceId = owner. Re-applies each attacking turn (refreshes the 2-turn duration).
    BURNER: () => ({
        type: 'dot',
        target: 'enemy',
        trigger: 'on-deal-damage',
        conditions: [],
        config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
        autoFilled: true,
    }),
    // Reflect (2pc set): reflect 10% of each direct hit back to the attacker (thorns).
    // Victim-side passive — collected into incomingAbilitiesById by config.type; apply seam
    // wired in Task 5. Top-level type:'modifier' is a placeholder (the engine keys on
    // config.type:'damage-reflection', not the top-level type).
    REFLECT: () => ({
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage-reflection', pct: 10 },
        autoFilled: true,
    }),
    // Revenge (2pc set): "Increase damage by +25% * lost HP%". Missing-HP-scaled outgoing damage
    // modifier: value 0 + scaling (perUnit 0.25 of missing HP %, cap +25pp). At full HP evaluates
    // to 0 → inert in DPS mode (which always runs at full HP). At 0 HP → capped +25pp.
    REVENGE: () => ({
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [{ subject: 'self-hp-missing-pct', derivable: true }],
        scaling: { conditionIndex: 0, perUnit: 0.25, cap: 25 },
        config: { type: 'modifier', channel: 'outgoingDamage', value: 0, isMultiplicative: false },
        autoFilled: true,
    }),
    // Shield gear set: "Generate 4% shield each turn" → start-of-turn self shield of 4% caster max HP.
    // start-of-turn is a LIVE trigger → partitions to the reactive path; lands via the per-recipient
    // routing fix (H2/H3 Task 0.1). basis 'hp' = caster max HP.
    SHIELD: () => ({
        type: 'shield',
        target: 'self',
        trigger: 'start-of-turn',
        conditions: [],
        config: { type: 'shield', pct: 4, basis: 'hp' },
        autoFilled: true,
    }),
    // Boost (4pc set): every buff the wearer APPLIES lasts +1 turn (caster-side). Modeled NOT
    // as a damage/heal fold but as a marker the engine collects into a per-owner extension map,
    // applied at the status-engine buff-duration write seams. Top-level type:'modifier' is a
    // placeholder (engine keys on config.type:'buff-duration-extension', like REFLECT). The
    // modifier fold ignores it (applyAbilities.ts skips config.type !== 'modifier').
    BOOST: () => ({
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'buff-duration-extension', turns: 1 },
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

// H3.2: Adaptive Plating — when directly damaged, X% chance to gain a Shield equal to Y% of
// the damage taken, once per round. No common/rare variants. The `damage-taken` basis scales
// off the triggering hit (eventCtx.triggerDamage, threaded by the on-attacked listener in H3.1).
const ADAPTIVE_PLATING_PROC: Record<string, number> = {
    uncommon: 0.12,
    epic: 0.16,
    legendary: 0.19,
};
const ADAPTIVE_PLATING_PCT: Record<string, number> = { uncommon: 21, epic: 34, legendary: 42 };

// H3.4: Abundant Renewal — when over-repairing an ally, grant that ally a Shield equal to X% of
// the OVER-repaired amount. DETERMINISTIC (no procChance) and no per-round cap. Only epic/legendary
// variants exist. basis 'overheal' scales off the clipped over-repair (eventCtx.overhealAmount,
// threaded by the on-own-repair-to-ally listener in H3.3).
const ABUNDANT_RENEWAL_PCT: Record<string, number> = { epic: 20, legendary: 30 };

// Lifeline: once-per-battle, when a direct hit would drop HP below 30%, gain a shield equal to
// FLAT + 100% of this unit's attack (capped at max HP). Per-rarity = the flat component only.
const LIFELINE_FLAT: Record<string, number> = {
    common: 4000,
    uncommon: 6000,
    rare: 8000,
    epic: 10000,
    legendary: 12000,
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
// Smokescreen: when directly damaged, X% chance to gain Stealth for 1 turn.
// Only rare/epic/legendary variants exist.
const SMOKESCREEN_PROC: Record<string, number> = {
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
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

// H3.8: Resonating Fury — when applying a shield, X% chance to grant Crit Power Up III for 1 turn
// to the shield recipients. The in-game text reads "Crit Power Up 3"; "3" is the canonical
// "III" tier (the Ambush implant carries the same in-game buff and resolves it as the BUFFS
// entry 'Crit Power Up III'). ONE proc roll per cast, NO oncePerRound cap.
const RESONATING_FURY_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};

// Tasks 1.5 + 3.3: Voidfire Catalyst — detonation + splash pct per rarity.
// rare/legendary have no detonation half → undefined for detonation. Both halves are now emitted.
const VOIDFIRE_DETONATION_PCT: Record<string, number | undefined> = {
    common: 2,
    uncommon: 4,
    rare: undefined,
    epic: 8,
    legendary: undefined,
};
const VOIDFIRE_SPLASH_PCT: Record<string, number> = {
    common: 4,
    uncommon: 8,
    rare: 24,
    epic: 16,
    legendary: 40,
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
    opts?: {
        conditions?: Condition[];
        procChance?: number;
        alsoGrantBuffNames?: string[];
        oncePerCombat?: boolean;
    }
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
            ...(opts?.oncePerCombat ? { oncePerCombat: true } : {}),
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
                    count: 0, // inert in reduce-duration mode (required by the cleanse config type)
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
    // H3.4: Abundant Renewal — when over-repairing an ally, grant the over-repaired ally a Shield
    // equal to X% of the OVER-repaired amount. DETERMINISTIC (no procChance) and no per-round cap.
    // Rides `on-own-repair-to-ally` (Font of Power precedent); target 'ally' → the reactive
    // recipients resolve to the over-repaired ally (falls back to healing.targetId — the engine
    // only repairs the heal target). basis 'overheal' scales off eventCtx.overhealAmount (H3.3).
    // No common/uncommon/rare variants.
    ABUNDANT_RENEWAL: (rarity) => {
        const pct = ABUNDANT_RENEWAL_PCT[rarity];
        if (pct === undefined) return undefined;
        return {
            type: 'shield',
            target: 'ally',
            trigger: 'on-own-repair-to-ally',
            conditions: [],
            config: { type: 'shield', pct, basis: 'overheal' },
            autoFilled: true,
        };
    },
    // H3.2: Adaptive Plating — when directly damaged, X% chance to gain a Shield equal to Y% of
    // the damage taken, limited to once per round. `on-attacked` is the "directly damaged" trigger
    // (DoTs route through dot-applied, never on-attacked). basis 'damage-taken' scales off the
    // triggering hit's damage (eventCtx.triggerDamage, H3.1). oncePerRound caps the grant to ONE per
    // round — the `attacked` event's damage is the per-attack aggregate and on-attacked fires once
    // per hit, so without the gate an N-hit attack would grant N times. No common/rare variants.
    ADAPTIVE_PLATING: (rarity) => {
        const procChance = ADAPTIVE_PLATING_PROC[rarity];
        const pct = ADAPTIVE_PLATING_PCT[rarity];
        if (procChance === undefined || pct === undefined) return undefined;
        return {
            type: 'shield',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [],
            procChance,
            oncePerRound: true,
            config: { type: 'shield', pct, basis: 'damage-taken' },
            autoFilled: true,
        };
    },
    // Lifeline: PRE-hit threshold shield (incoming-shield-grant). Consumed victim-side in
    // applyVictimDamage, NOT via the reactive executor — the trigger/target wrapper is nominal
    // (mirrors SHADOWGUARD's incoming-block). All five rarities present.
    LIFELINE: (rarity) => {
        const flatAmount = LIFELINE_FLAT[rarity];
        if (flatAmount === undefined) return undefined;
        return {
            type: 'incoming-shield-grant',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-shield-grant',
                hpThresholdPct: 30,
                flatAmount,
                attackPct: 100,
                oncePerCombat: true,
            },
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
    // Martyrdom: "Applies Disable for N turns on the enemy that killed this Unit."
    // Disable skips the affected ship's turn (same as Stasis on that axis) — the debuff is applied
    // to the killer + logged. Killer routing comes from the on-destroyed listener.
    MARTYRDOM: (rarity) => mkNamedDebuff('Disable', 'on-destroyed', MARTYRDOM_DURATION[rarity]),
    // D-PR8: Smokescreen — when directly damaged, X% chance to gain Stealth for 1 turn.
    // Rides `on-attacked` (direct hits only — DoTs route through dot-applied, never on-attacked).
    // Plain %-proc, no oncePerRound cap. Only rare/epic/legendary variants exist.
    SMOKESCREEN: (rarity) => {
        const procChance = SMOKESCREEN_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Stealth', 'self', 'on-attacked', 1, { procChance });
    },
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
    // H3.8: Resonating Fury — when applying a shield, X% chance to grant Crit Power Up III for 1
    // turn to the SHIELD RECIPIENTS of the cast (the buff follows the shield, not the carrier).
    // Rides `on-shield-applied`; target 'all-allies' routes through the H3.7 listener to EXACTLY
    // eventCtx.shieldRecipientIds (not every ally). ONE proc roll per cast, no oncePerRound cap.
    RESONATING_FURY: (rarity) => {
        const procChance = RESONATING_FURY_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Crit Power Up III', 'all-allies', 'on-shield-applied', 1, {
            procChance,
        });
    },
    // Voidfire Catalyst: emits both detonationDamage and bombSplashDamage modifier abilities.
    // rare/legendary have no detonation half → only bombSplashDamage is emitted for those rarities.
    VOIDFIRE_CATALYST: (rarity) => {
        const det = VOIDFIRE_DETONATION_PCT[rarity];
        const splash = VOIDFIRE_SPLASH_PCT[rarity];
        if (det === undefined && splash === undefined) return undefined;
        const abilities: Omit<Ability, 'id'>[] = [];
        if (det !== undefined) {
            abilities.push({
                type: 'modifier' as const,
                target: 'self' as const,
                trigger: 'on-cast' as const,
                conditions: [],
                config: {
                    type: 'modifier' as const,
                    channel: 'detonationDamage' as const,
                    value: det,
                    isMultiplicative: false,
                },
                autoFilled: true,
            });
        }
        if (splash !== undefined) {
            abilities.push({
                type: 'modifier' as const,
                target: 'self' as const,
                trigger: 'on-cast' as const,
                conditions: [],
                config: {
                    type: 'modifier' as const,
                    channel: 'bombSplashDamage' as const,
                    value: splash,
                    isMultiplicative: false,
                },
                autoFilled: true,
            });
        }
        return abilities;
    },
    // Chrono Reaver: periodic self-charge. Epic = every 3rd own turn, Legendary = every 2nd.
    // Rides end-of-turn (turn-ended) + the every-n-turns gate on the live turnsTaken counter
    // (offset 0 → procs when turnsTaken % period === 0, i.e. the actor's Nth own turn). The
    // proc is dropped for a turn-blocked owner by the §4.4 reactive-suppression filter
    // (engine.ts ~3403), so a stasised/disabled unit banks no periodic charge.
    // Only epic/legendary variants exist (implants.ts) — other rarities emit nothing.
    CHRONO_REAVER: (rarity) => {
        const period = rarity === 'legendary' ? 2 : rarity === 'epic' ? 3 : undefined;
        if (period === undefined) return undefined;
        return {
            type: 'charge',
            target: 'self',
            trigger: 'end-of-turn',
            conditions: [{ subject: 'every-n-turns', derivable: true, period, offset: 0 }],
            config: { type: 'charge', amount: 1 },
            autoFilled: true,
        };
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

        const partial = builder(count);
        if (!partial) continue;
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
