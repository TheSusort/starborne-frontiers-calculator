/** Total statuses removed for a crit-power-scaled cleanse/purge: `count × floor(critPower / per)`.
 *  Shared by the purge branch (Amartya) and the cleanse branch (Fuying, #363).
 *
 *  `'all'` is NEVER scaled — the original purge guard's `typeof count === 'number'` check is
 *  load-bearing and is preserved here. `per <= 0` / non-finite returns the unscaled count so a
 *  hand-built config cannot produce Infinity/NaN. */
export function scaledStatusCount(
    count: number | 'all',
    scaling: { stat: 'critDamage'; per: number } | undefined,
    effectiveCritDamage: number
): number | 'all' {
    if (!scaling || typeof count !== 'number') return count;
    if (!Number.isFinite(scaling.per) || scaling.per <= 0) return count;
    return count * Math.max(0, Math.floor(effectiveCritDamage / scaling.per));
}
