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
 * Turn-weighted average of the focus attacker's EFFECTIVE crit rate — each turn's reading clamped
 * to 100 BEFORE averaging.
 *
 * `stats-snapshot` carries the uncapped fold (base + buffs), but a hit's crit rate is capped, so a
 * turn at a folded 120 still crits at 100. Clamping the average instead of each turn silently
 * over-reports: readings of 70, 120, 120, 120, 120 average to 110 → clamp 100, while the honest
 * turn-weighted rate is 94. Kept beside `averageFocusStats` rather than folded into it because the
 * cap is a DISPLAY semantic — the averaged snapshot itself stays a faithful mirror of the engine's
 * uncapped fold.
 *
 * The 100 here is the plain cap the summary has always displayed, NOT the affinity crit cap (75 on
 * a disadvantaged matchup), which the snapshot does not carry.
 *
 * Returns undefined when no round carries a snapshot, matching `averageFocusStats`.
 */
export function averageEffectiveCrit(rounds: RoundData[]): number | undefined {
    const turns = rounds.flatMap((r) => r.focusStatsSnapshots ?? []);
    if (turns.length === 0) return undefined;
    return turns.reduce((sum, s) => sum + Math.min(100, s.crit), 0) / turns.length;
}
