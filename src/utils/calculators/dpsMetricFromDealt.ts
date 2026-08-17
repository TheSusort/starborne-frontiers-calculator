import type { RoundData } from './dpsSimulator';

/**
 * Per-round damage DEALT by one attacker, summed over every victim it hit that round.
 *
 * Reads `RoundData.perTargetDealt` (attackerId -> victimId -> amount), the same authoritative
 * per-attacker×victim map `battleSimulator` derives `ShipRoundState.damageDealt` from (SP-F F1).
 *
 * Why this exists: in a POSITIONAL run the engine suppresses its
 * `creditDamage(actor, 'direct', …)` fold — `if (!positional)` at `engine.ts:9082`, because the
 * firing hit lands per-victim instead and crediting again would double-count. So the scalar
 * `rawTotals.cumulative` reads ~0, and the per-victim map is the only honest source for the
 * metric. That is not a special case any more: since SP-4b-2a `simulateDPS` always faces a real
 * positioned enemy (supplied or synthesized), so this path is the ONLY one the DPS metric takes.
 *
 * A round with no entry for this attacker contributes 0 and KEEPS its slot, so the returned array
 * is index-aligned with `rounds` — callers zip it back onto the rows.
 */
export function focusDamagePerRound(rounds: RoundData[], focusId: string): number[] {
    return actorsDamagePerRound(rounds, [focusId]);
}

/**
 * Per-round damage DEALT by a GROUP of attackers, summed over every victim each of them hit that
 * round. The group form of `focusDamagePerRound`, for aggregates that are a sum over several
 * actors rather than one — the walked TEAM actors behind `RoundData.teamDamage`.
 *
 * The engine folds `teamDamage` out of the scalar `roundDamage` map by taking "every entry that is
 * not the focus". That subtraction is only safe on the map, which is player-credit-only; it is NOT
 * safe on `perTargetDealt`, which is keyed by attacker across BOTH sides — "not the focus" there
 * also means every enemy. So this takes an EXPLICIT id list (the walked team ids) rather than
 * inverting a single id, and an actor that dealt nothing simply contributes 0.
 *
 * Index-aligned with `rounds` for the same reason `focusDamagePerRound` is.
 */
export function actorsDamagePerRound(
    rounds: RoundData[],
    attackerIds: readonly string[]
): number[] {
    return rounds.map((r) =>
        attackerIds.reduce(
            (total, id) =>
                total + Object.values(r.perTargetDealt?.[id] ?? {}).reduce((sum, n) => sum + n, 0),
            0
        )
    );
}

/** Total damage dealt by one attacker across every round. */
export function focusDamageTotal(rounds: RoundData[], focusId: string): number {
    return focusDamagePerRound(rounds, focusId).reduce((sum, n) => sum + n, 0);
}
