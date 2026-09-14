import type { Ship } from '../../types/ship';
import { parseReferenceShipId, referenceShip, type AscensionStat } from './referenceShip';

export interface ShipIdResolverDeps {
    getShipById: (id: string) => Ship | undefined;
    units: Ship[];
    getAscensionStats: (templateId: string) => AscensionStat[] | null;
}

/**
 * Turn a stored ship id back into a Ship.
 *
 * A reference id (`template:<templateId>:<variant>`) names a unit nobody owns, so it is rebuilt
 * from the unit catalogue; looking one up among owned ships finds nothing and silently drops the
 * cell. Anything else is an owned ship's id.
 *
 * `null` means the id no longer resolves — a deleted ship, a re-imported roster, or a different
 * profile. Callers report that; it is not an error.
 */
export function resolveShipId(shipId: string, deps: ShipIdResolverDeps): Ship | null {
    const reference = parseReferenceShipId(shipId);
    if (!reference) return deps.getShipById(shipId) ?? null;
    const template = deps.units.find((unit) => unit.id === reference.templateId);
    if (!template) return null;
    return referenceShip(template, reference.variant, deps.getAscensionStats(template.id));
}
