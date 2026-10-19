import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

/** Resolves a gear id to the piece in the inventory; `undefined` for an id with no piece. */
export type GearLookup = (id: string) => GearPiece | undefined;

/** Whether `ship` can be a duel opponent: it has at least one equipped gear piece that resolves
 *  in the inventory (a stale id of deleted gear does not count). */
export function isDuelCandidate(ship: Ship, getGearPiece: GearLookup): boolean {
    return Object.values(ship.equipment ?? {}).some((id) => !!id && !!getGearPiece(id));
}

const candidates = (fleet: readonly Ship[], flownId: string, getGearPiece: GearLookup) =>
    fleet.filter((s) => s.id !== flownId && isDuelCandidate(s, getGearPiece));

/** Two distinct duel candidates other than the flown ship, uniformly at random; `null` when the
 *  fleet cannot field two. */
export function pickOpponents(
    fleet: readonly Ship[],
    flownId: string,
    random: () => number,
    getGearPiece: GearLookup
): [Ship, Ship] | null {
    const pool = candidates(fleet, flownId, getGearPiece);
    if (pool.length < 2) return null;
    const first = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const second = pool[Math.floor(random() * pool.length)];
    return [first, second];
}

/** Whether a run with `flownId` gets duel checkpoints: the fleet fields two candidates besides
 *  it. The flown ship itself needs no gear. */
export function canDuel(
    fleet: readonly Ship[],
    flownId: string | null,
    getGearPiece: GearLookup
): boolean {
    return flownId !== null && candidates(fleet, flownId, getGearPiece).length >= 2;
}
