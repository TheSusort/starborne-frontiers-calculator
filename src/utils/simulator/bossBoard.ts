import type { Position } from '../../types/encounters';
import type { BoardState, Placement } from '../../components/simulator/PlacementBoard';
import {
    BOUNTY_ADDS,
    BOUNTY_BOSSES,
    BOUNTY_ENCOUNTERS,
    bossFootprint,
    bossShip,
    npcShip,
    parseBossShipId,
} from '../../constants/bountyBosses';
import type { BountyId } from '../../constants/bounties';

/** The cells a placement's unit occupies when it is a multi-hex unit, otherwise `undefined`. */
export const placementFootprint = (placement: Placement): readonly Position[] | undefined =>
    bossFootprint(placement.ship);

/**
 * `board` with every boss on its anchor and nothing else on a boss's other cells. A boss off its
 * anchor is dropped; a ship sharing a cell with a boss's footprint is dropped. A board that needs
 * no change comes back as the same object.
 */
export function withoutStrayBossCells(board: BoardState): BoardState {
    const entries = Object.entries(board) as [Position, Placement][];
    const covered = new Set<Position>();
    const dropped = new Set<Position>();
    for (const [position, placement] of entries) {
        const footprint = placementFootprint(placement);
        if (!footprint) continue;
        if (footprint[0] !== position) dropped.add(position);
        else for (const cell of footprint.slice(1)) covered.add(cell);
    }
    for (const [position] of entries) if (covered.has(position)) dropped.add(position);
    if (dropped.size === 0) return board;
    return Object.fromEntries(entries.filter(([position]) => !dropped.has(position)));
}

/** The boss ship id held at a boss's anchor cell, or `undefined` when the board holds none. */
export const loadedBossShipId = (board: BoardState): string | undefined => {
    for (const boss of BOUNTY_BOSSES) {
        const id = board[boss.footprint[0]]?.ship.id;
        if (id && parseBossShipId(id)) return id;
    }
    return undefined;
};

/** The board an encounter loads: the boss at its anchor and each add on its cell; `null` for an unknown encounter. */
export function encounterBoard(bountyId: BountyId, level: number): BoardState | null {
    const boss = BOUNTY_BOSSES.find((candidate) => candidate.id === bountyId);
    const encounter = BOUNTY_ENCOUNTERS.find(
        (candidate) => candidate.bountyId === bountyId && candidate.level === level
    );
    const ship = bossShip(bountyId, level);
    if (!boss || !encounter || !ship) return null;
    const board: BoardState = { [boss.footprint[0]]: { ship } };
    for (const add of encounter.adds) {
        const addDef = BOUNTY_ADDS.find((candidate) => candidate.id === add.addId);
        const addShip = addDef && npcShip(addDef.id, addDef.level);
        if (addShip) board[add.position] = { ship: addShip };
    }
    return board;
}
