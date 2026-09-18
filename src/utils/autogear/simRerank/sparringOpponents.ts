import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import { practiceBoards } from './practiceBoard';

export interface SparringOpponent {
    /** Shown in the results table header, e.g. "Security 500". */
    label: string;
    enemyBoard: BoardState;
}

/** Low / medium / high for each gate. The security spread is measured (#498): sweeping
 *  Xcellence's hacking against enemy security 100 / 300 / 500 gave three different answers, the
 *  third being "hacking is irrelevant here" — see offFormulaStats.ts's `gatingStatFor` for why
 *  the gate a ship needs depends on which trigger its finding rides. */
const LEVELS: Record<'hacking' | 'security' | 'defence', [number, number, number]> = {
    hacking: [100, 300, 500],
    security: [100, 300, 500],
    defence: [2_000, 4_000, 6_000],
};

const LABEL: Record<'hacking' | 'security' | 'defence', string> = {
    hacking: 'Hacking',
    security: 'Security',
    defence: 'Defence',
};

/** Three opponents differing ONLY in `gatingStat`, so any difference in replayed outcomes across
 *  them is attributable to that one stat rather than to noise in the rest of the fixture.
 *  `practiceBoards`' player side is shared as-is across all three: it is what the focus's own
 *  build fights with, not part of what varies. */
export function sparringOpponents(
    focus: Ship,
    gatingStat: 'hacking' | 'security' | 'defence'
): { playerBoard: BoardState; opponents: SparringOpponent[]; focusPosition: Position } {
    const { playerBoard, enemyBoard } = practiceBoards(focus);
    const focusPosition = (Object.keys(playerBoard) as Position[]).find(
        (position) => playerBoard[position]?.ship?.id === focus.id
    )!;

    const opponents = LEVELS[gatingStat].map((level) => {
        const varied: BoardState = {};
        for (const [position, cell] of Object.entries(enemyBoard)) {
            if (!cell?.ship) continue;
            varied[position as Position] = {
                ...cell,
                ship: {
                    ...cell.ship,
                    baseStats: { ...cell.ship.baseStats, [gatingStat]: level },
                },
            };
        }
        return { label: `${LABEL[gatingStat]} ${level}`, enemyBoard: varied };
    });

    return { playerBoard, opponents, focusPosition };
}
