import {
    matchesRoleCategory,
    type ShipRoleCategory,
    type ShipTypeName,
} from '../../../constants/shipTypes';

/** One representative per structurally different objective: damage, survival, control, repair.
 *  Comparing variants within a family is near-pointless — they share the leading term of their
 *  scoring formula, so they land in the same optimizer basin. */
const FAMILY_REPRESENTATIVES: ShipRoleCategory[] = [
    'ATTACKER',
    'DEFENDER',
    'DEBUFFER',
    'SUPPORTER',
];

/**
 * The roles a ship's builds are compared against by default.
 *
 * Chosen for the user, not asked of them: a player who already knew which other role to try
 * would not need this tool. Excludes the family `ownRole` belongs to (via `matchesRoleCategory`,
 * so a variant like DEBUFFER_BOMBER excludes DEBUFFER too) — a candidate geared under a formula
 * sharing the ship's own leading term explores the same basin the ship is already in. An
 * undefined role never matches a category, so every family is offered.
 */
export function defaultComparedRoles(ownRole: ShipTypeName | undefined): ShipTypeName[] {
    return FAMILY_REPRESENTATIVES.filter((role) => !matchesRoleCategory(ownRole, [role]));
}
