import type { Ship } from '../../../types/ship';

/** Two distinct fleet ships other than the flown one, uniformly at random; `null` when the fleet
 *  cannot field two. */
export function pickOpponents(
    fleet: readonly Ship[],
    flownId: string,
    random: () => number
): [Ship, Ship] | null {
    const pool = fleet.filter((s) => s.id !== flownId);
    if (pool.length < 2) return null;
    const first = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const second = pool[Math.floor(random() * pool.length)];
    return [first, second];
}

export function canDuel(fleet: readonly Ship[], flownId: string | null): boolean {
    return flownId !== null && fleet.filter((s) => s.id !== flownId).length >= 2;
}
