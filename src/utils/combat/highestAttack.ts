/**
 * D-PR14: pick the living actor id with the greatest (live, effective) attack from `ids`.
 * Ties resolve to the FIRST in `ids` order (deterministic for goldens). Returns undefined
 * when no living candidate exists. Pure — the caller supplies live attack + liveness, so the
 * engine wires effectiveStatsOf / destroyedRound and this stays unit-testable (mirrors
 * incomingEffects.ts / outgoingEffects.ts).
 */
export function highestAttackAmong(
    ids: string[],
    attackOf: (id: string) => number,
    isLiving: (id: string) => boolean
): string | undefined {
    let best: string | undefined;
    let bestAtk = -Infinity;
    for (const id of ids) {
        if (!isLiving(id)) continue;
        const atk = attackOf(id);
        if (atk > bestAtk) {
            bestAtk = atk;
            best = id;
        }
    }
    return best;
}
