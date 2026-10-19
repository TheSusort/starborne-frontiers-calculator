import type { Ship } from '../../../types/ship';

/**
 * The ships the arcade offers: the player's fleet, or, for a player with no fleet (signed in or
 * not), every ship template flown bare (no gear, implants, refits or engineering). While the
 * owned fleet is loading, or there is no fleet and the templates are loading, `loading` is set
 * and the arcade waits rather than flashing an empty or template fleet.
 */
export function arcadeFleet(
    owned: Ship[],
    ownedLoading: boolean,
    templates: Ship[],
    templatesLoading: boolean
): { fleet: Ship[]; bare: boolean; loading: boolean } {
    if (owned.length > 0) return { fleet: owned, bare: false, loading: false };
    if (ownedLoading || templatesLoading) return { fleet: owned, bare: false, loading: true };
    return { fleet: templates, bare: true, loading: false };
}
