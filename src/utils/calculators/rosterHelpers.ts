import type { Ship } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import type { Position } from '../../types/encounters';
import type { GearPiece } from '../../types/gear';
import type { EngineeringStats } from '../../types/stats';
import type { StatBreakdown } from '../ship/statsCalculator';
import { detectFullyCharged } from '../skillTextParser';
import { calculateTotalStats } from '../ship/statsCalculator';
import { HEALING_SLOT_OPTIONS, defaultEnemySlot } from './healingPlacement';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from './healingDefaultEnemy';

/** The stat block a manually-added enemy starts from, placed at the Nth default enemy cell.
 *
 *  The stats themselves live in `healingDefaultEnemy.ts` because the adapter needs the same numbers
 *  for the PRACTICE TARGET it synthesizes when the roster is empty — see that module for why none of
 *  them may be 0. `attack` and `hacking` stay here: they are the two the practice target does not
 *  share (it has no attack, and an absent hacking already defaults to the engine's 200). */
export const defaultEnemyStats = (index: number) => ({
    attack: 4000,
    crit: 0,
    critDamage: 0,
    speed: DEFAULT_ENEMY_SPEED,
    hacking: 200,
    chargeCount: 0,
    startCharged: false,
    position: defaultEnemySlot(index),
    hp: DEFAULT_ENEMY_HP,
    defence: DEFAULT_ENEMY_DEFENCE,
    security: DEFAULT_ENEMY_SECURITY,
});

/** `wanted` if free, else the first unoccupied cell — two actors on one cell means the sim MOVES
 *  one of them, so a freshly-added ship should not start in a collision. */
export const firstFreeSlot = (
    wanted: Position,
    taken: ReadonlyArray<Position | undefined>
): Position => {
    const used = new Set(taken.filter((p): p is Position => !!p));
    if (!used.has(wanted)) return wanted;
    return HEALING_SLOT_OPTIONS.find((p) => !used.has(p)) ?? wanted;
};

export const detectShipCharged = (ship: Ship): boolean =>
    detectFullyCharged([
        ship.activeSkillText,
        ship.chargeSkillText,
        ship.firstPassiveSkillText,
        ship.secondPassiveSkillText,
        ship.thirdPassiveSkillText,
    ]);

/** Resolved final stats for a ship, engineering + gear + refits + implants included.
 *
 *  Was a component-scoped closure on the healing page and an inlined `calculateTotalStats` body on
 *  the defense page (twice). The two context getters are parameters rather than hook calls so this
 *  stays a pure function callable from `useMemo` and from tests. */
export const shipFinalStats = (
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined,
    getEngineeringStatsForShipType: (
        shipType: ShipTypeName
    ) => EngineeringStats['stats'][0] | undefined
): StatBreakdown['final'] => {
    const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
    return calculateTotalStats(
        ship.baseStats,
        ship.equipment || {},
        getGearPiece,
        ship.refits,
        ship.implants,
        engineeringStats,
        ship.id
    ).final;
};
