import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { ChallengeKind } from '../../../utils/arcade/types';

/** Resolves a gear id to the piece in the inventory; `undefined` for an id with no piece. */
export type GearLookup = (id: string) => GearPiece | undefined;

/** Whether `ship` can be a duel opponent: it has at least one equipped gear piece that resolves
 *  in the inventory (a stale id of deleted gear does not count). */
export function isDuelCandidate(ship: Ship, getGearPiece: GearLookup): boolean {
    return Object.values(ship.equipment ?? {}).some((id) => !!id && !!getGearPiece(id));
}

/** Decides whether a ship may be a duel opponent. */
export type DuelCandidateTest = (ship: Ship) => boolean;

/** Fleet ships duel only when geared (see `isDuelCandidate`). */
export const gearedCandidate =
    (getGearPiece: GearLookup): DuelCandidateTest =>
    (ship) =>
        isDuelCandidate(ship, getGearPiece);

/** Bare templates carry no gear, so every one may duel. */
export const anyCandidate: DuelCandidateTest = () => true;

const candidates = (fleet: readonly Ship[], flownId: string, isCandidate: DuelCandidateTest) =>
    fleet.filter((s) => s.id !== flownId && isCandidate(s));

/** Ships a `team` row needs besides the flown one: two opposing trios and the player's two
 *  allies, all distinct. */
export const TEAM_PICK_SHIPS = 8;

/** Up to `size` distinct ships passing `isCandidate`, other than the flown ship, drawn in order
 *  uniformly at random; `null` when the fleet cannot field two. */
export function pickBundle(
    fleet: readonly Ship[],
    flownId: string,
    random: () => number,
    isCandidate: DuelCandidateTest,
    size: number
): Ship[] | null {
    const pool = candidates(fleet, flownId, isCandidate);
    if (pool.length < 2) return null;
    const picked: Ship[] = [];
    while (picked.length < size && pool.length > 0) {
        picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
    }
    return picked;
}

/** Two distinct ships passing `isCandidate`, other than the flown ship, uniformly at random;
 *  `null` when the fleet cannot field two. */
export function pickOpponents(
    fleet: readonly Ship[],
    flownId: string,
    random: () => number,
    isCandidate: DuelCandidateTest
): [Ship, Ship] | null {
    const pick = pickBundle(fleet, flownId, random, isCandidate, 2);
    return pick && [pick[0], pick[1]];
}

export type Trio = [Ship, Ship, Ship];

/** The ships behind one checkpoint row. `single`: one ship per gate (`gates[slot]`). `team`: a
 *  trio per gate and the two allies who fly with the player. */
export type RowPicks =
    | { kind: 'single'; gates: [Ship, Ship] }
    | { kind: 'team'; gates: [Trio, Trio]; allies: [Ship, Ship] };

/** Every ship in `picks`: the gate ships in slot order, then the allies. */
export const shipsOfPicks = (picks: RowPicks): Ship[] =>
    picks.kind === 'single' ? [...picks.gates] : [...picks.gates.flat(), ...picks.allies];

/** The ships a pre-picked `bundle` (see `pickBundle`) gives a row of `challenge`: its first two
 *  for a one-ship row; for `team`, the first two trios as the gates and the next two ships as the
 *  allies. `null` when the bundle is too small. */
export function rowPicks(challenge: ChallengeKind, bundle: readonly Ship[]): RowPicks | null {
    if (challenge !== 'team') {
        return bundle.length >= 2 ? { kind: 'single', gates: [bundle[0], bundle[1]] } : null;
    }
    if (bundle.length < TEAM_PICK_SHIPS) return null;
    const [a, b, c, d, e, f, g, h] = bundle;
    return {
        kind: 'team',
        gates: [
            [a, b, c],
            [d, e, f],
        ],
        allies: [g, h],
    };
}

/** Whether a run with `flownId` may get `team` rows: the fleet fields TEAM_PICK_SHIPS candidates
 *  besides it. */
export function canTeam(
    fleet: readonly Ship[],
    flownId: string | null,
    isCandidate: DuelCandidateTest
): boolean {
    return flownId !== null && candidates(fleet, flownId, isCandidate).length >= TEAM_PICK_SHIPS;
}

/** Whether a run with `flownId` gets duel checkpoints: the fleet fields two candidates besides
 *  it. */
export function canDuel(
    fleet: readonly Ship[],
    flownId: string | null,
    isCandidate: DuelCandidateTest
): boolean {
    return flownId !== null && candidates(fleet, flownId, isCandidate).length >= 2;
}
