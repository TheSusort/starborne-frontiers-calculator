import type { RoundData } from './dpsSimulator';

/**
 * Per-round damage DEALT by one attacker, summed over every victim it hit that round.
 *
 * Reads `RoundData.perTargetDealt` (attackerId -> victimId -> amount), the same authoritative
 * per-attacker×victim map `battleSimulator` derives `ShipRoundState.damageDealt` from (SP-F F1).
 *
 * Why this exists: in a POSITIONAL run the engine suppresses its
 * `creditDamage(actor, 'direct', …)` fold — `if (!positional)` at `engine.ts:8430`, because the
 * firing hit lands per-victim instead and crediting again would double-count. So the scalar
 * `rawTotals.cumulative` reads ~0 once the DPS calculator faces a real positioned enemy, and the
 * per-victim map becomes the only honest source for the metric.
 *
 * A round with no entry for this attacker contributes 0 and KEEPS its slot, so the returned array
 * is index-aligned with `rounds` — callers zip it back onto the rows.
 */
export function focusDamagePerRound(rounds: RoundData[], focusId: string): number[] {
    return rounds.map((r) =>
        Object.values(r.perTargetDealt?.[focusId] ?? {}).reduce((sum, n) => sum + n, 0)
    );
}

/** Total damage dealt by one attacker across every round. */
export function focusDamageTotal(rounds: RoundData[], focusId: string): number {
    return focusDamagePerRound(rounds, focusId).reduce((sum, n) => sum + n, 0);
}
