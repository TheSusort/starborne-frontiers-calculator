/**
 * Pick the actor id with the greatest (live, effective) attack from `ids`.
 * Ties resolve to the FIRST in `ids` order (deterministic for goldens). Returns undefined
 * when `ids` is empty. Pure — the caller supplies live attack, so the engine wires
 * effectiveStatsOf and this stays unit-testable (mirrors incomingEffects.ts / outgoingEffects.ts).
 *
 * Liveness is NOT this function's question (#407): every caller hands it a roster already
 * narrowed by `aliveTargetsOf` (targetableActors.ts), which is THE one gate for the whole
 * selector layer. Do not add a liveness argument here — re-asking the same question per selector
 * is how one selector ends up the site that forgets to ask, and lets a buffed corpse win a
 * selection.
 */
export function highestAttackAmong(
    ids: string[],
    attackOf: (id: string) => number
): string | undefined {
    let best: string | undefined;
    let bestAtk = -Infinity;
    for (const id of ids) {
        const atk = attackOf(id);
        if (atk > bestAtk) {
            bestAtk = atk;
            best = id;
        }
    }
    return best;
}
