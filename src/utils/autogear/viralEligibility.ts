import { Ship } from '../../types/ship';
import { buildShipAbilities } from '../abilities/buildShipAbilities';
import { skillsApplyExtendableDoT } from '../combat/dotDurationExtension';

const eligibilityCache = new WeakMap<Ship, boolean>();

/**
 * Whether a complete Viral set lengthens any DoT this ship applies — the engine's own rule
 * (`skillsApplyExtendableDoT`). A ship whose DoTs come only from passives or gear gains nothing
 * from Viral, so autogear scores it without the bonus. Memoised per ship object: the scorer
 * runs once per gear combination and building the kit is not cheap.
 */
export function viralExtendsShipDoTs(ship: Ship): boolean {
    const cached = eligibilityCache.get(ship);
    if (cached !== undefined) return cached;
    const eligible = skillsApplyExtendableDoT(buildShipAbilities(ship));
    eligibilityCache.set(ship, eligible);
    return eligible;
}
