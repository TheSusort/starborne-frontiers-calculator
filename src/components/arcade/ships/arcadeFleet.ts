import type { Ship } from '../../../types/ship';

/**
 * The ships the arcade offers: the player's fleet, or, for a player with no fleet (signed in or
 * not), every ship template flown bare (no gear, implants, refits or engineering). While the
 * owned fleet is still loading the arcade waits on it rather than flashing the templates.
 */
export function arcadeFleet(
    owned: Ship[],
    ownedLoading: boolean,
    templates: Ship[]
): { fleet: Ship[]; bare: boolean } {
    if (owned.length > 0 || ownedLoading) return { fleet: owned, bare: false };
    return { fleet: templates, bare: true };
}
