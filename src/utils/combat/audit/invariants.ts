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

export function checkInvariants(result: BattleResult): InvariantViolation[] {
    return [...hpBounds(result), ...noDeadActs(result)];
}
