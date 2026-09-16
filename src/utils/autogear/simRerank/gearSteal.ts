import type { Ship } from '../../../types/ship';
import type { GearSuggestion } from '../../../types/autogear';

export interface StolenPiece {
    gearId: string;
    fromShipId: string;
    fromShipName: string;
}

export interface StolenFromBoardArgs {
    suggestions: GearSuggestion[];
    focusShipId: string;
    /** Ship ids placed on the player side of the fight. */
    boardShipIds: string[];
    getShipById: (id: string) => Ship | undefined;
    /** gear id → the ship id wearing it. */
    gearToShipMap: Map<string, string>;
}

/**
 * The pieces a candidate loadout would take off a ship that is also in the fight.
 *
 * Autogear's pool includes gear worn by any unlocked ship unless `ignoreEquipped` is set, so a
 * candidate can name a piece a board ally is still wearing. Simulating that is simulating one
 * piece worn twice, which no fight can be; such candidates are excluded upstream and the pieces
 * named here are what the exclusion reports.
 */
export function stolenFromBoard(args: StolenFromBoardArgs): StolenPiece[] {
    const { suggestions, focusShipId, boardShipIds, getShipById, gearToShipMap } = args;
    const onBoard = new Set(boardShipIds);

    const stolen: StolenPiece[] = [];
    for (const suggestion of suggestions) {
        const ownerId = gearToShipMap.get(suggestion.gearId);
        if (!ownerId || ownerId === focusShipId || !onBoard.has(ownerId)) continue;
        stolen.push({
            gearId: suggestion.gearId,
            fromShipId: ownerId,
            fromShipName: getShipById(ownerId)?.name ?? ownerId,
        });
    }
    return stolen;
}
