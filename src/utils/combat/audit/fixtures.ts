import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BattlePlacement } from '../../calculators/battleSimulator';

/** A BattlePlacement pinned to the ship's un-modified level-60 base stats.
 *  No gear/refit/engineering — we audit interactions, not stat math. */
export function canonicalPlacement(ship: Ship, position: Position): BattlePlacement {
    const b = ship.baseStats;
    return {
        ship,
        position,
        statOverrides: {
            attack: b.attack,
            crit: b.crit,
            critDamage: b.critDamage,
            hacking: b.hacking,
            security: b.security,
            defence: b.defence,
            hp: b.hp,
            speed: b.speed,
        },
    };
}
