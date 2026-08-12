import type { RoundData, RoundStatsSnapshot } from './dpsSimulator';

/**
 * Turn-weighted average of the focus attacker's live stats across a simulated run (SP-2).
 *
 * Each focus TURN weighs equally — not each round. `stats-snapshot` fires per turn, so a round in
 * which an extra action granted a second turn contributes two readings, and it should: the reading
 * is taken AT TURN START, so an extra action legitimately earns extra weight. Turn-blocked turns
 * (Stasis/Disable) still emit `turn-started` and therefore still snapshot; they are included,
 * matching the engine's unconditional `turnsTaken` increment.
 *
 * Turn-START timing also means the FIRST reading of a run predates that turn's own cast — a ship
 * whose active skill buffs itself shows its unbuffed attack in round 1 and the buffed one after.
 * That is the honest description of the opening turn, not an off-by-one.
 *
 * Returns undefined when no round carries a snapshot (a run simulated without
 * `collectStatusTimeline`), so a caller renders nothing rather than a spurious zero.
 */
export function averageFocusStats(rounds: RoundData[]): RoundStatsSnapshot | undefined {
    const turns = rounds.flatMap((r) => r.focusStatsSnapshots ?? []);
    if (turns.length === 0) return undefined;

    const mean = (pick: (s: RoundStatsSnapshot) => number): number =>
        turns.reduce((sum, s) => sum + pick(s), 0) / turns.length;

    // Written out key by key deliberately: the return type makes a stat added to the engine's
    // snapshot payload a COMPILE error here, where a generic key-walk would silently drop it.
    return {
        attack: mean((s) => s.attack),
        defence: mean((s) => s.defence),
        crit: mean((s) => s.crit),
        critDamage: mean((s) => s.critDamage),
        defensePenetration: mean((s) => s.defensePenetration),
        speed: mean((s) => s.speed),
        hacking: mean((s) => s.hacking),
        security: mean((s) => s.security),
        currentHp: mean((s) => s.currentHp),
        maxHp: mean((s) => s.maxHp),
        shieldPool: mean((s) => s.shieldPool),
    };
}

/**
 * Turn-weighted average of the focus attacker's EFFECTIVE crit rate — each turn's reading resolved
 * through the affinity cap AND penalty BEFORE averaging.
 *
 * `stats-snapshot` carries the uncapped, pre-penalty fold (base + buffs), but the engine resolves a
 * hit's real crit rate as `min(critCap, max(0, crit - critPenalty))` (see `playerTurn.ts`'s
 * `cappedCrit`/`realAffinityCappedCrit`) — a disadvantaged matchup drops the cap to 75 and subtracts
 * a 25 penalty before that cap even applies. Resolving the average instead of each turn silently
 * over-reports: readings of 70, 120, 120, 120, 120 average to 110 → clamp 100, while the honest
 * turn-weighted rate (at the default cap/penalty) is 94. Kept beside `averageFocusStats` rather than
 * folded into it because the cap/penalty are a DISPLAY semantic — the averaged snapshot itself stays
 * a faithful mirror of the engine's uncapped, pre-penalty fold.
 *
 * `affinity` defaults to the neutral/advantage modifiers (cap 100, no penalty) — every existing call
 * site that doesn't carry a real matchup keeps behaving exactly as before. Callers with a real
 * matchup should thread `computeAffinityModifiers`'s own `critCap`/`critPenalty` in from the page, so
 * the displayed rate agrees with what the engine actually rolls.
 *
 * Returns undefined when no round carries a snapshot, matching `averageFocusStats`.
 */
export function averageEffectiveCrit(
    rounds: RoundData[],
    affinity: { critCap: number; critPenalty: number } = { critCap: 100, critPenalty: 0 }
): number | undefined {
    const turns = rounds.flatMap((r) => r.focusStatsSnapshots ?? []);
    if (turns.length === 0) return undefined;
    return (
        turns.reduce(
            (sum, s) =>
                sum + Math.min(affinity.critCap, Math.max(0, s.crit - affinity.critPenalty)),
            0
        ) / turns.length
    );
}
