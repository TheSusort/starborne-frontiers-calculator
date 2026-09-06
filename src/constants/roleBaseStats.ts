import type { BaseStats } from '../types/stats';
import type { ShipTypeName } from './shipTypes';
import { GEAR_SLOTS } from './gearTypes';

/**
 * Role-specific base stats representing typical ship base stats (before gear).
 * Midpoints of known ranges, so percentage gear stats are weighted correctly.
 *
 * This is the PERCENTAGE reference only: a `+7% attack` gear roll scales
 * against the ship's bare base attack here, and that is correct regardless
 * of how geared the ship ends up — raising this table would double-count
 * every percentage roll in the game. For the SCORING baseline (the stat
 * block a piece is added to before `calculateRoleScore` runs), see
 * `getScoringBaselineStats` below — a bare chassis systematically favours
 * crit rate over crit damage for a role whose formula caps crit at 100
 * (#475), which this table alone cannot fix without breaking percentage
 * scaling.
 *
 * Lives here, in a leaf module, so any path can import it. Importing this
 * from anywhere is safe: it depends on nothing but types and `GEAR_SLOTS`,
 * whose own module imports only types.
 */
export const ROLE_BASE_STATS = {
    ATTACKER: {
        hp: 22000,
        attack: 6250,
        defence: 5000,
        hacking: 0,
        security: 0,
        speed: 130,
        crit: 20,
        critDamage: 80,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEFENDER: {
        hp: 25000,
        attack: 3000,
        defence: 5000,
        hacking: 0,
        security: 90,
        speed: 110,
        crit: 10,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    DEBUFFER: {
        hp: 16500,
        attack: 4400,
        defence: 2500,
        hacking: 200,
        security: 33,
        speed: 125,
        crit: 12,
        critDamage: 20,
        healModifier: 0,
        defensePenetration: 0,
    },
    SUPPORTER: {
        hp: 20000,
        attack: 3000,
        defence: 3250,
        hacking: 0,
        security: 0,
        speed: 99,
        crit: 12,
        critDamage: 22,
        healModifier: 0,
        defensePenetration: 0,
    },
} as const satisfies Record<string, BaseStats>;

/** Variant roles (DEBUFFER_BOMBER, SUPPORTER_SHIELD, ...) share their base role's table. */
export function getBaseRoleStats(role: ShipTypeName): BaseStats {
    if (role.startsWith('DEFENDER')) return ROLE_BASE_STATS.DEFENDER;
    if (role.startsWith('DEBUFFER')) return ROLE_BASE_STATS.DEBUFFER;
    if (role.startsWith('SUPPORTER')) return ROLE_BASE_STATS.SUPPORTER;
    return ROLE_BASE_STATS.ATTACKER;
}

/** Number of gear slots (weapon, hull, generator, sensor, software, thrusters)
 *  a ship equips. The piece a scoring pass evaluates is always one of these. */
const GEAR_SLOT_COUNT = Object.keys(GEAR_SLOTS).length;

/** How much of one slot's crit contribution the scoring baseline leaves
 *  unclaimed, so the piece under evaluation has somewhere to land.
 *
 *  Half a slot, not a whole one: a whole slot leaves ~13 points of crit
 *  headroom on an attacker, which is more than a max legendary crit roll, so
 *  NO crit roll ever clips against the 100 cap and crit rate is credited in
 *  full every time. Half a slot leaves ~7, so a large crit roll does clip and
 *  the cap bites — while a ship genuinely short of the cap still sees crit
 *  rate valued at all (owner ruling, 2026-09-07). */
const HEADROOM_SLOTS = 0.5;

/**
 * What a fully-geared, endgame ship of each role runs at for crit and crit
 * power (critDamage), from in-game observation: an attacker sits at crit 100
 * / crit power 200; a supporter or offensive debuffer also caps crit but
 * tops out lower on crit power, 150.
 *
 * Total over every `ShipTypeName`, not just the four base roles, so a newly
 * added variant must be authored here explicitly rather than silently
 * inheriting a value through a prefix match. Only `ATTACKER`, `DEBUFFER` and
 * `SUPPORTER` carry a target distinct from their bare `ROLE_BASE_STATS`
 * entry, because those are the only roles whose `calculateRoleScore` formula
 * reads crit at all — read the switch in `priorityScore.ts` for which do. A
 * geared target on any other variant would be inert, so they keep the bare
 * value; that their formulas ignore crit is a separate gap (#481), not
 * something this table can fix.
 */
export const GEARED_CRIT_TARGETS: Record<ShipTypeName, { crit: number; critDamage: number }> = {
    ATTACKER: { crit: 100, critDamage: 200 },
    DEFENDER: {
        crit: ROLE_BASE_STATS.DEFENDER.crit,
        critDamage: ROLE_BASE_STATS.DEFENDER.critDamage,
    },
    DEFENDER_SECURITY: {
        crit: ROLE_BASE_STATS.DEFENDER.crit,
        critDamage: ROLE_BASE_STATS.DEFENDER.critDamage,
    },
    DEBUFFER: { crit: 100, critDamage: 150 },
    DEBUFFER_DEFENSIVE: {
        crit: ROLE_BASE_STATS.DEBUFFER.crit,
        critDamage: ROLE_BASE_STATS.DEBUFFER.critDamage,
    },
    DEBUFFER_DEFENSIVE_SECURITY: {
        crit: ROLE_BASE_STATS.DEBUFFER.crit,
        critDamage: ROLE_BASE_STATS.DEBUFFER.critDamage,
    },
    DEBUFFER_BOMBER: {
        crit: ROLE_BASE_STATS.DEBUFFER.crit,
        critDamage: ROLE_BASE_STATS.DEBUFFER.critDamage,
    },
    DEBUFFER_CORROSION: {
        crit: ROLE_BASE_STATS.DEBUFFER.crit,
        critDamage: ROLE_BASE_STATS.DEBUFFER.critDamage,
    },
    SUPPORTER: { crit: 100, critDamage: 150 },
    SUPPORTER_BUFFER: {
        crit: ROLE_BASE_STATS.SUPPORTER.crit,
        critDamage: ROLE_BASE_STATS.SUPPORTER.critDamage,
    },
    SUPPORTER_OFFENSIVE: {
        crit: ROLE_BASE_STATS.SUPPORTER.crit,
        critDamage: ROLE_BASE_STATS.SUPPORTER.critDamage,
    },
    SUPPORTER_SHIELD: {
        crit: ROLE_BASE_STATS.SUPPORTER.crit,
        critDamage: ROLE_BASE_STATS.SUPPORTER.critDamage,
    },
};

/** Same base-role mapping `getBaseRoleStats` uses, for a `role` string outside
 *  the authored `ShipTypeName` union — persisted `ship.type` data can hold
 *  one. A total `Record` gates AUTHORING, never INPUT: indexing
 *  `GEARED_CRIT_TARGETS` with such a string reads `undefined`, so callers
 *  fall back through this instead. */
function fallbackGearedTarget(role: string): { crit: number; critDamage: number } {
    if (role.startsWith('DEFENDER')) return GEARED_CRIT_TARGETS.DEFENDER;
    if (role.startsWith('DEBUFFER')) return GEARED_CRIT_TARGETS.DEBUFFER;
    if (role.startsWith('SUPPORTER')) return GEARED_CRIT_TARGETS.SUPPORTER;
    return GEARED_CRIT_TARGETS.ATTACKER;
}

/**
 * The scoring-baseline stat block for `role`: the stats a piece being
 * evaluated for a role is added ON TOP OF before `calculateRoleScore` runs.
 * Distinct from `getBaseRoleStats`, which stays the bare, ungeared chassis
 * used only to scale a percentage gear roll — see this module's top-level
 * doc for why raising that one would double-count every percentage roll.
 *
 * crit and critDamage are replaced with the geared target
 * (`GEARED_CRIT_TARGETS`), less `HEADROOM_SLOTS` of one slot's share:
 *
 *     reference = base + (gearedTarget - base) * (1 - HEADROOM_SLOTS / GEAR_SLOT_COUNT)
 *
 * The piece being scored is always one of the ship's `GEAR_SLOT_COUNT`
 * slots, so crediting the FULL geared target here would double-count that
 * piece's own crit contribution: every crit roll would land at exactly zero
 * marginal (the cap is already met without it) and the model would refuse
 * crit rate outright, which is equally wrong — a player has to reach 100
 * crit somehow. Leaving part of a slot unclaimed (crit ~93.3, crit power
 * ~190 for ATTACKER) keeps crit rate worth something below the cap while
 * letting a large crit roll clip against it (#475).
 *
 * Note what this reference can and cannot do. Below the cap, one point of
 * crit rate is worth `critDamage / 100` and one point of crit power is worth
 * `crit / 100`, so crit rate always out-values crit power while headroom
 * remains — the cap is the ONLY thing that reverses it. How much headroom to
 * assume is therefore a judgement about the typical ship, not a derivation,
 * and no single figure is right for both a capped ship and one still
 * climbing. #482 covers why a dummy baseline cannot settle that.
 *
 * `role` falls back through the same base-role mapping `getBaseRoleStats`
 * uses (via `fallbackGearedTarget`) for a `ShipTypeName` value outside the
 * authored union.
 */
export function getScoringBaselineStats(role: ShipTypeName): BaseStats {
    const base = getBaseRoleStats(role);
    // An own-property check, not `?? fallback`: an inherited key such as
    // '__proto__' or 'constructor' resolves to a non-nullish prototype value,
    // which `??` would accept and whose `crit` is undefined — putting NaN
    // into every score derived from this baseline.
    const target = Object.prototype.hasOwnProperty.call(GEARED_CRIT_TARGETS, role)
        ? GEARED_CRIT_TARGETS[role]
        : fallbackGearedTarget(role);
    const share = 1 - HEADROOM_SLOTS / GEAR_SLOT_COUNT;
    return {
        ...base,
        crit: base.crit + (target.crit - base.crit) * share,
        critDamage: base.critDamage + (target.critDamage - base.critDamage) * share,
    };
}
