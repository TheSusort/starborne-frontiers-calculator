import { Ship } from '../../types/ship';
import { parseShipTargeting, TargetSelection, PatternShape } from '../targetingParser';
import { TARGETING_RULES, PATTERN_SHAPES } from '../../constants/targetingRules';

export interface ShipTargetingFacets {
    selections: TargetSelection[];
    shapes: PatternShape[];
}

/**
 * Deduped union of targeting selections + pattern shapes across a ship's
 * active and charged skills. Passive skills carry no targeting and are ignored.
 */
export function getShipTargetingFacets(ship: Ship): ShipTargetingFacets {
    const targeting = parseShipTargeting(ship);
    const selections = new Set<TargetSelection>();
    const shapes = new Set<PatternShape>();
    for (const slot of [targeting.active, targeting.charged]) {
        if (!slot) continue;
        selections.add(slot.target.selection);
        shapes.add(slot.pattern.shape);
    }
    return { selections: [...selections], shapes: [...shapes] };
}

/**
 * OR within an axis, AND across axes (matches the existing faction/type filter
 * semantics). An empty array for an axis means "no constraint on that axis".
 *
 * `selections`/`shapes` are typed as string[] (not the enums) because they come
 * from persisted localStorage filter state — untrusted strings checked by membership.
 */
export function matchesTargetingFilters(
    ship: Ship,
    filters: { selections?: string[]; shapes?: string[] }
): boolean {
    const selections = filters.selections ?? [];
    const shapes = filters.shapes ?? [];
    if (selections.length === 0 && shapes.length === 0) return true;

    const facets = getShipTargetingFacets(ship);
    const matchesSelection =
        selections.length === 0 || facets.selections.some((s) => selections.includes(s));
    const matchesShape = shapes.length === 0 || facets.shapes.some((s) => shapes.includes(s));
    return matchesSelection && matchesShape;
}

/**
 * Lowercased haystack of selection labels + shape labels + raw game tokens,
 * appended to each page's free-text search so typing "cone" / "backline" /
 * "front" surfaces matching ships.
 */
export function buildTargetingSearchText(ship: Ship): string {
    const facets = getShipTargetingFacets(ship);
    const parts: string[] = [];
    for (const sel of facets.selections) parts.push(TARGETING_RULES[sel].label);
    for (const shape of facets.shapes) parts.push(PATTERN_SHAPES[shape].label);
    for (const raw of [
        ship.activeTarget,
        ship.activePattern,
        ship.chargedTarget,
        ship.chargedPattern,
    ]) {
        if (raw) parts.push(raw);
    }
    return parts.join(' ').toLowerCase();
}
