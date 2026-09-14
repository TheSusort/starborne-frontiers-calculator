import type { Position } from '../../types/encounters';
import type { Ship } from '../../types/ship';
import type { BoardState } from '../../components/simulator/PlacementBoard';
import type { SquadLeaderSelection } from '../combat/preFight';
import { hasAnyOverride, type StatOverrides } from './statOverrides';

/** Discriminator for future migrations. A stored value carrying any other version is discarded,
 *  not upgraded. */
export const SIMULATOR_SETUP_VERSION = 1;

/** The name an autosaved setup carries. A setup name is non-empty (the schema enforces it), and
 *  the autosave is not a named save the user chose — this is the placeholder that keeps it valid
 *  without colliding with the saved list, which is keyed by user-typed names. */
export const AUTOSAVE_SETUP_NAME = '(autosave)';

/** The longest name a setup may carry. The schema rejects anything longer, so a field that let a
 *  longer name through would save in the session and vanish on the next read. */
export const SETUP_NAME_MAX_LENGTH = 120;

export interface SerializedPlacement {
    /** An owned ship's id, or a reference id (`template:<templateId>:<variant>`). */
    shipId: string;
    overrides?: StatOverrides;
}

export type SerializedBoard = Partial<Record<Position, SerializedPlacement>>;

export interface SimulatorSetup {
    version: number;
    name: string;
    playerBoard: SerializedBoard;
    enemyBoard: SerializedBoard;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    /** Epoch ms; orders the saved list. */
    savedAt: number;
}

export interface SerializeSetupArgs {
    name: string;
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    savedAt: number;
}

/** A setup stores ship IDS, not resolved stats, so re-gearing a ship updates every setup that
 *  names it. */
const serializeBoard = (board: BoardState): SerializedBoard => {
    const serialized: SerializedBoard = {};
    for (const [position, placement] of Object.entries(board) as [
        Position,
        BoardState[Position],
    ][]) {
        if (!placement) continue;
        serialized[position] = hasAnyOverride(placement.overrides)
            ? { shipId: placement.ship.id, overrides: { ...placement.overrides } }
            : { shipId: placement.ship.id };
    }
    return serialized;
};

export function serializeSetup(args: SerializeSetupArgs): SimulatorSetup {
    return {
        version: SIMULATOR_SETUP_VERSION,
        name: args.name,
        playerBoard: serializeBoard(args.playerBoard),
        enemyBoard: serializeBoard(args.enemyBoard),
        playerSquadLeader: args.playerSquadLeader,
        enemySquadLeader: args.enemySquadLeader,
        seed: args.seed,
        runCount: args.runCount,
        savedAt: args.savedAt,
    };
}

export interface DroppedCell {
    side: 'player' | 'enemy';
    position: Position;
}

export interface DeserializedSetup {
    playerBoard: BoardState;
    enemyBoard: BoardState;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
    seed: number;
    runCount: number;
    /** Cells whose ship id no longer resolves. Reported to the user; never thrown. */
    dropped: DroppedCell[];
}

const deserializeBoard = (
    board: SerializedBoard,
    side: 'player' | 'enemy',
    resolve: (shipId: string) => Ship | null,
    dropped: DroppedCell[]
): BoardState => {
    const result: BoardState = {};
    for (const [position, placement] of Object.entries(board) as [
        Position,
        SerializedPlacement | undefined,
    ][]) {
        if (!placement) continue;
        const ship = resolve(placement.shipId);
        if (!ship) {
            dropped.push({ side, position });
            continue;
        }
        result[position] = {
            ship,
            overrides: hasAnyOverride(placement.overrides) ? { ...placement.overrides } : undefined,
        };
    }
    return result;
};

/**
 * Rebuild boards from a stored setup.
 *
 * An unresolvable ship id is normal, not corruption: an alt-account switch dangles every owned id
 * at once, and import dedupes ships by level/rank/stats/refit count so an id need not survive a
 * re-import. Those cells are dropped and reported; the rest of the setup loads.
 */
export function deserializeSetup(
    setup: SimulatorSetup,
    resolve: (shipId: string) => Ship | null
): DeserializedSetup {
    const dropped: DroppedCell[] = [];
    return {
        playerBoard: deserializeBoard(setup.playerBoard, 'player', resolve, dropped),
        enemyBoard: deserializeBoard(setup.enemyBoard, 'enemy', resolve, dropped),
        playerSquadLeader: setup.playerSquadLeader,
        enemySquadLeader: setup.enemySquadLeader,
        seed: setup.seed,
        runCount: setup.runCount,
        dropped,
    };
}
