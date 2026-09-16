import type { Ship } from '../../../types/ship';
import type { LocalEncounterNote, Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../../combat/preFight';
import {
    deserializeSetup,
    type DroppedCell,
    type SimulatorSetup,
} from '../../simulator/simulatorSetup';
import { practiceBoards } from './practiceBoard';

export interface FightBoards {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    /** Ship ids on the player side — the input `stolenFromBoard` needs. */
    boardShipIds: string[];
    /** The cell the focus ship fights from. A board cell is unique, so the position identifies
     *  the focus where a ship id cannot. */
    focusPosition: Position;
    /** True when both sides are real ships the player chose. A practice or encounter fight is
     *  not. */
    realOpponent: boolean;
    /** Cells the source named whose ship no longer resolves — a saved setup's own roster, or an
     *  encounter's formation. The fight still runs without them, but it is not the fight that was
     *  saved, so a caller showing this source must say so. */
    dropped: DroppedCell[];
}

export type FightSource =
    | { kind: 'practice' }
    | { kind: 'encounter'; note: LocalEncounterNote }
    | { kind: 'setup'; setup: SimulatorSetup };

/** Only a saved setup supplies both sides as the player's actual opponent — practice and
 *  encounter sources both borrow the practice enemy. Mirrors `resolveFight`'s `realOpponent`
 *  without resolving the fight, so a caller can show the "not a real team" note cheaply. */
export function isRealOpponentSource(kind: FightSource['kind']): boolean {
    return kind === 'setup';
}

const shipIdsOf = (board: BoardState): string[] =>
    Object.values(board)
        .filter((placement): placement is NonNullable<typeof placement> => !!placement)
        .map((placement) => placement.ship.id);

/** The one cell the focus fights from. Throws on absent or doubled: both make "the focus's own
 *  numbers" a question with no single answer, and a guess there is undetectable downstream. */
const findFocusPosition = (board: BoardState, focusShipId: string): Position => {
    const cells = (Object.entries(board) as [Position, BoardState[Position]][]).filter(
        ([, placement]) => placement?.ship.id === focusShipId
    );
    if (cells.length === 0) throw new Error(`focus ship ${focusShipId} is not on the player board`);
    if (cells.length > 1) {
        throw new Error(`focus ship ${focusShipId} occupies ${cells.length} cells on one board`);
    }
    return cells[0][0];
};

/** The focus must fight as the ship the candidate built, not the copy the source stored. */
const substituteFocus = (board: BoardState, focus: Ship): BoardState => {
    const result: BoardState = {};
    for (const [position, placement] of Object.entries(board) as [
        Position,
        BoardState[Position],
    ][]) {
        if (!placement) continue;
        result[position] =
            placement.ship.id === focus.id ? { ...placement, ship: focus } : placement;
    }
    return result;
};

/**
 * Turn a practice board, an encounter note, or a saved simulator setup into one board shape.
 *
 * An encounter note's `formation` is the player's own ships — it is what feeds the autogear gear
 * queue through `formationToShipIds` — so it supplies one side and borrows the practice enemy. A
 * saved simulator setup supplies both sides plus its squad leaders, and is the only source that
 * can answer whether a build is better against the player's actual opponent.
 */
export function resolveFight(
    source: FightSource,
    focus: Ship,
    resolveShip: (shipId: string) => Ship | null
): FightBoards {
    if (source.kind === 'practice') {
        const { playerBoard, enemyBoard } = practiceBoards(focus);
        return {
            playerBoard,
            enemyBoard,
            boardShipIds: shipIdsOf(playerBoard),
            focusPosition: findFocusPosition(playerBoard, focus.id),
            realOpponent: isRealOpponentSource(source.kind),
            dropped: [],
        };
    }

    if (source.kind === 'encounter') {
        const playerBoard: BoardState = {};
        const dropped: DroppedCell[] = [];
        for (const entry of source.note.formation) {
            const ship = entry.shipId === focus.id ? focus : resolveShip(entry.shipId);
            if (!ship) {
                dropped.push({ side: 'player', position: entry.position });
                continue;
            }
            playerBoard[entry.position] = { ship };
        }
        return {
            playerBoard,
            enemyBoard: practiceBoards(focus).enemyBoard,
            boardShipIds: shipIdsOf(playerBoard),
            focusPosition: findFocusPosition(playerBoard, focus.id),
            realOpponent: isRealOpponentSource(source.kind),
            dropped,
        };
    }

    const deserialized = deserializeSetup(source.setup, resolveShip);
    if (Object.keys(deserialized.enemyBoard).length === 0) {
        throw new Error(
            `setup "${source.setup.name}" has no opponent: none of its saved enemy ships resolve`
        );
    }
    const playerBoard = substituteFocus(deserialized.playerBoard, focus);
    return {
        playerBoard,
        enemyBoard: deserialized.enemyBoard,
        playerSquadLeader: deserialized.playerSquadLeader,
        enemySquadLeader: deserialized.enemySquadLeader,
        boardShipIds: shipIdsOf(playerBoard),
        focusPosition: findFocusPosition(playerBoard, focus.id),
        realOpponent: isRealOpponentSource(source.kind),
        dropped: deserialized.dropped,
    };
}
