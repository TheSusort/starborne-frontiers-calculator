import type { BaseStats } from '../types/stats';
import type { ShipTypeName } from './shipTypes';

/**
 * Role-specific base stats representing typical ship base stats (before gear).
 * Midpoints of known ranges, so percentage gear stats are weighted correctly.
 *
 * Lives here, in a leaf module, so the slow potential path, the fast potential
 * path and role/slot coverage all read one table. Importing this from anywhere
 * is safe: it depends on nothing but types.
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
