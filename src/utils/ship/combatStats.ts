import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { EngineeringStat } from '../../types/stats';
import { ShipTypeName } from '../../constants/shipTypes';
import { calculateTotalStats, StatBreakdown } from './statsCalculator';

/**
 * Context-derived dependencies needed to resolve a ship's full stats.
 * Passed in (rather than read from hooks) so this module stays pure and testable.
 */
export interface CombatStatsDeps {
    getGearPiece: (id: string) => GearPiece | undefined;
    getEngineeringStatsForShipType: (type: ShipTypeName) => EngineeringStat | undefined;
}

/**
 * Resolve a ship's final stats by applying gear, refits, implants, and engineering.
 * Shared by the DPS calculator and combat simulator so the resolution can never diverge.
 */
export const shipFinalStats = (ship: Ship, deps: CombatStatsDeps): StatBreakdown['final'] => {
    const engineeringStats = ship.type ? deps.getEngineeringStatsForShipType(ship.type) : undefined;
    return calculateTotalStats(
        ship.baseStats,
        ship.equipment || {},
        deps.getGearPiece,
        ship.refits,
        ship.implants,
        engineeringStats,
        ship.id
    ).final;
};

/**
 * Extract the combat-relevant stat subset from a resolved final-stats object.
 * Single source of truth for the magic defaults (hacking ?? 200, speed ?? 100, etc.)
 * and rounding so callers can never silently diverge.
 */
export const combatStatsFromShip = (final: StatBreakdown['final']) => ({
    attack: Math.round(final.attack),
    crit: Math.round(final.crit),
    critDamage: Math.round(final.critDamage),
    defensePenetration: Math.round(final.defensePenetration || 0),
    hacking: Math.round(final.hacking ?? 200),
    defence: Math.round(final.defence ?? 0),
    hp: Math.round(final.hp ?? 0),
    healModifier: Math.round(final.healModifier ?? 0),
    speed: Math.round(final.speed ?? 100),
});
