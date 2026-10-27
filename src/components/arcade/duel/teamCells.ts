import type { Position } from '../../../types/encounters';
import { nextRandom } from '../../../utils/arcade/rng';
import { SMALL_GRID_POSITIONS } from '../../../utils/targeting/board';

/** The cells a 3v3 side can stand on, the same on both sides: the small grid. */
export const TEAM_FIELD = SMALL_GRID_POSITIONS;

export type TeamTrio = readonly [Position, Position, Position];

/** Mixed into the challenge seed so the layout draw is its own stream, independent of the
 *  combat RNG that the same seed drives. */
const LAYOUT_SALT = 0x51ab7e3d;

/** Three distinct cells of `TEAM_FIELD`, a partial Fisher-Yates shuffle. */
function drawTrio(state: { rngState: number }): TeamTrio {
    const cells = [...TEAM_FIELD];
    for (let i = 0; i < 3; i++) {
        const j = i + Math.floor(nextRandom(state) * (cells.length - i));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return [cells[0], cells[1], cells[2]];
}

/**
 * Where each side's three ships stand in a 3v3 with challenge seed `seed`: the same seed always
 * gives the same layout. `player[i]` is the cell of the i-th player ship (the flown ship, then
 * its allies); `enemy[i]` the cell of the i-th ship of the gate's trio.
 */
export function teamCells(seed: number): { player: TeamTrio; enemy: TeamTrio } {
    const state = { rngState: (seed ^ LAYOUT_SALT) >>> 0 };
    const player = drawTrio(state);
    const enemy = drawTrio(state);
    return { player, enemy };
}
