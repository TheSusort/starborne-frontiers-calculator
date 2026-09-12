import type { Position } from '../../types/encounters';
import type { BoardState } from '../../components/simulator/PlacementBoard';
import type { BattlePlacement } from '../calculators/battleSimulator';
import { combatStatsFromShip, shipFinalStats, type CombatStatsDeps } from '../ship/combatStats';
import { applyStatOverrides } from './statOverrides';

/** Board order for the engine. Player index 0 becomes FOCUS_ID, so this must be a property of the
 *  board and not of the order cells were clicked. */
const POSITION_ORDER: readonly Position[] = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
];

/**
 * Build one side's engine input.
 *
 * `statOverrides` carries the FULL gear/refit/implant/engineering-resolved block — omitting it
 * would floor combat to un-geared base stats and make the result meaningless (see the warning on
 * `BattlePlacement`). A placement's user overrides are spread on last, so they win field-by-field
 * and sit after every stat source.
 */
export function buildTeam(board: BoardState, deps: CombatStatsDeps): BattlePlacement[] {
    return POSITION_ORDER.flatMap((position) => {
        const placement = board[position];
        if (!placement) return [];
        return [
            {
                ship: placement.ship,
                position,
                statOverrides: applyStatOverrides(
                    combatStatsFromShip(shipFinalStats(placement.ship, deps)),
                    placement.overrides
                ),
            },
        ];
    });
}
