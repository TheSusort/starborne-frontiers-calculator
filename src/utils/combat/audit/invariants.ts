import type { BattleResult } from '../../calculators/battleSimulator';
import type { InvariantViolation } from './types';

function hpBounds(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.hpPct < 0 || s.hpPct > 100) {
                out.push({
                    invariant: 'hp-bounds',
                    round: r.round,
                    actorId: s.actorId,
                    detail: `hpPct ${s.hpPct} outside [0,100]`,
                });
            }
        }
    }
    return out;
}

/**
 * `ShipRoundState.alive` is an end-of-round snapshot (battleSimulator.ts: `alive =
 * destroyRound === undefined || round < destroyRound`), and `turnOrder` is built from
 * `turn-started` emission order regardless of `alive` — so a ship that starts its turn in
 * round R and then dies in round R (e.g. a start-of-turn DoT/bomb tick, before it acts) is
 * legitimately `alive:false` AND present in `turnOrder` for round R. That is NOT a bug: no
 * revival mechanic exists (cheat-death prevents destruction, never reverses it, and a ship's
 * destroy round is the earliest round it was destroyed), so once an actor is dead in round R
 * it stays dead for every later round. The real invariant is: a corpse must never appear in
 * turnOrder for any round AFTER the round it died in.
 */
function noDeadActs(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    const firstDeadRound = new Map<string, number>();
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (!s.alive && !firstDeadRound.has(s.actorId)) {
                firstDeadRound.set(s.actorId, r.round);
            }
        }
    }
    for (const r of result.rounds) {
        for (const actorId of r.turnOrder) {
            const deadRound = firstDeadRound.get(actorId);
            if (deadRound !== undefined && r.round > deadRound) {
                out.push({
                    invariant: 'no-dead-acts',
                    round: r.round,
                    actorId,
                    detail: `actor ${actorId} died in round ${deadRound} but appears in turnOrder for round ${r.round}`,
                });
            }
        }
    }
    return out;
}

/**
 * `ShipRoundState.damageDealt`/`damageTaken` reconcile by construction (see the docstrings on
 * `ShipRoundState.damageDealt` in battleSimulator.ts), EXCEPT under an active Protection redirect
 * — a protector's credited `damageDealt` chunk is a diverted PORTION of the original hit, not
 * independent new damage, so it inflates the round's `Σ damageDealt` relative to `Σ damageTaken`
 * (and a redirected DoT-tick batch, which has no single source attacker, isn't mirrored into
 * `perTargetDealt` at all, shorting the sum the other way). There is no protection/redirect entry
 * kind in the combat log, so the only pure, result-only signal for "Protection was active this
 * round" is `activeBuffs` — Protection is a buff named exactly `'Protection'`
 * (see `protectionTransfer.ts`). Skip any round where ANY ship carries it.
 */
function damageConservation(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        if (r.ships.some((s) => s.activeBuffs.includes('Protection'))) {
            continue;
        }
        const dealt = r.ships.reduce((sum, s) => sum + s.damageDealt, 0);
        const taken = r.ships.reduce((sum, s) => sum + s.damageTaken, 0);
        if (Math.abs(dealt - taken) > 1) {
            out.push({
                invariant: 'damage-conservation',
                round: r.round,
                detail: `round ${r.round}: Σ damageDealt ${dealt} != Σ damageTaken ${taken} (diff ${dealt - taken})`,
            });
        }
    }
    return out;
}

export function checkInvariants(result: BattleResult): InvariantViolation[] {
    return [...hpBounds(result), ...noDeadActs(result), ...damageConservation(result)];
}
