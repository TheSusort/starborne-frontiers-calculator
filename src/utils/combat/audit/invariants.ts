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

function noDeadActs(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        const deadIds = new Set(r.ships.filter((s) => !s.alive).map((s) => s.actorId));
        for (const actorId of r.turnOrder) {
            if (deadIds.has(actorId)) {
                out.push({
                    invariant: 'no-dead-acts',
                    round: r.round,
                    actorId,
                    detail: `dead actor ${actorId} present in turnOrder`,
                });
            }
        }
    }
    return out;
}

export function checkInvariants(result: BattleResult): InvariantViolation[] {
    return [...hpBounds(result), ...noDeadActs(result)];
}
