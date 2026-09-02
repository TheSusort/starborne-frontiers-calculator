/**
 * Pick the actor id with the greatest (live, effective) attack from `ids`.
 * Ties resolve to the FIRST in `ids` order (deterministic for goldens). Returns undefined
 * when `ids` is empty. Pure — the caller supplies live attack, so the engine wires
 * effectiveStatsOf and this stays unit-testable (mirrors incomingEffects.ts / outgoingEffects.ts).
 *
 * #407: the `isLiving` predicate parameter was REMOVED. Liveness is no longer this function's
 * question — every caller hands it a roster already narrowed by `aliveTargetsOf`
 * (targetableActors.ts), which is THE one gate for the whole selector layer. Do not re-add a
 * liveness argument here: asking the same question at four separate sites is exactly how
 * `mostBuffsAmong` ended up as the one site that forgot to ask it, and let a buffed corpse win a
 * purge selection 1086 times.
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
